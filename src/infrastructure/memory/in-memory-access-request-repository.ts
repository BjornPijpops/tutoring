import {
  ACCESS_COOLDOWN_HOURS,
  ACCESS_MESSAGE_MAX_LENGTH,
  MAX_PENDING_REQUESTS,
  type AccessDecision,
  type AccessRequest,
  type AccessRequestFilter,
  type AccessRequestSummary,
} from '../../core/domain/access-request';
import { fromMs, toMs } from '../../core/domain/interval';
import { err, ok, type Result } from '../../core/domain/result';
import type { AccessRequestRepository, PortError, PortResult } from '../../core/ports';
import {
  DEFAULT_ACTOR,
  fixedClock,
  forbiddenUnlessTutor,
  notFound,
  type Actor,
  type Clock,
} from './support';

const HOUR_MS = 3_600_000;

/** Name and e-mail the tutor sees for a user. */
export interface Person {
  readonly displayName: string;
  readonly email: string;
}

/** A stored request: what the tutor sees plus when it was first created. */
interface Stored extends AccessRequestSummary {
  readonly createdAt: string;
}

/** Requests shared by repository views acting as different users. */
interface Store {
  readonly requests: Map<string, Stored>;
  readonly events: { readonly userId: string; readonly requestedAt: string }[];
}

interface Options {
  readonly actor?: Actor;
  readonly seed?: readonly AccessRequestSummary[];
  /** Who the users are, by id; unknown ids get a generated example name and e-mail. */
  readonly people?: Readonly<Record<string, Person>>;
  readonly now?: Clock;
  /** Internal: used by {@link InMemoryAccessRequestRepository.as}. */
  readonly store?: Store;
}

const CLOSED: PortError = {
  kind: 'conflict',
  code: 'access_requests_closed',
  message: 'Access requests are paused.',
};
const COOLDOWN: PortError = {
  kind: 'conflict',
  code: 'cooldown_active',
  message: 'You cannot ask again yet.',
};

function toAccessRequest(stored: Stored): AccessRequest {
  return {
    id: stored.userId,
    userId: stored.userId,
    status: stored.status,
    message: stored.message,
    createdAt: stored.createdAt,
    requestedAt: stored.requestedAt,
    decidedAt: stored.decidedAt,
    nextRequestAt: stored.nextRequestAt,
    requestCount: stored.requestCount,
  };
}

/**
 * In-memory {@link AccessRequestRepository} with the same rules as the database: one request
 * per user, an eight hour cooldown after a denial, a cap on pending requests, and tutor-only
 * actions. Use {@link as} to act as another user on the same data.
 */
export class InMemoryAccessRequestRepository implements AccessRequestRepository {
  private readonly store: Store;
  private readonly actor: Actor;
  private readonly people: Readonly<Record<string, Person>>;
  private readonly now: Clock;

  constructor({ actor = DEFAULT_ACTOR, seed = [], people = {}, now, store }: Options = {}) {
    this.actor = actor;
    this.people = people;
    this.now = now ?? fixedClock();
    this.store = store ?? { requests: new Map(), events: [] };
    seed.forEach((request) => {
      this.store.requests.set(request.userId, { ...request, createdAt: request.requestedAt });
    });
  }

  /** A view of the same requests acting as `actor`. */
  as(actor: Actor): InMemoryAccessRequestRepository {
    return new InMemoryAccessRequestRepository({
      actor,
      people: this.people,
      now: this.now,
      store: this.store,
    });
  }

  /** Number of "new request" notification events recorded so far. */
  get notificationCount(): number {
    return this.store.events.length;
  }

  requestAccess(message: string): PortResult<AccessRequest> {
    const trimmed = message.trim();
    if (this.actor.role === 'tutor') {
      return this.fail({ kind: 'forbidden', message: 'The tutor cannot ask for access.' });
    }
    if (trimmed.length > ACCESS_MESSAGE_MAX_LENGTH) {
      return this.fail({ kind: 'validation', message: 'The message is too long.' });
    }
    const current = this.store.requests.get(this.actor.id);
    if (!current) return this.result(this.createRequest(trimmed));
    if (current.status !== 'denied') return this.result(ok(toAccessRequest(current)));
    const cooling =
      current.nextRequestAt !== null && toMs(current.nextRequestAt) > toMs(this.now());
    return cooling ? this.fail(COOLDOWN) : this.result(this.askAgain(current, trimmed));
  }

  getMine(): PortResult<AccessRequest | null> {
    const mine = this.store.requests.get(this.actor.id);
    return this.result(ok(mine ? toAccessRequest(mine) : null));
  }

  listRequests(status?: AccessRequestFilter): PortResult<readonly AccessRequestSummary[]> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return this.fail(forbidden);
    const rank = (request: Stored) => (request.status === 'pending' ? 0 : 1);
    const listed = [...this.store.requests.values()]
      .filter((request) => status === undefined || request.status === status)
      .sort((a, b) => rank(a) - rank(b) || toMs(b.requestedAt) - toMs(a.requestedAt))
      .slice(0, 200)
      .map(({ createdAt: _createdAt, ...summary }) => summary);
    return this.result(ok(listed));
  }

  decide(userId: string, decision: AccessDecision): PortResult<AccessRequest> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return this.fail(forbidden);
    const current = this.store.requests.get(userId);
    if (!current) return this.fail(notFound('Access request', userId));
    const now = this.now();
    return this.result(
      this.save({
        ...current,
        status: decision,
        decidedAt: now,
        nextRequestAt:
          decision === 'denied' ? fromMs(toMs(now) + ACCESS_COOLDOWN_HOURS * HOUR_MS) : null,
      }),
    );
  }

  allowRequestAgain(userId: string): PortResult<AccessRequest> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return this.fail(forbidden);
    const current = this.store.requests.get(userId);
    if (current?.status !== 'denied') return this.fail(notFound('Denied access request', userId));
    return this.result(this.save({ ...current, nextRequestAt: null }));
  }

  private createRequest(message: string): Result<AccessRequest, PortError> {
    const pending = [...this.store.requests.values()].filter((r) => r.status === 'pending');
    if (pending.length >= MAX_PENDING_REQUESTS) return err(CLOSED);
    const now = this.now();
    const person = this.people[this.actor.id] ?? {
      displayName: this.actor.id,
      email: `${this.actor.id}@example.test`,
    };
    this.store.events.push({ userId: this.actor.id, requestedAt: now });
    return this.save({
      userId: this.actor.id,
      ...person,
      message,
      status: 'pending',
      createdAt: now,
      requestedAt: now,
      decidedAt: null,
      nextRequestAt: null,
      requestCount: 1,
    });
  }

  private askAgain(current: Stored, message: string): Result<AccessRequest, PortError> {
    const now = this.now();
    this.store.events.push({ userId: current.userId, requestedAt: now });
    return this.save({
      ...current,
      message,
      status: 'pending',
      requestedAt: now,
      decidedAt: null,
      nextRequestAt: null,
      requestCount: current.requestCount + 1,
    });
  }

  private save(stored: Stored): Result<AccessRequest, PortError> {
    this.store.requests.set(stored.userId, stored);
    return ok(toAccessRequest(stored));
  }

  private result<T>(value: Result<T, PortError>): PortResult<T> {
    return Promise.resolve(value);
  }

  private fail<T>(error: PortError): PortResult<T> {
    return Promise.resolve(err(error));
  }
}
