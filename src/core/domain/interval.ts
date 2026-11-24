import type { TimeRange } from './availability-slot';
import type { IsoDateTime } from './user';

export type { TimeRange } from './availability-slot';
export type { IsoDateTime } from './user';

/** Half-open span of time `[startsAt, endsAt)` between two UTC instants. */
export interface Interval {
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
}

/** Milliseconds since the epoch of an ISO-8601 instant (`NaN` when unparseable). */
export function toMs(instant: IsoDateTime): number {
  return Date.parse(instant);
}

/** Canonical UTC ISO-8601 string without milliseconds, e.g. `2026-01-05T09:00:00Z`. */
export function fromMs(ms: number): IsoDateTime {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/** True when both bounds parse and the interval ends after it starts. */
export function isValidInterval(interval: Interval): boolean {
  const start = toMs(interval.startsAt);
  const end = toMs(interval.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

/** True when both bounds parse and the range ends after it starts. */
export function isValidRange(range: TimeRange): boolean {
  return isValidInterval({ startsAt: range.from, endsAt: range.to });
}

/** Length of the interval in milliseconds. */
export function durationMs(interval: Interval): number {
  return toMs(interval.endsAt) - toMs(interval.startsAt);
}

/** True when two half-open intervals share at least one instant. */
export function overlaps(a: Interval, b: Interval): boolean {
  return toMs(a.startsAt) < toMs(b.endsAt) && toMs(b.startsAt) < toMs(a.endsAt);
}
