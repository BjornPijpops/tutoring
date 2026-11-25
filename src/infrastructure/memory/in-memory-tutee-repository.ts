import { err, ok } from '../../core/domain/result';
import type { SessionRequest } from '../../core/domain/session-request';
import {
  TUTEE_PAGE_DEFAULT,
  TUTEE_PAGE_MAX,
  TUTEE_SEARCH_MAX,
  type SessionPolicy,
  type TuteeAction,
  type TuteeActionResult,
  type TuteeDetail,
  type TuteeEvent,
  type TuteeList,
  type TuteeListQuery,
  type TuteeStatus,
  type TuteeSummary,
} from '../../core/domain/tutee';
import { nextAccessState } from '../../core/domain/tutee-transitions';
import type { PortError, PortResult, TuteeRepository } from '../../core/ports';
import { DEFAULT_ACTOR, fixedClock, forbiddenUnlessTutor, type Actor, type Clock } from './support';

export interface InMemoryTuteeOptions {
  readonly actor?: Actor;
  readonly seed?: readonly TuteeSummary[];
  readonly now?: Clock;
  readonly sessions?: readonly SessionRequest[];
}

type Row = TuteeSummary & { message: string };

const STATUSES: readonly TuteeStatus[] = ['pending', 'approved', 'denied', 'revoked', 'blocked'];
const NOT_FOUND: PortError = { kind: 'not-found', message: 'Tutee was not found.' };
const CONFLICT: PortError = {
  kind: 'conflict',
  code: 'state_conflict',
  message: 'This tutee changed elsewhere.',
};
const INVALID: PortError = { kind: 'validation', message: 'The request was not valid.' };
const POLICIES: readonly string[] = ['keep', 'cancel_all'];

/**
 * In-memory tutee management. It follows the same rules as the SQL functions (state machine,
 * counts, ordering, limits); the shared contract suite runs against both.
 */
export class InMemoryTuteeRepository implements TuteeRepository {
  private readonly rows = new Map<string, Row>();
  private readonly events = new Map<string, TuteeEvent[]>();
  private readonly sessions: SessionRequest[];
  private readonly actor: Actor;
  private readonly now: Clock;
  private eventSeq = 0;

  constructor(options: InMemoryTuteeOptions = {}) {
    this.actor = options.actor ?? DEFAULT_ACTOR;
    this.now = options.now ?? fixedClock();
    this.sessions = [...(options.sessions ?? [])];
    for (const seed of options.seed ?? []) this.rows.set(seed.userId, { ...seed, message: '' });
  }

  private count(userId: string, status: 'pending' | 'accepted') {
    const now = this.now();
    return this.sessions.filter(
      (s) =>
        s.userId === userId &&
        s.status === status &&
        (status === 'pending' || Date.parse(s.startsAt) > Date.parse(now)),
    ).length;
  }

  private summary(row: Row): TuteeSummary {
    return {
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt,
      requestedAt: row.requestedAt,
      decidedAt: row.decidedAt,
      nextRequestAt: row.nextRequestAt,
      requestCount: row.requestCount,
      pendingSessions: this.count(row.userId, 'pending'),
      acceptedFutureSessions: this.count(row.userId, 'accepted'),
    };
  }

  list(query: TuteeListQuery): PortResult<TuteeList> {
    const denied = forbiddenUnlessTutor(this.actor);
    if (denied) return Promise.resolve(err(denied));
    const search = (query.search ?? '').trim().toLocaleLowerCase();
    const offset = query.offset ?? 0;
    if (
      search.length > TUTEE_SEARCH_MAX ||
      offset < 0 ||
      (query.status !== undefined && !STATUSES.includes(query.status))
    )
      return Promise.resolve(err(INVALID));
    const limit = Math.min(Math.max(query.limit ?? TUTEE_PAGE_DEFAULT, 1), TUTEE_PAGE_MAX);
    const matched = [...this.rows.values()].filter(
      (row) =>
        !search ||
        row.displayName.toLocaleLowerCase().includes(search) ||
        row.email.toLocaleLowerCase().includes(search),
    );
    const counts: Record<TuteeStatus | 'all', number> = {
      pending: 0,
      approved: 0,
      denied: 0,
      revoked: 0,
      blocked: 0,
      all: matched.length,
    };
    for (const row of matched) counts[row.status]++;
    const filtered = matched
      .filter((row) => !query.status || row.status === query.status)
      .sort(
        (a, b) =>
          Number(b.status === 'pending') - Number(a.status === 'pending') ||
          Date.parse(b.requestedAt) - Date.parse(a.requestedAt) ||
          a.userId.localeCompare(b.userId),
      );
    return Promise.resolve(
      ok({
        items: filtered.slice(offset, offset + limit).map((row) => this.summary(row)),
        total: filtered.length,
        counts,
      }),
    );
  }

  get(userId: string): PortResult<TuteeDetail> {
    const denied = forbiddenUnlessTutor(this.actor);
    if (denied) return Promise.resolve(err(denied));
    const row = this.rows.get(userId);
    if (!row) return Promise.resolve(err(NOT_FOUND));
    const events = [...(this.events.get(userId) ?? [])].reverse().slice(0, 50);
    const all = this.events.get(userId) ?? [];
    return Promise.resolve(
      ok({
        tutee: { ...this.summary(row), message: row.message },
        sessions: this.sessions
          .filter((s) => s.userId === userId)
          .sort(
            (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt) || a.id.localeCompare(b.id),
          )
          .slice(0, 20)
          .map((s) => ({
            id: s.id,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            status: s.status,
            createdAt: s.createdAt,
            decidedAt: s.decidedAt ?? null,
            cancelledAt: s.cancelledAt ?? null,
          })),
        events,
        historyStartsAt: all[0]?.createdAt ?? null,
      }),
    );
  }

  act(
    userId: string,
    action: TuteeAction,
    policy: SessionPolicy = 'keep',
  ): PortResult<TuteeActionResult> {
    const denied = forbiddenUnlessTutor(this.actor);
    if (denied) return Promise.resolve(err(denied));
    if (
      userId === this.actor.id ||
      !POLICIES.includes(policy) ||
      (policy === 'cancel_all' && action !== 'revoke' && action !== 'block')
    )
      return Promise.resolve(err(INVALID));
    const row = this.rows.get(userId);
    if (!row) return Promise.resolve(err(NOT_FOUND));
    const now = this.now();
    const transition = nextAccessState(row.status, action, now);
    if (!transition.ok) return Promise.resolve(err(CONFLICT));

    let pending = 0;
    let cancelled = 0;
    if (action === 'revoke' || action === 'block') {
      this.sessions.forEach((s, index) => {
        if (s.userId !== userId) return;
        if (s.status === 'pending') {
          this.sessions[index] = { ...s, status: 'declined', decidedAt: now, updatedAt: now };
          pending++;
        } else if (
          policy === 'cancel_all' &&
          s.status === 'accepted' &&
          Date.parse(s.startsAt) > Date.parse(now)
        ) {
          this.sessions[index] = { ...s, status: 'cancelled', cancelledAt: now, updatedAt: now };
          cancelled++;
        }
      });
    }
    this.rows.set(userId, {
      ...row,
      status: transition.value.status,
      decidedAt: transition.value.decidedAt,
      nextRequestAt: transition.value.nextRequestAt,
    });
    this.record(userId, {
      action: transition.value.auditAction,
      fromStatus: row.status,
      toStatus: transition.value.status,
      sessionsEnded: pending + cancelled,
      createdAt: now,
    });
    return Promise.resolve(
      ok({
        status: transition.value.status,
        pendingDeclined: pending,
        acceptedCancelled: cancelled,
      }),
    );
  }

  allowAgain(userId: string): PortResult<void> {
    const denied = forbiddenUnlessTutor(this.actor);
    if (denied) return Promise.resolve(err(denied));
    const row = this.rows.get(userId);
    if (!row || (row.status !== 'denied' && row.status !== 'revoked'))
      return Promise.resolve(err(NOT_FOUND));
    if (!row.nextRequestAt) return Promise.resolve(err(CONFLICT));
    this.rows.set(userId, { ...row, nextRequestAt: null });
    this.record(userId, {
      action: 'cooldown_reset',
      fromStatus: row.status,
      toStatus: row.status,
      sessionsEnded: 0,
      createdAt: this.now(),
    });
    return Promise.resolve(ok(undefined));
  }

  cancelSession(requestId: string): PortResult<SessionRequest> {
    const denied = forbiddenUnlessTutor(this.actor);
    if (denied) return Promise.resolve(err(denied));
    const index = this.sessions.findIndex((s) => s.id === requestId);
    const session = this.sessions[index];
    if (!session)
      return Promise.resolve(err({ kind: 'not-found', message: 'Session was not found.' }));
    const now = this.now();
    const cancellable =
      session.status === 'pending' ||
      (session.status === 'accepted' && Date.parse(session.startsAt) > Date.parse(now));
    if (!cancellable)
      return Promise.resolve(err({ ...CONFLICT, message: 'This session cannot be cancelled.' }));
    const updated: SessionRequest = {
      ...session,
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
    };
    this.sessions[index] = updated;
    return Promise.resolve(ok(updated));
  }

  private record(userId: string, event: Omit<TuteeEvent, 'id'>) {
    this.eventSeq += 1;
    this.events.set(userId, [
      ...(this.events.get(userId) ?? []),
      { id: String(this.eventSeq), ...event },
    ]);
  }
}
