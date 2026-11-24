import type { CalendarEvent, NewCalendarEvent } from '../domain/calendar-event';
import type { TimeRange } from '../domain/interval';
import type { PortResult } from './port-error';

/** Persistence of calendar events. Admin only: events carry titles. */
export interface CalendarEventRepository {
  /** Events intersecting `range`, ordered by start. */
  listEvents(range: TimeRange): PortResult<readonly CalendarEvent[]>;
  /**
   * Stores events. Imported events whose `(source, externalId)` already exist are left
   * unchanged and not returned again, so re-importing a file is idempotent.
   */
  addEvents(events: readonly NewCalendarEvent[]): PortResult<readonly CalendarEvent[]>;
  /** Removes one event. */
  removeEvent(id: string): PortResult<void>;
  /** Removes every event that was imported from a calendar file; manual events stay. */
  removeImportedEvents(): PortResult<void>;
}
