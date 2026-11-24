import {
  isValidInterval,
  fromMs,
  toMs,
  type Interval,
  type IsoDateTime,
  type TimeRange,
} from './interval';
import { addDays, localDateOf, startOfLocalDay, wallTimeToInstant } from './local-time';
import { TUTOR_TIME_ZONE, TUTORING_HOURS, type TutoringHours } from './tutoring-hours';

/** Intersection of an interval with a range, or `null` when they do not overlap. */
export function clipInterval(interval: Interval, range: TimeRange): Interval | null {
  const start = Math.max(toMs(interval.startsAt), toMs(range.from));
  const end = Math.min(toMs(interval.endsAt), toMs(range.to));
  return end > start ? { startsAt: fromMs(start), endsAt: fromMs(end) } : null;
}

/**
 * Sorts intervals and merges those that overlap or touch.
 * Invalid or empty intervals are dropped; with a `range`, intervals are clipped to it first.
 */
export function mergeIntervals(
  intervals: readonly Interval[],
  range?: TimeRange,
): readonly Interval[] {
  const usable = intervals
    .filter(isValidInterval)
    .map((interval) => (range ? clipInterval(interval, range) : interval))
    .filter((interval): interval is Interval => interval !== null)
    .map((interval) => ({ start: toMs(interval.startsAt), end: toMs(interval.endsAt) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: { start: number; end: number }[] = [];
  for (const current of usable) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged.map(({ start, end }) => ({ startsAt: fromMs(start), endsAt: fromMs(end) }));
}

/**
 * Closed hours (before opening and after closing, in `timeZone`) that fall inside `range`.
 * Computed per local date, so days with a DST change have their real length.
 */
export function closedHoursIntervals(
  range: TimeRange,
  hours: TutoringHours = TUTORING_HOURS,
  timeZone: string = TUTOR_TIME_ZONE,
): readonly Interval[] {
  if (!(toMs(range.to) > toMs(range.from))) return [];
  const first = localDateOf(range.from, timeZone);
  const last = localDateOf(fromMs(toMs(range.to) - 1), timeZone);

  const closed: Interval[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    closed.push(
      {
        startsAt: startOfLocalDay(date, timeZone),
        endsAt: wallTimeToInstant(date, hours.openHour, 0, timeZone),
      },
      {
        startsAt: wallTimeToInstant(date, hours.closeHour, 0, timeZone),
        endsAt: startOfLocalDay(addDays(date, 1), timeZone),
      },
    );
  }
  return mergeIntervals(closed, range);
}

/** Inputs of {@link blockedIntervals}. */
export interface BlockedIntervalsInput {
  readonly range: TimeRange;
  readonly eventIntervals: readonly Interval[];
  readonly hours?: TutoringHours;
  readonly timeZone?: string;
}

/** Everything unavailable inside `range`: closed hours united with events, merged and clipped. */
export function blockedIntervals({
  range,
  eventIntervals,
  hours = TUTORING_HOURS,
  timeZone = TUTOR_TIME_ZONE,
}: BlockedIntervalsInput): readonly Interval[] {
  return mergeIntervals(
    [...closedHoursIntervals(range, hours, timeZone), ...eventIntervals],
    range,
  );
}

/** True when `instant` lies inside one of the (half-open) intervals. */
export function isBlocked(intervals: readonly Interval[], instant: IsoDateTime): boolean {
  const at = toMs(instant);
  return intervals.some((interval) => toMs(interval.startsAt) <= at && at < toMs(interval.endsAt));
}

/** The parts of `range` that are not covered by `blocked`. */
export function freeIntervals(range: TimeRange, blocked: readonly Interval[]): readonly Interval[] {
  const free: Interval[] = [];
  let cursor = toMs(range.from);
  const end = toMs(range.to);
  for (const interval of mergeIntervals(blocked, range)) {
    const start = toMs(interval.startsAt);
    if (start > cursor) free.push({ startsAt: fromMs(cursor), endsAt: fromMs(start) });
    cursor = Math.max(cursor, toMs(interval.endsAt));
  }
  if (cursor < end) free.push({ startsAt: fromMs(cursor), endsAt: fromMs(end) });
  return free;
}
