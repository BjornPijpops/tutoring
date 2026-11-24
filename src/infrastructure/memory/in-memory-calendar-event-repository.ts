import {
  validateNewEvent,
  type CalendarEvent,
  type NewCalendarEvent,
} from '../../core/domain/calendar-event';
import { overlaps, toMs, type TimeRange } from '../../core/domain/interval';
import { err, ok } from '../../core/domain/result';
import type { CalendarEventRepository, PortResult } from '../../core/ports';
import { notFound, sequentialIds, type IdGenerator } from './support';

interface Options {
  readonly seed?: readonly CalendarEvent[];
  readonly nextId?: IdGenerator;
}

/** In-memory {@link CalendarEventRepository} for tests and offline UI work. */
export class InMemoryCalendarEventRepository implements CalendarEventRepository {
  private readonly events = new Map<string, CalendarEvent>();
  private readonly nextId: IdGenerator;

  constructor({ seed = [], nextId }: Options = {}) {
    this.nextId = nextId ?? sequentialIds('event');
    seed.forEach((event) => this.events.set(event.id, event));
  }

  listEvents(range: TimeRange): PortResult<readonly CalendarEvent[]> {
    const interval = { startsAt: range.from, endsAt: range.to };
    return Promise.resolve(ok(this.snapshot().filter((event) => overlaps(event, interval))));
  }

  addEvents(events: readonly NewCalendarEvent[]): PortResult<readonly CalendarEvent[]> {
    for (const event of events) {
      const problem = validateNewEvent(event);
      if (problem) return Promise.resolve(err({ kind: 'validation', message: problem }));
    }
    const added: CalendarEvent[] = [];
    for (const event of events) {
      if (event.externalId !== undefined && this.hasExternalId(event)) continue;
      const saved: CalendarEvent = { ...event, id: this.nextId() };
      this.events.set(saved.id, saved);
      added.push(saved);
    }
    return Promise.resolve(ok(added));
  }

  removeEvent(id: string): PortResult<void> {
    if (!this.events.delete(id)) return Promise.resolve(err(notFound('Event', id)));
    return Promise.resolve(ok(undefined));
  }

  removeImportedEvents(): PortResult<void> {
    for (const event of this.snapshot()) {
      if (event.source === 'ics') this.events.delete(event.id);
    }
    return Promise.resolve(ok(undefined));
  }

  /** All stored events ordered by start; shared with the in-memory blocked-time repository. */
  snapshot(): readonly CalendarEvent[] {
    return [...this.events.values()].sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt));
  }

  private hasExternalId(candidate: NewCalendarEvent): boolean {
    return [...this.events.values()].some(
      (event) => event.source === candidate.source && event.externalId === candidate.externalId,
    );
  }
}
