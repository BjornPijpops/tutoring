import { TZDate } from '@date-fns/tz';
import type { IsoDateTime } from '../../core/domain/interval';
import { toMs } from '../../core/domain/interval';
import { addDays, localDateOf, type IsoDate } from '../../core/domain/local-time';
import { TUTOR_TIME_ZONE } from '../../core/domain/tutoring-hours';

/** Formats the calendar date `date` (no time zone involved) with `options`, in en-GB. */
function formatDate(date: IsoDate, options: Intl.DateTimeFormatOptions): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** "Tue 24 Nov" */
export function formatDayLabel(date: IsoDate): string {
  return formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

/** "24 Nov 2027" */
export function formatShortDate(date: IsoDate): string {
  return formatDate(date, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "09:30" in Brussels time, 24-hour clock. */
export function formatTime(instant: IsoDateTime): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TUTOR_TIME_ZONE,
  }).format(new Date(toMs(instant)));
}

/** "14:00-15:30" in Brussels time. */
export function formatTimeRange(startsAt: IsoDateTime, endsAt: IsoDateTime): string {
  return `${formatTime(startsAt)}-${formatTime(endsAt)}`;
}

/** "Tue 24 Nov, 14:05" in Brussels time. */
export function formatMoment(instant: IsoDateTime): string {
  return `${formatDayLabel(localDateOf(instant, TUTOR_TIME_ZONE))}, ${formatTime(instant)}`;
}

/** "Tue 24 Nov, 14:00-15:30", or both dates when the event spans days. */
export function formatEventWhen(startsAt: IsoDateTime, endsAt: IsoDateTime): string {
  const startDate = localDateOf(startsAt, TUTOR_TIME_ZONE);
  const endDate = localDateOf(endsAt, TUTOR_TIME_ZONE);
  if (startDate === endDate) {
    return `${formatDayLabel(startDate)}, ${formatTimeRange(startsAt, endsAt)}`;
  }
  return `${formatDayLabel(startDate)} ${formatTime(startsAt)} - ${formatDayLabel(endDate)} ${formatTime(endsAt)}`;
}

/** "23 - 29 November 2026", "30 Nov - 6 Dec 2026" or with both years across New Year. */
export function formatWeekRange(weekStart: IsoDate): string {
  const weekEnd = addDays(weekStart, 6);
  const start = weekStart.split('-').map(Number);
  const end = weekEnd.split('-').map(Number);
  if (start[0] !== end[0]) {
    return `${formatShortDate(weekStart)} - ${formatShortDate(weekEnd)}`;
  }
  if (start[1] !== end[1]) {
    const first = formatDate(weekStart, { day: 'numeric', month: 'short' });
    return `${first} - ${formatShortDate(weekEnd)}`;
  }
  const month = formatDate(weekEnd, { month: 'long', year: 'numeric' });
  return `${String(start[2])} - ${String(end[2])} ${month}`;
}

/** Today's date on the Brussels wall clock. */
export function todayInBrussels(now: Date = new Date()): IsoDate {
  return localDateOf(now.toISOString(), TUTOR_TIME_ZONE);
}

function offsetMinutesAtNoon(date: IsoDate): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return -new TZDate(year, month - 1, day, 12, 0, 0, 0, TUTOR_TIME_ZONE).getTimezoneOffset();
}

/** Explains the displayed time zone for the week starting at `weekStart`. */
export function timeZoneNote(weekStart: IsoDate, deviceTimeZone?: string): string {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const offsets = days.map(offsetMinutesAtNoon);
  const changeIndex = offsets.findIndex(
    (offset, index) => index > 0 && offset !== offsets[index - 1],
  );

  let note: string;
  if (changeIndex > 0) {
    // The change happens in the night of the first day whose noon offset differs (a Sunday).
    const changeDate = days[changeIndex] ?? weekStart;
    const label = formatDate(changeDate, { weekday: 'long', day: 'numeric', month: 'long' });
    note = `Times are shown in Brussels time (CET/CEST: clocks change on ${label}).`;
  } else {
    const winter = (offsets[0] ?? 60) === 60;
    note = winter
      ? 'Times are shown in Brussels time (CET, UTC+1).'
      : 'Times are shown in Brussels time (CEST, UTC+2).';
  }
  if (deviceTimeZone && deviceTimeZone !== TUTOR_TIME_ZONE) {
    note += ` Your device is set to ${deviceTimeZone}.`;
  }
  return note;
}

/** "Tutoring hours: 08:00-22:00, every day. Other hours are closed." */
export const TUTORING_HOURS_NOTE =
  'Tutoring hours: 08:00-22:00, every day. Other hours are closed.';
