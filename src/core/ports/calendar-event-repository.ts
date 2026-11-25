import type { CalendarEvent, NewCalendarEvent } from '../domain/calendar-event';
import type { EventChanges } from '../domain/event-changes';
import type { TimeRange } from '../domain/interval';
import type { RecurrenceRule, RecurrenceScope } from '../domain/recurrence';
import type { PortResult } from './port-error';

/** A new repeating series: the display rule plus the occurrences expanded from it. */
export interface NewCalendarSeries {
  readonly rule: RecurrenceRule;
  readonly title: string;
  readonly occurrences: readonly Pick<NewCalendarEvent, 'startsAt' | 'endsAt'>[];
}

export interface AddedSeries {
  readonly seriesId: string;
  readonly occurrenceCount: number;
}

export interface UpdatedEvent {
  /** The event that was passed in, after the change. */
  readonly event: CalendarEvent;
  /** How many events the scope reached. */
  readonly affectedCount: number;
  /** The series the event belongs to after the change; a split creates a new one. */
  readonly seriesId?: string;
}

export interface RemovedEvents {
  readonly affectedCount: number;
}

/** Persistence of calendar events. Admin only: events carry titles. */
export interface CalendarEventRepository {
  /** Events intersecting `range`, ordered by start. */
  listEvents(range: TimeRange): PortResult<readonly CalendarEvent[]>;
  /** Stores events idempotently for imported external ids. */
  addEvents(events: readonly NewCalendarEvent[]): PortResult<readonly CalendarEvent[]>;
  /** Stores a repeating series and its occurrences in one step. */
  addSeries(series: NewCalendarSeries): PortResult<AddedSeries>;
  /** The display rule of a series. */
  getSeries(seriesId: string): PortResult<RecurrenceRule>;
  /**
   * Updates a manual event only when its version still matches. `changes` default to the times and
   * title of `event`. Scopes other than `this` need a series event and never move dates.
   */
  updateEvent(
    event: CalendarEvent,
    expectedUpdatedAt: string,
    scope?: RecurrenceScope,
    changes?: EventChanges,
  ): PortResult<UpdatedEvent>;
  /** Removes one event, this and the following events of its series, or the whole series. */
  removeEvent(id: string, scope?: RecurrenceScope): PortResult<RemovedEvents>;
  /** Removes every event imported from a calendar file. */
  removeImportedEvents(): PortResult<void>;
}
