import type { Interval, TimeRange } from '../domain/interval';
import type { PortResult } from './port-error';

/** Read access to when the tutor is busy, without any event details. */
export interface BlockedTimeRepository {
  /** Merged event intervals intersecting `range` (closed hours are not included). */
  listBlockedIntervals(range: TimeRange): PortResult<readonly Interval[]>;
}
