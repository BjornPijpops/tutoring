import { err, ok } from '../../core/domain/result';
import type { SessionDecision, SessionRequest } from '../../core/domain/session-request';
import type { PortResult, SessionRequestRepository } from '../../core/ports';
import type { InMemoryAvailabilityRepository } from './in-memory-availability-repository';
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
  readonly availability: InMemoryAvailabilityRepository;
  readonly actor?: Actor;
  readonly seed?: readonly SessionRequest[];
  readonly nextId?: IdGenerator;
  readonly now?: Clock;
}

/** In-memory {@link SessionRequestRepository}; accepting a request books its slot. */
export class InMemorySessionRequestRepository implements SessionRequestRepository {
  private readonly requests = new Map<string, SessionRequest>();
  private readonly availability: InMemoryAvailabilityRepository;
  private readonly actor: Actor;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor({ availability, actor = DEFAULT_ACTOR, seed = [], nextId, now }: Options) {
    this.availability = availability;
    this.actor = actor;
    this.nextId = nextId ?? sequentialIds('session-request');
    this.now = now ?? fixedClock();
    seed.forEach((request) => this.requests.set(request.id, request));
  }

  create(slotId: string): PortResult<SessionRequest> {
    const slot = this.availability.find(slotId);
    if (!slot) return Promise.resolve(err(notFound('Slot', slotId)));
    if (slot.status === 'booked') {
      return Promise.resolve(err({ kind: 'conflict', message: 'This slot is already booked.' }));
    }
    const created: SessionRequest = {
      id: this.nextId(),
      slotId,
      userId: this.actor.id,
      status: 'pending',
      createdAt: this.now(),
    };
    this.requests.set(created.id, created);
    return Promise.resolve(ok(created));
  }

  listMine(): PortResult<readonly SessionRequest[]> {
    const mine = [...this.requests.values()].filter((r) => r.userId === this.actor.id);
    return Promise.resolve(ok(mine));
  }

  listPending(): PortResult<readonly SessionRequest[]> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    const pending = [...this.requests.values()].filter((r) => r.status === 'pending');
    return Promise.resolve(ok(pending));
  }

  decide(id: string, decision: SessionDecision): PortResult<SessionRequest> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    const current = this.requests.get(id);
    if (!current) return Promise.resolve(err(notFound('Session request', id)));
    if (decision === 'accepted') {
      if (this.availability.find(current.slotId)?.status === 'booked') {
        return Promise.resolve(err({ kind: 'conflict', message: 'This slot is already booked.' }));
      }
      this.availability.setStatus(current.slotId, 'booked');
    }
    const decided: SessionRequest = { ...current, status: decision };
    this.requests.set(id, decided);
    return Promise.resolve(ok(decided));
  }
}
