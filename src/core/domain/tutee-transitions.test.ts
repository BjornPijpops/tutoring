import { describe, expect, it } from 'vitest';
import type { TuteeAction, TuteeStatus } from './tutee';
import {
  ALLOWED_FROM,
  COOLDOWN_MS,
  allowedActions,
  nextAccessState,
  projectForTutee,
} from './tutee-transitions';

const STATUSES: TuteeStatus[] = ['pending', 'approved', 'denied', 'revoked', 'blocked'];
const ACTIONS = Object.keys(ALLOWED_FROM) as TuteeAction[];
const NOW = '2026-11-24T10:00:00.000Z';

const EXPECTED: [TuteeStatus, TuteeAction, TuteeStatus][] = [
  ['pending', 'approve', 'approved'],
  ['denied', 'approve', 'approved'],
  ['pending', 'deny', 'denied'],
  ['approved', 'revoke', 'revoked'],
  ['revoked', 'restore', 'approved'],
  ['pending', 'block', 'blocked'],
  ['approved', 'block', 'blocked'],
  ['denied', 'block', 'blocked'],
  ['revoked', 'block', 'blocked'],
  ['blocked', 'unblock', 'denied'],
];

describe('nextAccessState', () => {
  it.each(EXPECTED)('%s + %s -> %s', (from, action, to) => {
    const result = nextAccessState(from, action, NOW);
    expect(result).toMatchObject({ ok: true, value: { status: to, decidedAt: NOW } });
  });

  it('rejects every pair that is not in the table, including no-ops', () => {
    const allowed = new Set(EXPECTED.map(([from, action]) => `${from}/${action}`));
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        if (allowed.has(`${status}/${action}`)) continue;
        expect(nextAccessState(status, action, NOW)).toEqual({ ok: false, error: 'stale' });
      }
    }
  });

  it('sets the 8 hour cooldown only for deny and revoke', () => {
    const later = new Date(Date.parse(NOW) + COOLDOWN_MS).toISOString();
    for (const [from, action] of EXPECTED) {
      const result = nextAccessState(from, action, NOW);
      if (!result.ok) throw new Error('unexpected');
      expect(result.value.nextRequestAt).toBe(
        action === 'deny' || action === 'revoke' ? later : null,
      );
    }
  });

  it('records an audit action per transition', () => {
    const audits = EXPECTED.map(([from, action]) => {
      const result = nextAccessState(from, action, NOW);
      return result.ok ? result.value.auditAction : null;
    });
    expect(audits).toEqual([
      'approved',
      'approved',
      'denied',
      'revoked',
      'restored',
      'blocked',
      'blocked',
      'blocked',
      'blocked',
      'unblocked',
    ]);
  });
});

describe('allowedActions', () => {
  it('offers exactly the actions the state machine accepts', () => {
    for (const status of STATUSES) {
      for (const cleared of [true, false]) {
        const machine = allowedActions(status, cleared).filter(
          (a): a is TuteeAction => a !== 'allow-again',
        );
        for (const action of machine) {
          expect(nextAccessState(status, action, NOW).ok).toBe(true);
        }
      }
    }
  });

  it('offers allow-again only for denied and revoked with a running cooldown', () => {
    expect(allowedActions('denied', false)).toContain('allow-again');
    expect(allowedActions('revoked', false)).toContain('allow-again');
    expect(allowedActions('denied', true)).not.toContain('allow-again');
    expect(allowedActions('revoked', true)).not.toContain('allow-again');
    expect(allowedActions('pending', false)).not.toContain('allow-again');
    expect(allowedActions('blocked', false)).toEqual(['unblock']);
  });
});

describe('projectForTutee', () => {
  it('hides revoked and blocked behind denied', () => {
    expect(STATUSES.map(projectForTutee)).toEqual([
      'pending',
      'approved',
      'denied',
      'denied',
      'denied',
    ]);
  });
});
