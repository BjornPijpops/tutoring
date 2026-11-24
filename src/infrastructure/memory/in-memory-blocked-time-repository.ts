import { mergeIntervals } from '../../core/domain/blocked-intervals';
import type { Interval, TimeRange } from '../../core/domain/interval';
import { ok } from '../../core/domain/result';
import type { BlockedTimeRepository, PortResult } from '../../core/ports';
import type { InMemoryCalendarEventRepository } from './in-memory-calendar-event-repository';

/**
 * In-memory {@link BlockedTimeRepository} derived from an in-memory event repository.
 * Returns merged intervals only: no titles, ids or counts.
 */
export class InMemoryBlockedTimeRepository implements BlockedTimeRepository {
  constructor(private readonly events: InMemoryCalendarEventRepository) {}

  listBlockedIntervals(range: TimeRange): PortResult<readonly Interval[]> {
    return Promise.resolve(ok(mergeIntervals(this.events.snapshot(), range)));
  }
}
