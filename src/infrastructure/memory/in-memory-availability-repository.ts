import type {
  AvailabilitySlot,
  NewAvailabilitySlot,
  TimeRange,
} from '../../core/domain/availability-slot';
import { err, ok } from '../../core/domain/result';
import type { AvailabilityRepository, PortResult } from '../../core/ports';
import {
  DEFAULT_ACTOR,
  forbiddenUnlessTutor,
  notFound,
  sequentialIds,
  type Actor,
  type IdGenerator,
} from './support';

interface Options {
  readonly actor?: Actor;
  readonly seed?: readonly AvailabilitySlot[];
  readonly nextId?: IdGenerator;
}

/**
 * In-memory {@link AvailabilityRepository} for tests and offline UI work.
 * Also exposes {@link find} and {@link setStatus} so the in-memory session
 * request repository can share its slots.
 */
export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  private readonly slots = new Map<string, AvailabilitySlot>();
  private readonly actor: Actor;
  private readonly nextId: IdGenerator;

  constructor({ actor = DEFAULT_ACTOR, seed = [], nextId }: Options = {}) {
    this.actor = actor;
    this.nextId = nextId ?? sequentialIds('slot');
    seed.forEach((slot) => this.slots.set(slot.id, slot));
  }

  listSlots(range: TimeRange): PortResult<readonly AvailabilitySlot[]> {
    const inRange = [...this.slots.values()]
      .filter((slot) => slot.startsAt >= range.from && slot.startsAt < range.to)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return Promise.resolve(ok(inRange));
  }

  upsertSlot(slot: NewAvailabilitySlot): PortResult<AvailabilitySlot> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    if (slot.startsAt >= slot.endsAt) {
      return Promise.resolve(
        err({ kind: 'validation', message: 'A slot must end after it starts.' }),
      );
    }
    const existing = slot.id === undefined ? undefined : this.slots.get(slot.id);
    if (slot.id !== undefined && !existing) {
      return Promise.resolve(err(notFound('Slot', slot.id)));
    }
    const saved: AvailabilitySlot = {
      id: existing?.id ?? this.nextId(),
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: existing?.status ?? 'open',
    };
    this.slots.set(saved.id, saved);
    return Promise.resolve(ok(saved));
  }

  removeSlot(id: string): PortResult<void> {
    const forbidden = forbiddenUnlessTutor(this.actor);
    if (forbidden) return Promise.resolve(err(forbidden));
    if (!this.slots.delete(id)) return Promise.resolve(err(notFound('Slot', id)));
    return Promise.resolve(ok(undefined));
  }

  /** Looks up a slot by id. */
  find(id: string): AvailabilitySlot | undefined {
    return this.slots.get(id);
  }

  /** Changes the status of an existing slot; no-op for unknown ids. */
  setStatus(id: string, status: AvailabilitySlot['status']): void {
    const slot = this.slots.get(id);
    if (slot) this.slots.set(id, { ...slot, status });
  }
}
