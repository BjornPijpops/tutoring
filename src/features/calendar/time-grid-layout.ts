import { toMs } from '../../core/domain/interval';
import { wallTimeToInstant, type IsoDate } from '../../core/domain/local-time';
import { SLOT_MINUTES, TUTOR_TIME_ZONE, TUTORING_HOURS } from '../../core/domain/tutoring-hours';

import type { GridBlock } from './time-grid-model';

/** A block positioned inside one day column of the grid. */
export interface PlacedBlock {
  readonly block: GridBlock;
  /** Zero-based first row and exclusive end row, in 30-minute cells. */
  readonly startRow: number;
  readonly endRow: number;
  /** Side-by-side lane of the event inside its overlap cluster. */
  readonly lane: number;
  readonly lanes: number;
  /** Number of events (including this one) in its overlap cluster. */
  readonly clusterSize: number;
}

const MINUTE_MS = 60_000;

/**
 * Places the events that intersect the open hours of `date`. Events that overlap in time form
 * a cluster; each gets its own lane so all stay visible and operable.
 */
export function placeDayBlocks(
  date: IsoDate,
  blocks: readonly GridBlock[],
): readonly PlacedBlock[] {
  const open = toMs(wallTimeToInstant(date, TUTORING_HOURS.openHour, 0, TUTOR_TIME_ZONE));
  const openMinutes = (TUTORING_HOURS.closeHour - TUTORING_HOURS.openHour) * 60;
  const items = blocks
    .map((block) => ({
      block,
      start: Math.max(0, (toMs(block.startsAt) - open) / MINUTE_MS),
      end: Math.min(openMinutes, (toMs(block.endsAt) - open) / MINUTE_MS),
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const placed: PlacedBlock[] = [];
  let cluster: { item: (typeof items)[number]; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  const flush = () => {
    cluster.forEach(({ item, lane }) => {
      placed.push({
        block: item.block,
        startRow: Math.floor(item.start / SLOT_MINUTES),
        endRow: Math.ceil(item.end / SLOT_MINUTES),
        lane,
        lanes: laneEnds.length,
        clusterSize: cluster.length,
      });
    });
    cluster = [];
    laneEnds = [];
  };
  items.forEach((item) => {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    clusterEnd = cluster.length === 0 ? item.end : Math.max(clusterEnd, item.end);
    cluster.push({ item, lane });
  });
  flush();
  return placed;
}
