import { err, ok } from '../../core/domain/result';
import { overlaps, type Interval } from '../../core/domain/interval';
import { validateSessionRequestRange } from '../../core/domain/session-request-rules';
import type {
  SessionDecision,
  SessionDecisionResult,
  SessionRequest,
  TutorSessionRequest,
} from '../../core/domain/session-request';
import type { PortResult, SessionRequestRepository } from '../../core/ports';
import {
  DEFAULT_ACTOR,
  fixedClock,
  forbiddenUnlessTutor,
  notFound,
  sequentialIds,
  type Actor,
  type Clock,
  type IdGenerator,
} from './support';

interface Options {
  readonly availability?: {
    find(id: string): { status: string } | undefined;
    setStatus(id: string, status: 'open' | 'booked'): void;
  };
  readonly actor?: Actor;
  readonly seed?: readonly SessionRequest[];
  readonly nextId?: IdGenerator;
  readonly now?: Clock;
}
const validationMessage: Record<string, string> = {
  'duration-too-short': 'Choose a session of at least 30 minutes.',
  'duration-too-long': 'Choose a session of no more than 2 hours.',
  'not-aligned': 'Choose a start and end time on the 30-minute grid.',
  'outside-hours': 'Choose a time on one day between 08:00 and 22:00.',
  'too-soon': 'Requests must be made at least 24 hours in advance.',
  'too-far': 'Requests can be made up to 30 days ahead.',
  'invalid-range': 'Choose a valid time range.',
  'ambiguous-local-time': 'This time range spans a clock change. Choose a different time.',
};

/** Deterministic offline adapter; database concurrency is provided by Postgres. */
export class InMemorySessionRequestRepository implements SessionRequestRepository {
  private readonly requests = new Map<string, SessionRequest>();
  private readonly actor: Actor;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;
  private readonly availability?: Options['availability'];
  constructor({ availability, actor = DEFAULT_ACTOR, seed = [], nextId, now }: Options) {
    this.availability = availability;
    this.actor = actor;
    this.nextId = nextId ?? sequentialIds('session-request');
    this.now = now ?? fixedClock();
    seed.forEach((request) => this.requests.set(request.id, request));
  }
  create(input: Interval | string): PortResult<SessionRequest> {
    if (typeof input === 'string') {
      const slot = this.availability?.find(input);
      if (!slot) return Promise.resolve(err(notFound('Slot', input)));
      if (slot.status === 'booked')
        return Promise.resolve(err({ kind: 'conflict', message: 'This slot is already booked.' }));
      const now = this.now();
      const value: SessionRequest = {
        id: this.nextId(),
        slotId: input,
        userId: this.actor.id,
        startsAt: now,
        endsAt: new Date(Date.parse(now) + 3600000).toISOString(),
        status: 'pending',
        createdAt: now,
      };
      this.requests.set(value.id, value);
      return Promise.resolve(ok(value));
    }
    const code = validateSessionRequestRange(input, new Date(this.now()));
    if (code)
      return Promise.resolve(
        err({
          kind: 'validation',
          message: validationMessage[code] ?? 'Choose a valid time range.',
        }),
      );
    const pending = [...this.requests.values()].filter(
      (r) => r.userId === this.actor.id && r.status === 'pending',
    ).length;
    if (pending >= 3)
      return Promise.resolve(
        err({
          kind: 'conflict',
          code: 'pending_limit',
          message:
            'You already have 3 pending requests. Wait for a decision or cancel one before requesting another.',
        }),
      );
    if ([...this.requests.values()].some((r) => r.status === 'accepted' && overlaps(r, input)))
      return Promise.resolve(
        err({
          kind: 'conflict',
          code: 'schedule_unavailable',
          message: 'This time is no longer available. Choose another time.',
        }),
      );
    const created: SessionRequest = {
      ...input,
      id: this.nextId(),
      userId: this.actor.id,
      status: 'pending',
      createdAt: this.now(),
    };
    this.requests.set(created.id, created);
    return Promise.resolve(ok(created));
  }
  listMine(range?: Interval): PortResult<readonly SessionRequest[]> {
    return Promise.resolve(
      ok(
        [...this.requests.values()].filter(
          (r) => r.userId === this.actor.id && (!range || overlaps(r, range)),
        ),
      ),
    );
  }
  listPending(): PortResult<readonly TutorSessionRequest[]> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    return Promise.resolve(
      ok(
        [...this.requests.values()]
          .filter((r) => r.status === 'pending')
          .map((r) => ({ ...r, requesterName: r.userId, requesterEmail: '' })),
      ),
    );
  }
  listAccepted(range: Interval): PortResult<readonly TutorSessionRequest[]> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    return Promise.resolve(
      ok(
        [...this.requests.values()]
          .filter((r) => r.status === 'accepted' && overlaps(r, range))
          .map((r) => ({ ...r, requesterName: r.userId, requesterEmail: '' })),
      ),
    );
  }
  decide(id: string, decision: SessionDecision): PortResult<SessionDecisionResult> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    const current = this.requests.get(id);
    if (!current) return Promise.resolve(err(notFound('Session request', id)));
    if (current.status !== 'pending')
      return Promise.resolve(
        err({
          kind: 'conflict',
          code: 'state_conflict',
          message: 'This request is no longer pending.',
        }),
      );
    let overlapDeclinedCount = 0;
    if (decision === 'accepted') {
      if (current.slotId && this.availability)
        this.availability.setStatus(current.slotId, 'booked');
      if (
        [...this.requests.values()].some(
          (r) => r.id !== id && r.status === 'accepted' && overlaps(r, current),
        )
      )
        return Promise.resolve(
          err({
            kind: 'conflict',
            code: 'schedule_unavailable',
            message:
              'This request can no longer be accepted because the time is unavailable. Review the request and try again.',
          }),
        );
      for (const request of this.requests.values())
        if (request.id !== id && request.status === 'pending' && overlaps(request, current)) {
          this.requests.set(request.id, { ...request, status: 'declined' });
          overlapDeclinedCount++;
        }
    }
    const updated = { ...current, status: decision };
    this.requests.set(id, updated);
    return Promise.resolve(ok({ request: updated, overlapDeclinedCount }));
  }
  cancel(id: string): PortResult<SessionRequest> {
    const current = this.requests.get(id);
    if (!current) return Promise.resolve(err(notFound('Session request', id)));
    if (current.userId !== this.actor.id)
      return Promise.resolve(
        err({ kind: 'forbidden', message: 'You cannot cancel this request.' }),
      );
    if (current.status !== 'pending' && current.status !== 'accepted')
      return Promise.resolve(
        err({
          kind: 'conflict',
          code: 'state_conflict',
          message: 'This request cannot be cancelled.',
        }),
      );
    const updated = { ...current, status: 'cancelled' as const, cancelledAt: this.now() };
    this.requests.set(id, updated);
    return Promise.resolve(ok(updated));
  }
}
