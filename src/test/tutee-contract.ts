/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index rows they just inserted */
import { describe, expect, it } from 'vitest';
import type { SessionRequest } from '../core/domain/session-request';
import type { TuteeAction, TuteeStatus } from '../core/domain/tutee';
import { ALLOWED_FROM, COOLDOWN_MS, nextAccessState } from '../core/domain/tutee-transitions';
import type { PortResult, TuteeRepository } from '../core/ports';

export interface ContractTutee {
  readonly n: number;
  readonly name?: string;
  readonly email?: string;
  readonly status?: TuteeStatus;
  readonly requestedMinutesAgo?: number;
  /** Only meaningful for denied and revoked rows. */
  readonly cooldownActive?: boolean;
}

export interface ContractSession {
  readonly n: number;
  readonly status: SessionRequest['status'];
  readonly startsInHours: number;
}

export interface ContractWorld {
  readonly repo: TuteeRepository;
  /** Session ids in the order of the seed. */
  readonly sessionIds: readonly string[];
  readonly userId: (n: number) => string;
  readonly close?: () => Promise<void>;
}

export type ContractFactory = (
  tutees: readonly ContractTutee[],
  sessions?: readonly ContractSession[],
) => Promise<ContractWorld>;

const STATUSES: TuteeStatus[] = ['pending', 'approved', 'denied', 'revoked', 'blocked'];
const ACTIONS = Object.keys(ALLOWED_FROM) as TuteeAction[];

async function value<T>(result: PortResult<T>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(`expected ok, got ${settled.error.kind}`);
  return settled.value;
}

async function failure<T>(result: PortResult<T>) {
  const settled = await result;
  if (settled.ok) throw new Error('expected a failure');
  return settled.error;
}

/**
 * The behaviour every TuteeRepository must share. It runs against the in-memory adapter and
 * against the SQL functions (through the Supabase adapter on PGlite), so the two cannot drift.
 */
export function defineTuteeContract(name: string, factory: ContractFactory): void {
  describe(`${name}: tutee repository contract`, () => {
    it('lists pending first, then newest, and pages with a stable order', async () => {
      const w = await factory([
        { n: 1, status: 'approved', requestedMinutesAgo: 60 },
        { n: 2, status: 'pending', requestedMinutesAgo: 600 },
        { n: 3, status: 'denied', requestedMinutesAgo: 10 },
        { n: 4, status: 'pending', requestedMinutesAgo: 5 },
      ]);
      const all = await value(w.repo.list({}));
      expect(all.items.map((i) => i.userId)).toEqual([4, 2, 3, 1].map(w.userId));
      expect(all.total).toBe(4);
      const page = await value(w.repo.list({ limit: 2, offset: 2 }));
      expect(page.items.map((i) => i.userId)).toEqual([3, 1].map(w.userId));
      expect(page.total).toBe(4);
      expect((await value(w.repo.list({ limit: 0 }))).items.length).toBe(1);
      await w.close?.();
    });

    it('keeps counts independent of the status filter but not of the search', async () => {
      const w = await factory([
        { n: 1, name: 'Alex Example', status: 'approved' },
        { n: 2, name: 'Alexa Two', status: 'pending' },
        { n: 3, name: 'Bo Three', status: 'blocked' },
        { n: 4, name: 'Cy Four', status: 'revoked' },
        { n: 5, name: 'Di Five', status: 'denied' },
      ]);
      const filtered = await value(w.repo.list({ status: 'pending' }));
      expect(filtered.total).toBe(1);
      expect(filtered.counts).toEqual({
        pending: 1,
        approved: 1,
        denied: 1,
        revoked: 1,
        blocked: 1,
        all: 5,
      });
      const searched = await value(w.repo.list({ search: ' ALEX ', status: 'approved' }));
      expect(searched.items.map((i) => i.userId)).toEqual([w.userId(1)]);
      expect(searched.counts).toMatchObject({ approved: 1, pending: 1, all: 2, blocked: 0 });
      await w.close?.();
    });

    it('rejects an over-long search, a negative offset and an unknown status', async () => {
      const w = await factory([{ n: 1 }]);
      expect((await failure(w.repo.list({ search: 'x'.repeat(101) }))).kind).toBe('validation');
      expect((await value(w.repo.list({ search: 'x'.repeat(100) }))).total).toBe(0);
      expect((await failure(w.repo.list({ offset: -1 }))).kind).toBe('validation');
      expect((await failure(w.repo.list({ status: 'weird' as TuteeStatus }))).kind).toBe(
        'validation',
      );
      await w.close?.();
    });

    it('counts pending and future accepted sessions only', async () => {
      const w = await factory(
        [{ n: 1 }, { n: 2 }],
        [
          { n: 1, status: 'pending', startsInHours: 30 },
          { n: 1, status: 'accepted', startsInHours: 60 },
          { n: 1, status: 'accepted', startsInHours: -60 },
          { n: 1, status: 'declined', startsInHours: 80 },
          { n: 2, status: 'pending', startsInHours: 31 },
        ],
      );
      const items = (await value(w.repo.list({}))).items;
      expect(items.find((i) => i.userId === w.userId(1))).toMatchObject({
        pendingSessions: 1,
        acceptedFutureSessions: 1,
      });
      await w.close?.();
    });

    it('returns the detail with newest-first sessions capped at 20', async () => {
      const sessions: ContractSession[] = Array.from({ length: 25 }, (_, i) => ({
        n: 1,
        status: 'declined' as const,
        startsInHours: 24 + i,
      }));
      const w = await factory([{ n: 1, name: 'Alex Example', status: 'approved' }], sessions);
      const detail = await value(w.repo.get(w.userId(1)));
      expect(detail.tutee).toMatchObject({ displayName: 'Alex Example', status: 'approved' });
      expect(detail.sessions.length).toBe(20);
      const starts = detail.sessions.map((s) => Date.parse(s.startsAt));
      expect(starts).toEqual([...starts].sort((a, b) => b - a));
      expect(detail.events).toEqual([]);
      expect(detail.historyStartsAt).toBeNull();
      expect((await failure(w.repo.get(w.userId(99)))).kind).toBe('not-found');
      await w.close?.();
    });

    const pairs = STATUSES.flatMap((status) => ACTIONS.map((action) => [status, action] as const));
    it.each(pairs)('%s + %s follows the state machine', async (status, action) => {
      const w = await factory([{ n: 1, status }]);
      const expected = nextAccessState(status, action, new Date().toISOString());
      const result = await w.repo.act(w.userId(1), action);
      if (!expected.ok) {
        expect(result.ok).toBe(false);
        if (!result.ok)
          expect(result.error).toMatchObject({ kind: 'conflict', code: 'state_conflict' });
        const detail = await value(w.repo.get(w.userId(1)));
        expect(detail.tutee.status).toBe(status);
        expect(detail.events).toEqual([]);
      } else {
        expect(result).toEqual({
          ok: true,
          value: { status: expected.value.status, pendingDeclined: 0, acceptedCancelled: 0 },
        });
        const detail = await value(w.repo.get(w.userId(1)));
        expect(detail.tutee.status).toBe(expected.value.status);
        expect(detail.events.map((e) => e.action)).toEqual([expected.value.auditAction]);
        const gap =
          detail.tutee.nextRequestAt === null || detail.tutee.decidedAt === null
            ? null
            : Date.parse(detail.tutee.nextRequestAt) - Date.parse(detail.tutee.decidedAt);
        expect(gap).toBe(action === 'deny' || action === 'revoke' ? COOLDOWN_MS : null);
      }
      await w.close?.();
    });

    it('rejects unknown users and invalid session policies', async () => {
      const w = await factory([{ n: 1, status: 'approved' }]);
      expect((await failure(w.repo.act(w.userId(9), 'block'))).kind).toBe('not-found');
      expect((await failure(w.repo.act(w.userId(1), 'revoke', 'bogus' as never))).kind).toBe(
        'validation',
      );
      expect((await failure(w.repo.act(w.userId(1), 'restore', 'cancel_all'))).kind).toBe(
        'validation',
      );
      await w.close?.();
    });

    it.each(['revoke', 'block'] as const)(
      '%s keeps accepted sessions by default',
      async (action) => {
        const w = await factory(
          [
            { n: 1, status: 'approved' },
            { n: 2, status: 'approved' },
          ],
          [
            { n: 1, status: 'pending', startsInHours: 30 },
            { n: 1, status: 'accepted', startsInHours: 60 },
            { n: 2, status: 'pending', startsInHours: 31 },
          ],
        );
        const result = await value(w.repo.act(w.userId(1), action));
        expect(result).toMatchObject({ pendingDeclined: 1, acceptedCancelled: 0 });
        const detail = await value(w.repo.get(w.userId(1)));
        expect(detail.sessions.map((s) => s.status).sort()).toEqual(['accepted', 'declined']);
        const other = await value(w.repo.get(w.userId(2)));
        expect(other.sessions.map((s) => s.status)).toEqual(['pending']);
        await w.close?.();
      },
    );

    it.each(['revoke', 'block'] as const)(
      '%s with cancel_all cancels future accepted',
      async (action) => {
        const w = await factory(
          [{ n: 1, status: 'approved' }],
          [
            { n: 1, status: 'pending', startsInHours: 30 },
            { n: 1, status: 'accepted', startsInHours: 60 },
            { n: 1, status: 'accepted', startsInHours: 90 },
            { n: 1, status: 'accepted', startsInHours: -60 },
            { n: 1, status: 'declined', startsInHours: 80 },
            { n: 1, status: 'cancelled', startsInHours: 81 },
          ],
        );
        const result = await value(w.repo.act(w.userId(1), action, 'cancel_all'));
        expect(result).toMatchObject({ pendingDeclined: 1, acceptedCancelled: 2 });
        const detail = await value(w.repo.get(w.userId(1)));
        const byStart = [...detail.sessions].sort(
          (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
        );
        expect(byStart.map((s) => s.status)).toEqual([
          'accepted',
          'declined',
          'cancelled',
          'declined',
          'cancelled',
          'cancelled',
        ]);
        expect(detail.events[0]).toMatchObject({
          action: action === 'revoke' ? 'revoked' : 'blocked',
          sessionsEnded: 3,
        });
        await w.close?.();
      },
    );

    it('lists events newest first and reports the earliest as the history start', async () => {
      const w = await factory([{ n: 1, status: 'approved' }]);
      await value(w.repo.act(w.userId(1), 'revoke'));
      await value(w.repo.act(w.userId(1), 'restore'));
      await value(w.repo.act(w.userId(1), 'block'));
      const detail = await value(w.repo.get(w.userId(1)));
      expect(detail.events.map((e) => e.action)).toEqual(['blocked', 'restored', 'revoked']);
      expect(detail.events[0]).toMatchObject({ fromStatus: 'approved', toStatus: 'blocked' });
      expect(detail.historyStartsAt).toBe(detail.events[2]!.createdAt);
      await w.close?.();
    });

    it.each(['denied', 'revoked'] as const)(
      'allows a %s tutee to ask again once',
      async (status) => {
        const w = await factory([{ n: 1, status, cooldownActive: true }]);
        expect((await value(w.repo.get(w.userId(1)))).tutee.nextRequestAt).not.toBeNull();
        await value(w.repo.allowAgain(w.userId(1)));
        const detail = await value(w.repo.get(w.userId(1)));
        expect(detail.tutee).toMatchObject({ status, nextRequestAt: null });
        expect(detail.events.map((e) => e.action)).toEqual(['cooldown_reset']);
        expect((await failure(w.repo.allowAgain(w.userId(1)))).code).toBe('state_conflict');
        await w.close?.();
      },
    );

    it.each(['pending', 'approved', 'blocked'] as const)(
      'refuses allow-again for %s',
      async (status) => {
        const w = await factory([{ n: 1, status }]);
        expect((await failure(w.repo.allowAgain(w.userId(1)))).kind).toBe('not-found');
        expect((await failure(w.repo.allowAgain(w.userId(9)))).kind).toBe('not-found');
        await w.close?.();
      },
    );

    it('cancels pending and future accepted sessions only', async () => {
      const w = await factory(
        [{ n: 1, status: 'approved' }],
        [
          { n: 1, status: 'pending', startsInHours: 30 },
          { n: 1, status: 'accepted', startsInHours: 60 },
          { n: 1, status: 'accepted', startsInHours: -60 },
          { n: 1, status: 'declined', startsInHours: 80 },
        ],
      );
      const [pending, future, past, declined] = w.sessionIds as [string, string, string, string];
      expect((await value(w.repo.cancelSession(pending))).status).toBe('cancelled');
      const cancelled = await value(w.repo.cancelSession(future));
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledAt).toBeTruthy();
      for (const id of [pending, past, declined]) {
        expect((await failure(w.repo.cancelSession(id))).code).toBe('state_conflict');
      }
      expect(
        (await failure(w.repo.cancelSession('00000000-0000-0000-0000-00000000dead'))).kind,
      ).toBe('not-found');
      await w.close?.();
    });
  });
}
