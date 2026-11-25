import { describe, expect, it } from 'vitest';
import type { TuteeSession } from '../../core/domain/tutee';
import {
  blockDialog,
  blockSuccess,
  immediateSuccess,
  listProgress,
  revokeDialog,
  revokeSuccess,
  sessionsEnded,
} from './tutee-messages';
import {
  canAskAgainText,
  cooldownCleared,
  cooldownLine,
  durationText,
  historyText,
  isCancellable,
  sessionLabel,
} from './tutee-view-model';

const NOW = new Date('2026-11-24T12:00:00Z');
const session = (patch: Partial<TuteeSession>): TuteeSession => ({
  id: 's',
  startsAt: '2026-11-25T12:00:00Z',
  endsAt: '2026-11-25T13:00:00Z',
  status: 'accepted',
  createdAt: '2026-11-20T12:00:00Z',
  decidedAt: null,
  cancelledAt: null,
  ...patch,
});

describe('tutee messages', () => {
  it('uses the exact dialog titles and the unchecked-by-default help', () => {
    expect(revokeDialog('Alex').title).toBe('Revoke access for Alex?');
    expect(revokeDialog('Alex').body).toContain('Accepted future sessions will stay in place');
    expect(blockDialog('Alex').title).toBe('Block Alex?');
    expect(blockDialog('Alex').body).toContain('until you unblock them');
  });

  it('includes real counts only when the checkbox was ticked', () => {
    const result = { status: 'revoked' as const, pendingDeclined: 1, acceptedCancelled: 2 };
    expect(revokeSuccess('Alex', 'keep', result)).not.toContain('accepted future sessions were');
    expect(revokeSuccess('Alex', 'cancel_all', result)).toContain(
      '2 accepted future sessions were cancelled.',
    );
    expect(blockSuccess('Alex', 'cancel_all', { ...result, acceptedCancelled: 0 })).toContain(
      'No accepted future sessions were cancelled.',
    );
  });

  it('formats small helpers', () => {
    expect(listProgress(3, 7)).toBe('Showing 3 of 7 tutees.');
    expect(sessionsEnded(1)).toBe('1 session request ended');
    expect(sessionsEnded(2)).toBe('2 session requests ended');
    expect(immediateSuccess('Alex', 'allow-again')).toContain('Access is not granted');
    expect(immediateSuccess('Alex', 'unblock')).toContain('They can ask for access again');
  });
});

describe('tutee view model', () => {
  it('knows when a cooldown is over', () => {
    expect(cooldownCleared({ nextRequestAt: null }, NOW)).toBe(true);
    expect(cooldownCleared({ nextRequestAt: '2026-11-24T11:00:00Z' }, NOW)).toBe(true);
    expect(cooldownCleared({ nextRequestAt: '2026-11-24T13:00:00Z' }, NOW)).toBe(false);
  });

  it('describes when the tutee can ask again', () => {
    const later = '2026-11-24T20:00:00Z';
    expect(canAskAgainText({ status: 'blocked', nextRequestAt: null }, NOW)).toMatch(/^No/);
    expect(canAskAgainText({ status: 'approved', nextRequestAt: null }, NOW)).toBe('Now');
    expect(canAskAgainText({ status: 'denied', nextRequestAt: later }, NOW)).not.toBe('Now');
    expect(canAskAgainText({ status: 'revoked', nextRequestAt: null }, NOW)).toBe('Now');
  });

  it('shows the cooldown line only while it runs', () => {
    const later = '2026-11-24T20:00:00Z';
    expect(cooldownLine({ status: 'denied', nextRequestAt: later }, NOW)).toMatch(
      /^Can ask again after /,
    );
    expect(cooldownLine({ status: 'blocked', nextRequestAt: later }, NOW)).toBeNull();
    expect(cooldownLine({ status: 'denied', nextRequestAt: null }, NOW)).toBeNull();
  });

  it('labels sessions and only lets live ones be cancelled', () => {
    expect(sessionLabel(session({}), NOW)).toBe('Accepted');
    expect(sessionLabel(session({ status: 'pending' }), NOW)).toBe('Pending');
    expect(sessionLabel(session({ startsAt: '2026-11-23T12:00:00Z' }), NOW)).toBe('Past');
    expect(sessionLabel(session({ status: 'declined' }), NOW)).toBe('Declined');
    expect(isCancellable(session({}), NOW)).toBe(true);
    expect(isCancellable(session({ status: 'cancelled' }), NOW)).toBe(false);
    expect(isCancellable(session({ startsAt: '2026-11-23T12:00:00Z' }), NOW)).toBe(false);
  });

  it('formats durations and history', () => {
    expect(durationText({ startsAt: '2026-11-25T12:00:00Z', endsAt: '2026-11-25T12:45:00Z' })).toBe(
      '45 min',
    );
    expect(durationText({ startsAt: '2026-11-25T12:00:00Z', endsAt: '2026-11-25T13:30:00Z' })).toBe(
      '1 h 30 min',
    );
    expect(historyText(null, 1)).toBe('1 event shown');
    expect(historyText(null, 0)).toBe('History starts today.');
  });
});
