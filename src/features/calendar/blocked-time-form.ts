import {
  MAX_TITLE_LENGTH,
  validateNewEvent,
  type NewCalendarEvent,
} from '../../core/domain/calendar-event';
import { isIsoDate, wallTimeToInstant } from '../../core/domain/local-time';
import { TUTOR_TIME_ZONE, TUTORING_HOURS } from '../../core/domain/tutoring-hours';

/** Raw values of the add-blocked-time form. */
export interface BlockedTimeFormValues {
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly title: string;
}

/** Fields that can carry a validation message. */
export type BlockedTimeField = 'date' | 'start' | 'end' | 'title';

/** Outcome of validating the form. */
export interface BlockedTimeValidation {
  readonly errors: Readonly<Partial<Record<BlockedTimeField, string>>>;
  /** Present when there are no errors. */
  readonly event?: NewCalendarEvent;
  /** True when part of the range lies outside tutoring hours (informational). */
  readonly partlyClosed: boolean;
}

const OPEN = TUTORING_HOURS.openHour * 60;
const CLOSE = TUTORING_HOURS.closeHour * 60;

function parseTime(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : undefined;
}

/** Validates the form values and, when valid, builds the event to store. */
export function validateBlockedTimeForm(values: BlockedTimeFormValues): BlockedTimeValidation {
  const errors: Partial<Record<BlockedTimeField, string>> = {};
  const date = values.date.trim();
  const start = parseTime(values.start);
  const end = parseTime(values.end);
  const title = values.title.trim();

  if (!isIsoDate(date)) errors.date = 'Enter a date.';
  if (start === undefined) errors.start = 'Enter a start time.';
  if (end === undefined) errors.end = 'Enter an end time.';
  if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Title must be ${String(MAX_TITLE_LENGTH)} characters or fewer.`;
  }

  let partlyClosed = false;
  if (start !== undefined && end !== undefined) {
    if (end <= start) {
      errors.end =
        'End time must be after the start time. To block past midnight, add a second entry for the next day.';
    } else if (start >= CLOSE || end <= OPEN) {
      errors.end = `This time is already closed (${pad(OPEN)}-${pad(CLOSE)} is the only open time), so there is nothing to block.`;
    } else {
      partlyClosed = start < OPEN || end > CLOSE;
    }
  }

  if (Object.keys(errors).length > 0 || start === undefined || end === undefined) {
    return { errors, partlyClosed };
  }
  const event: NewCalendarEvent = {
    startsAt: wallTimeToInstant(date, Math.floor(start / 60), start % 60, TUTOR_TIME_ZONE),
    endsAt: wallTimeToInstant(date, Math.floor(end / 60), end % 60, TUTOR_TIME_ZONE),
    title,
    source: 'manual',
  };
  const problem = validateNewEvent(event);
  return problem ? { errors: { end: problem }, partlyClosed } : { errors, event, partlyClosed };
}

function pad(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
