import type { CalendarEvent } from './calendar-event';
import { localDateOf, localTimeOf, type IsoDate } from './local-time';
import type { RecurrenceScope } from './recurrence';
import { TUTOR_TIME_ZONE } from './tutoring-hours';

/** What an edit changes, as Brussels wall-clock values; omitted fields stay as they are. */
export interface EventChanges {
  readonly title?: string;
  /** Only allowed when the scope is `this`. */
  readonly date?: IsoDate;
  readonly startMinutes?: number;
  readonly endMinutes?: number;
}

function minutesOf(instant: string): number {
  const { hour, minute } = localTimeOf(instant, TUTOR_TIME_ZONE);
  return hour * 60 + minute;
}

/** The changes that turn the stored event into `event`; the date only travels with scope `this`. */
export function eventChangesOf(event: CalendarEvent, scope: RecurrenceScope): EventChanges {
  return {
    title: event.title,
    ...(scope === 'this' ? { date: localDateOf(event.startsAt, TUTOR_TIME_ZONE) } : {}),
    startMinutes: minutesOf(event.startsAt),
    endMinutes: minutesOf(event.endsAt),
  };
}
