import { MAX_TITLE_LENGTH, type NewCalendarEvent } from '../../core/domain/calendar-event';
import type { EventChanges } from '../../core/domain/event-changes';
import { isIsoDate, wallTimeToInstant, type IsoDate } from '../../core/domain/local-time';
import { TUTOR_TIME_ZONE, TUTORING_HOURS } from '../../core/domain/tutoring-hours';
import type { RepeatBase } from './repeat-form';

export interface CalendarEventFormValues {
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly title: string;
}
export type CalendarEventFormErrors = Readonly<
  Partial<Record<'date' | 'start' | 'end' | 'title', string>>
>;
export interface CalendarEventFormResult {
  readonly errors: CalendarEventFormErrors;
  readonly event?: NewCalendarEvent;
  readonly clipped: boolean;
  /** Form values after clipping to open hours; only set when `clipped` is true. */
  readonly clippedValues?: CalendarEventFormValues;
}

function minutes(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? result : undefined;
}
function time(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
/** Validates dialog values and maps them to a UTC manual event. */
export function validateCalendarEventForm(
  values: CalendarEventFormValues,
): CalendarEventFormResult {
  const errors: Partial<Record<'date' | 'start' | 'end' | 'title', string>> = {};
  const date = values.date.trim();
  const start = minutes(values.start);
  const end = minutes(values.end);
  const title = values.title.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'Enter a date.';
  if (start === undefined) errors.start = 'Enter a start time.';
  if (end === undefined) errors.end = 'Enter an end time.';
  if (title.length > MAX_TITLE_LENGTH)
    errors.title = `Enter a title of ${String(MAX_TITLE_LENGTH)} characters or fewer.`;
  if (start !== undefined && end !== undefined) {
    if (end <= start) errors.end = 'Enter an end time after the start time.';
    else if (start >= TUTORING_HOURS.closeHour * 60 || end <= TUTORING_HOURS.openHour * 60)
      errors.end = 'Choose a time between 08:00 and 22:00.';
  }
  if (Object.keys(errors).length || start === undefined || end === undefined)
    return { errors, clipped: false };
  const clipped = start < TUTORING_HOURS.openHour * 60 || end > TUTORING_HOURS.closeHour * 60;
  const clippedStart = Math.max(start, TUTORING_HOURS.openHour * 60);
  const clippedEnd = Math.min(end, TUTORING_HOURS.closeHour * 60);
  return {
    errors,
    event: {
      startsAt: wallTimeToInstant(
        date,
        Math.floor(clippedStart / 60),
        clippedStart % 60,
        TUTOR_TIME_ZONE,
      ),
      endsAt: wallTimeToInstant(
        date,
        Math.floor(clippedEnd / 60),
        clippedEnd % 60,
        TUTOR_TIME_ZONE,
      ),
      title,
      source: 'manual',
    },
    clipped,
    ...(clipped ? { clippedValues: valuesForEvent(date, clippedStart, clippedEnd, title) } : {}),
  };
}
export function valuesForEvent(
  date: IsoDate,
  start: number,
  end: number,
  title: string,
): CalendarEventFormValues {
  return { date, start: time(start), end: time(end), title };
}

/** Only the fields of `current` that differ from `initial`, as Brussels wall-clock values. */
export function changesBetween(
  initial: CalendarEventFormValues,
  current: CalendarEventFormValues,
): EventChanges {
  const start = minutes(current.start);
  const end = minutes(current.end);
  return {
    ...(current.title.trim() !== initial.title.trim() ? { title: current.title.trim() } : {}),
    ...(current.date !== initial.date ? { date: current.date } : {}),
    ...(current.start !== initial.start && start !== undefined ? { startMinutes: start } : {}),
    ...(current.end !== initial.end && end !== undefined ? { endMinutes: end } : {}),
  };
}

/** The date, start and end as the repeat rule needs them; `undefined` while any is invalid. */
export function repeatBaseOf(values: CalendarEventFormValues): RepeatBase | undefined {
  const start = minutes(values.start);
  const end = minutes(values.end);
  if (!isIsoDate(values.date.trim()) || start === undefined || end === undefined) return undefined;
  return { date: values.date.trim(), startMinutes: start, endMinutes: end };
}
