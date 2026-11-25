import { isIsoDate, type IsoDate } from '../../core/domain/local-time';
import {
  RECURRENCE_MAX_COUNT,
  RECURRENCE_MIN_COUNT,
  addMonths,
  expandRecurrence,
  formatRecurrenceSummary,
  latestRecurrenceDate,
  recurrenceProblem,
  type RecurrenceField,
  type RecurrenceRule,
  type Weekday,
} from '../../core/domain/recurrence';

export type RepeatChoice = 'none' | 'weekly' | 'weekdays' | 'custom';
export type RepeatEndKind = 'until' | 'count';

/** What the Repeat part of the dialog holds; text fields stay strings until validated. */
export interface RepeatFormValues {
  readonly choice: RepeatChoice;
  readonly intervalWeeks: string;
  readonly weekdays: readonly Weekday[];
  readonly weekdaysTouched: boolean;
  readonly endKind: RepeatEndKind;
  readonly endDate: string;
  readonly endDateTouched: boolean;
  readonly count: string;
}

/** Keys of the repeat errors; the dialog shows them next to the matching control. */
export type RepeatErrorKey =
  'repeatInterval' | 'repeatWeekdays' | 'repeatEndDate' | 'repeatCount' | 'repeatEnd';
export type RepeatErrors = Readonly<Partial<Record<RepeatErrorKey | 'date', string>>>;

/** When and how long the event is; the repeat rule is built on top of it. */
export interface RepeatBase {
  readonly date: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const SHORT_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DEFAULT_COUNT = 10;
const DEFAULT_END_MONTHS = 3;
const MON_TO_FRI: readonly Weekday[] = [1, 2, 3, 4, 5];
const PROBLEM_KEYS: Readonly<Record<RecurrenceField, RepeatErrorKey | 'date' | undefined>> = {
  date: 'date',
  // Time problems are reported by the base form (clipping and ordering).
  time: undefined,
  interval: 'repeatInterval',
  weekdays: 'repeatWeekdays',
  endDate: 'repeatEndDate',
  count: 'repeatCount',
  end: 'repeatEnd',
};

export const shortWeekdayName = (weekday: Weekday): string => SHORT_NAMES[weekday - 1] ?? '';
export const fullWeekdayName = (weekday: Weekday): string => FULL_NAMES[weekday - 1] ?? '';

/** ISO weekday (Monday is 1) of `date`, or `undefined` for an invalid date. */
export function weekdayOf(date: string): Weekday | undefined {
  if (!isIsoDate(date)) return undefined;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

/** Start date plus three months, never past the 12-month limit; empty without a valid date. */
export function defaultEndDate(startDate: string, today: IsoDate): string {
  if (!isIsoDate(startDate)) return '';
  const suggestion = addMonths(startDate, DEFAULT_END_MONTHS);
  const latest = latestRecurrenceDate(today);
  return suggestion > latest ? latest : suggestion;
}

/** Repeat values for a new event: does not repeat, with the end ready for when it does. */
export function defaultRepeatValues(date: string, today: IsoDate): RepeatFormValues {
  const weekday = weekdayOf(date);
  return {
    choice: 'none',
    intervalWeeks: '1',
    weekdays: weekday ? [weekday] : [],
    weekdaysTouched: false,
    endKind: 'until',
    endDate: defaultEndDate(date, today),
    endDateTouched: false,
    count: String(DEFAULT_COUNT),
  };
}

/** Options of the Repeat select, in display order. */
export function repeatOptions(date: string): readonly { value: RepeatChoice; label: string }[] {
  const weekday = weekdayOf(date);
  return [
    { value: 'none', label: 'Does not repeat' },
    {
      value: 'weekly',
      label: `Every week on ${weekday ? fullWeekdayName(weekday) : 'this weekday'}`,
    },
    { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
    { value: 'custom', label: 'Custom\u2026' },
  ];
}

/** Keeps defaults that follow the date (weekday, end date) in step when the date changes. */
export function followDate(
  values: RepeatFormValues,
  date: string,
  today: IsoDate,
): RepeatFormValues {
  const weekday = weekdayOf(date);
  let weekdays = values.weekdays;
  if (weekday !== undefined && (!values.weekdaysTouched || weekdays.length === 0)) {
    weekdays = values.weekdaysTouched ? [...weekdays, weekday] : [weekday];
  }
  const endDate = values.endDateTouched ? values.endDate : defaultEndDate(date, today);
  return { ...values, weekdays, endDate };
}

/** Checks or unchecks a weekday of the custom pattern. */
export function toggleWeekday(
  values: RepeatFormValues,
  weekday: Weekday,
  checked: boolean,
): RepeatFormValues {
  const rest = values.weekdays.filter((day) => day !== weekday);
  const weekdays = checked ? [...rest, weekday].sort((a, b) => a - b) : rest;
  return { ...values, weekdays, weekdaysTouched: true };
}

function weekdaysFor(values: RepeatFormValues, date: string): readonly Weekday[] {
  if (values.choice === 'weekdays') return MON_TO_FRI;
  if (values.choice === 'weekly') {
    const weekday = weekdayOf(date);
    return weekday ? [weekday] : [];
  }
  return values.weekdays;
}

/** The rule the dialog describes; fields that are not valid numbers become invalid values. */
export function ruleFromRepeat(values: RepeatFormValues, base: RepeatBase): RecurrenceRule {
  const custom = values.choice === 'custom';
  return {
    startDate: base.date,
    intervalWeeks: custom ? Number(values.intervalWeeks.trim() || Number.NaN) : 1,
    weekdays: weekdaysFor(values, base.date),
    startMinutes: base.startMinutes,
    endMinutes: base.endMinutes,
    end:
      values.endKind === 'until'
        ? { kind: 'until', date: values.endDate }
        : { kind: 'count', count: Number(values.count.trim() || Number.NaN) },
  };
}

/** Field errors of a repeating event; empty when the event does not repeat or is valid. */
export function validateRepeat(
  values: RepeatFormValues,
  base: RepeatBase,
  today: IsoDate,
): { readonly errors: RepeatErrors; readonly rule?: RecurrenceRule } {
  if (values.choice === 'none') return { errors: {} };
  const rule = ruleFromRepeat(values, base);
  const found = recurrenceProblem(rule, today);
  if (!found) return { errors: {}, rule };
  const key = PROBLEM_KEYS[found.field];
  return { errors: key ? { [key]: found.message } : {} };
}

/** Sentence under the End fieldset, e.g. "Weekly on Tue until 28 Feb 2027 (14 events)". */
export function repeatSummary(
  values: RepeatFormValues,
  base: RepeatBase | undefined,
  today: IsoDate,
): string {
  const incomplete = 'Choose how this event repeats to see a summary.';
  if (!base || values.choice === 'none') return incomplete;
  const rule = ruleFromRepeat(values, base);
  return recurrenceProblem(rule, today) ? incomplete : formatRecurrenceSummary(rule, today);
}

/** Number of events the rule creates, or `undefined` while it is not valid. */
export function repeatEventCount(
  values: RepeatFormValues,
  base: RepeatBase | undefined,
  today: IsoDate,
): number | undefined {
  if (!base || values.choice === 'none') return undefined;
  const rule = ruleFromRepeat(values, base);
  return recurrenceProblem(rule, today)
    ? undefined
    : expandRecurrence(rule, today).occurrences.length;
}

export const REPEAT_COUNT_LIMITS = { min: RECURRENCE_MIN_COUNT, max: RECURRENCE_MAX_COUNT };
