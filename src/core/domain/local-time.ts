import { TZDate } from '@date-fns/tz';
import { fromMs, toMs, type IsoDateTime } from './interval';

/** Calendar date without a time zone, `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True for a real calendar date in `YYYY-MM-DD` form. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().startsWith(value);
}

function utcMsOfDate(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** The date `days` after (or before, when negative) `date`. Pure calendar arithmetic. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(utcMsOfDate(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: IsoDate): IsoDate {
  const weekday = new Date(utcMsOfDate(date)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** The seven dates of the week starting on `weekStart`. */
export function weekDates(weekStart: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/**
 * The UTC instant at which the wall clock in `timeZone` shows `hour:minute` on `date`.
 * Uses the zone's real offset on that date, so DST days are handled correctly.
 */
export function wallTimeToInstant(
  date: IsoDate,
  hour: number,
  minute: number,
  timeZone: string,
): IsoDateTime {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return fromMs(new TZDate(year, month - 1, day, hour, minute, 0, 0, timeZone).getTime());
}

/** Local midnight at the start of `date` in `timeZone`. */
export function startOfLocalDay(date: IsoDate, timeZone: string): IsoDateTime {
  return wallTimeToInstant(date, 0, 0, timeZone);
}

/** The calendar date shown on the wall clock in `timeZone` at `instant`. */
export function localDateOf(instant: IsoDateTime, timeZone: string): IsoDate {
  const local = new TZDate(toMs(instant), timeZone);
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${String(local.getFullYear())}-${month}-${day}`;
}

/** Hour and minute shown on the wall clock in `timeZone` at `instant`. */
export function localTimeOf(
  instant: IsoDateTime,
  timeZone: string,
): { readonly hour: number; readonly minute: number } {
  const local = new TZDate(toMs(instant), timeZone);
  return { hour: local.getHours(), minute: local.getMinutes() };
}
