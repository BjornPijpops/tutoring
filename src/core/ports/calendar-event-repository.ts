import type { CalendarEvent, NewCalendarEvent } from '../domain/calendar-event';
import type { TimeRange } from '../domain/interval';
import type { PortResult } from './port-error';

/** Persistence of calendar events. Admin only: events carry titles. */
export interface CalendarEventRepository {
  /** Events intersecting `range`, ordered by start. */
  listEvents(range: TimeRange): PortResult<readonly CalendarEvent[]>;
  /** Stores events idempotently for imported external ids. */
  addEvents(events: readonly NewCalendarEvent[]): PortResult<readonly CalendarEvent[]>;
  /** Updates a manual event only when its version still matches. */
  updateEvent(event: CalendarEvent, expectedUpdatedAt: string): PortResult<CalendarEvent>;
  /** Removes one event. */
  removeEvent(id: string): PortResult<void>;
  /** Removes every event imported from a calendar file. */
  removeImportedEvents(): PortResult<void>;
}
