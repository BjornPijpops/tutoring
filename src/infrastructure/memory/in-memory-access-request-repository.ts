import type { AccessDecision, AccessRequest } from '../../core/domain/access-request';
import { err, ok } from '../../core/domain/result';
import type { AccessRequestRepository, PortResult } from '../../core/ports';
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
  readonly actor?: Actor;
  readonly seed?: readonly AccessRequest[];
  readonly nextId?: IdGenerator;
  readonly now?: Clock;
}

/** In-memory {@link AccessRequestRepository} for tests and offline UI work. */
export class InMemoryAccessRequestRepository implements AccessRequestRepository {
  private readonly requests = new Map<string, AccessRequest>();
  private readonly actor: Actor;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor({ actor = DEFAULT_ACTOR, seed = [], nextId, now }: Options = {}) {
    this.actor = actor;
    this.nextId = nextId ?? sequentialIds('access-request');
    this.now = now ?? fixedClock();
    seed.forEach((request) => this.requests.set(request.id, request));
  }

  request(): PortResult<AccessRequest> {
    const existing = this.findByUser(this.actor.id);
    if (existing) {
      return Promise.resolve(
        err({ kind: 'conflict', message: 'An access request already exists.' }),
      );
    }
    const created: AccessRequest = {
      id: this.nextId(),
      userId: this.actor.id,
      status: 'pending',
      createdAt: this.now(),
    };
    this.requests.set(created.id, created);
    return Promise.resolve(ok(created));
  }

  getMine(): PortResult<AccessRequest | null> {
    return Promise.resolve(ok(this.findByUser(this.actor.id) ?? null));
  }

  listPending(): PortResult<readonly AccessRequest[]> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    const pending = [...this.requests.values()].filter((r) => r.status === 'pending');
    return Promise.resolve(ok(pending));
  }

  decide(id: string, decision: AccessDecision): PortResult<AccessRequest> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    const current = this.requests.get(id);
    if (!current) return Promise.resolve(err(notFound('Access request', id)));
    const decided: AccessRequest = { ...current, status: decision };
    this.requests.set(id, decided);
    return Promise.resolve(ok(decided));
  }

  private findByUser(userId: string): AccessRequest | undefined {
    return [...this.requests.values()].find((r) => r.userId === userId);
  }
}
