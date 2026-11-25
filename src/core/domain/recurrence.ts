import type { IsoDateTime } from './interval';
import { addDays, isIsoDate, startOfWeek, wallTimeToInstant, type IsoDate } from './local-time';
import { SLOT_MINUTES, TUTOR_TIME_ZONE, TUTORING_HOURS } from './tutoring-hours';

/** Fewest and most weeks between two repeats ("every N weeks"). */
export const RECURRENCE_MIN_INTERVAL_WEEKS = 1;
export const RECURRENCE_MAX_INTERVAL_WEEKS = 12;
/** Fewest and most events one series can have. */
export const RECURRENCE_MIN_COUNT = 2;
export const RECURRENCE_MAX_COUNT = 400;
/** A series can reach at most this many calendar months past today. */
export const RECURRENCE_HORIZON_MONTHS = 12;

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Which events an edit or delete of a repeating event reaches. */
export type RecurrenceScope = 'this' | 'following' | 'all';

/** A series always ends: on a date or after a number of events. */
export type RecurrenceEnd =
  | { readonly kind: 'until'; readonly date: IsoDate }
  | { readonly kind: 'count'; readonly count: number };

/** "Every N weeks on these weekdays, at these Brussels wall-clock minutes, until the end." */
export interface RecurrenceRule {
  readonly startDate: IsoDate;
  readonly intervalWeeks: number;
  readonly weekdays: readonly Weekday[];
  /** Minutes after local midnight. */
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly end: RecurrenceEnd;
}

/** One expanded event of a series. */
export interface RecurrenceOccurrence {
  readonly date: IsoDate;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
}

/** All occurrences of a rule, in date order. */
export interface RecurrenceExpansion {
  readonly occurrences: readonly RecurrenceOccurrence[];
  readonly lastDate?: IsoDate;
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function utcDate(date: IsoDate): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`));
}

/** "28 Feb 2027" */
export function formatRecurrenceDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(date));
}

/** `date` plus `months` calendar months, clamped to the end of a shorter month. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const start = utcDate(date);
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

/** The last date a series may reach when it is created on `today`. */
export function latestRecurrenceDate(today: IsoDate): IsoDate {
  return addMonths(today, RECURRENCE_HORIZON_MONTHS);
}

function sortedWeekdays(rule: RecurrenceRule): Weekday[] {
  return [...new Set(rule.weekdays)].sort((a, b) => a - b);
}

function atMinutes(date: IsoDate, minutes: number): IsoDateTime {
  return wallTimeToInstant(date, Math.floor(minutes / 60), minutes % 60, TUTOR_TIME_ZONE);
}

/**
 * Expands `rule` into occurrences. Weeks are Monday-based and counted from the week of the start
 * date; the first occurrence is the first selected weekday on or after the start date. Dates are
 * iterated as calendar dates and converted to instants one by one, so the Brussels wall-clock
 * time is kept across daylight-saving changes. A series never passes `today` + 12 months.
 */
export function expandRecurrence(rule: RecurrenceRule, today: IsoDate): RecurrenceExpansion {
  if (!Number.isInteger(rule.intervalWeeks) || rule.intervalWeeks < RECURRENCE_MIN_INTERVAL_WEEKS) {
    return { occurrences: [] };
  }
  const weekdays = sortedWeekdays(rule);
  const horizon = latestRecurrenceDate(today);
  const lastAllowed =
    rule.end.kind === 'until' && rule.end.date < horizon ? rule.end.date : horizon;
  const limit = rule.end.kind === 'count' ? rule.end.count : Number.POSITIVE_INFINITY;
  const occurrences: RecurrenceOccurrence[] = [];

  for (
    let week = startOfWeek(rule.startDate);
    week <= lastAllowed && occurrences.length < limit;
    week = addDays(week, 7 * rule.intervalWeeks)
  ) {
    for (const weekday of weekdays) {
      const date = addDays(week, weekday - 1);
      if (date < rule.startDate || date > lastAllowed || occurrences.length >= limit) continue;
      occurrences.push({
        date,
        startsAt: atMinutes(date, rule.startMinutes),
        endsAt: atMinutes(date, rule.endMinutes),
      });
    }
  }
  const lastDate = occurrences.at(-1)?.date;
  return lastDate === undefined ? { occurrences } : { occurrences, lastDate };
}

/** The part of a rule a problem belongs to, so a form can show it next to the right control. */
export type RecurrenceField =
  'date' | 'time' | 'interval' | 'weekdays' | 'endDate' | 'count' | 'end';

export interface RecurrenceProblem {
  readonly field: RecurrenceField;
  readonly message: string;
}

const problem = (field: RecurrenceField, message: string): RecurrenceProblem => ({
  field,
  message,
});

function timesProblem(rule: RecurrenceRule): RecurrenceProblem | undefined {
  const opens = TUTORING_HOURS.openHour * 60;
  const closes = TUTORING_HOURS.closeHour * 60;
  const onGrid = (minutes: number) => Number.isInteger(minutes) && minutes % SLOT_MINUTES === 0;
  if (
    !onGrid(rule.startMinutes) ||
    !onGrid(rule.endMinutes) ||
    rule.startMinutes < opens ||
    rule.endMinutes > closes ||
    rule.endMinutes <= rule.startMinutes
  ) {
    return problem('time', 'Choose a time between 08:00 and 22:00.');
  }
  return undefined;
}

function endProblem(rule: RecurrenceRule, today: IsoDate): RecurrenceProblem | undefined {
  const latest = latestRecurrenceDate(today);
  if (rule.end.kind === 'until') {
    if (!isIsoDate(rule.end.date)) return problem('endDate', 'Enter an end date.');
    if (rule.end.date < rule.startDate) {
      return problem(
        'endDate',
        `Choose an end date on or after ${formatRecurrenceDate(rule.startDate)}.`,
      );
    }
    if (rule.end.date > latest) {
      return problem(
        'endDate',
        `Choose an end date on or before ${formatRecurrenceDate(latest)}. Events can repeat for 12 months at most.`,
      );
    }
    return undefined;
  }
  const { count } = rule.end;
  if (!Number.isInteger(count) || count < RECURRENCE_MIN_COUNT || count > RECURRENCE_MAX_COUNT) {
    return problem(
      'count',
      `Enter a number of events from ${String(RECURRENCE_MIN_COUNT)} to ${String(RECURRENCE_MAX_COUNT)}.`,
    );
  }
  return undefined;
}

/**
 * The first problem that stops `rule` from being saved on `today`, with the field it belongs to,
 * or `undefined` when it is valid. A count that would run past the 12-month limit is an error,
 * never silently shortened.
 */
export function recurrenceProblem(
  rule: RecurrenceRule,
  today: IsoDate,
): RecurrenceProblem | undefined {
  if (!isIsoDate(rule.startDate)) return problem('date', 'Enter a date.');
  if (rule.startDate < today) {
    return problem('date', 'Choose today or a later date for a repeating event.');
  }
  if (
    !Number.isInteger(rule.intervalWeeks) ||
    rule.intervalWeeks < RECURRENCE_MIN_INTERVAL_WEEKS ||
    rule.intervalWeeks > RECURRENCE_MAX_INTERVAL_WEEKS
  ) {
    return problem(
      'interval',
      `Enter a number of weeks from ${String(RECURRENCE_MIN_INTERVAL_WEEKS)} to ${String(RECURRENCE_MAX_INTERVAL_WEEKS)}.`,
    );
  }
  if (rule.weekdays.length === 0) return problem('weekdays', 'Choose at least one day.');
  const found = timesProblem(rule) ?? endProblem(rule, today);
  if (found) return found;

  const total = expandRecurrence(rule, today).occurrences.length;
  if (rule.end.kind === 'count' && total < rule.end.count) {
    return problem(
      'count',
      `${String(rule.end.count)} events would run past ${formatRecurrenceDate(latestRecurrenceDate(today))}, the latest date allowed. Choose fewer events or an earlier end.`,
    );
  }
  if (total < RECURRENCE_MIN_COUNT) {
    return problem('end', 'This would create only one event. Choose a later end.');
  }
  if (total > RECURRENCE_MAX_COUNT) {
    return problem(
      'end',
      `This would create ${String(total)} events; at most ${String(RECURRENCE_MAX_COUNT)} are allowed.`,
    );
  }
  return undefined;
}

/** Message of {@link recurrenceProblem}, or `undefined` when `rule` is valid. */
export function validateRecurrence(rule: RecurrenceRule, today: IsoDate): string | undefined {
  return recurrenceProblem(rule, today)?.message;
}

/**
 * Why the stored `rule` cannot describe occurrences on `dates` (any order), or `undefined`: the
 * start date must be within range and not after the first date, an end date must cover the last
 * date and stay within range, and an after-N end must equal the number of dates.
 */
export function ruleOccurrenceProblem(
  rule: RecurrenceRule,
  dates: readonly IsoDate[],
  today: IsoDate,
): string | undefined {
  const sorted = [...dates].sort();
  const [first] = sorted;
  const last = sorted.at(-1);
  const latest = latestRecurrenceDate(today);
  const bad =
    first === undefined ||
    last === undefined ||
    rule.startDate < today ||
    rule.startDate > latest ||
    rule.startDate > first ||
    (rule.end.kind === 'until' &&
      (rule.end.date < rule.startDate || rule.end.date > latest || rule.end.date < last)) ||
    (rule.end.kind === 'count' && rule.end.count !== sorted.length);
  return bad ? 'The repeat pattern does not match the events or the allowed dates.' : undefined;
}

/**
 * Text summary such as "Weekly on Tue, Wed until 12 Mar 2027 (34 events)". Without `withCount`
 * the sentence stops after the date, for describing a stored series.
 */
export function formatRecurrenceSummary(
  rule: RecurrenceRule,
  today: IsoDate,
  withCount = true,
): string {
  const { occurrences, lastDate } = expandRecurrence(rule, today);
  if (lastDate === undefined) return 'Choose how this event repeats to see a summary.';
  const days = sortedWeekdays(rule);
  const everyWeekday =
    rule.intervalWeeks === 1 && days.length === 5 && days.every((day, index) => day === index + 1);
  const cadence = rule.intervalWeeks === 1 ? 'Weekly' : `Every ${String(rule.intervalWeeks)} weeks`;
  const pattern = everyWeekday
    ? 'Every weekday'
    : `${cadence} on ${days.map((day) => WEEKDAY_NAMES[day - 1]).join(', ')}`;
  const until = `${pattern} until ${formatRecurrenceDate(lastDate)}`;
  if (!withCount) return until;
  const count = occurrences.length;
  return `${until} (${String(count)} ${count === 1 ? 'event' : 'events'})`;
}
