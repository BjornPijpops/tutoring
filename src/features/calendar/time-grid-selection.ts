import type { Interval } from '../../core/domain/interval';
import { wallTimeToInstant, type IsoDate } from '../../core/domain/local-time';
import { TUTOR_TIME_ZONE, TUTORING_HOURS, SLOT_MINUTES } from '../../core/domain/tutoring-hours';
import type { LocalTimeRange } from './time-grid-model';

const OPEN = TUTORING_HOURS.openHour * 60;
const CLOSE = TUTORING_HOURS.closeHour * 60;

/** Snaps minutes to the nearest half-hour and keeps it within the day. */
export function snapMinutes(minutes: number): number {
  return Math.max(
    0,
    Math.min(24 * 60 - SLOT_MINUTES, Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES),
  );
}

/** Number of 30-minute cells between opening and closing time. */
export const CELLS_PER_DAY = (CLOSE - OPEN) / SLOT_MINUTES;

/** Converts inclusive cell indexes (in any order) to a local selection; one cell by default. */
export function selectionFromCells(
  date: IsoDate,
  startIndex: number,
  endIndex = startIndex,
): LocalTimeRange {
  const start = OPEN + Math.min(startIndex, endIndex) * SLOT_MINUTES;
  const end = OPEN + (Math.max(startIndex, endIndex) + 1) * SLOT_MINUTES;
  return { date, startMinutes: start, endMinutes: end };
}

/** Validates and clips a same-day selection to tutoring hours. */
export function validateSelection(range: LocalTimeRange): {
  readonly range?: LocalTimeRange;
  readonly error?: string;
  readonly clipped: boolean;
} {
  if (range.endMinutes <= range.startMinutes)
    return { error: 'Enter an end time after the start time.', clipped: false };
  if (range.startMinutes >= CLOSE || range.endMinutes <= OPEN)
    return { error: 'Choose a time between 08:00 and 22:00.', clipped: false };
  const clipped = range.startMinutes < OPEN || range.endMinutes > CLOSE;
  return {
    range: {
      ...range,
      startMinutes: Math.max(OPEN, range.startMinutes),
      endMinutes: Math.min(CLOSE, range.endMinutes),
    },
    clipped,
  };
}

/** Converts a valid local range to UTC without fixed offset arithmetic. */
export function localRangeToInterval(range: LocalTimeRange): Interval {
  return {
    startsAt: wallTimeToInstant(
      range.date,
      Math.floor(range.startMinutes / 60),
      range.startMinutes % 60,
      TUTOR_TIME_ZONE,
    ),
    endsAt: wallTimeToInstant(
      range.date,
      Math.floor(range.endMinutes / 60),
      range.endMinutes % 60,
      TUTOR_TIME_ZONE,
    ),
  };
}

/**
 * Maps a pointer's vertical position to a 30-minute cell index. The grid body spans
 * `[top, top + height)`; positions outside it clamp to the first or last cell.
 */
export function cellIndexFromPointer(
  clientY: number,
  top: number,
  height: number,
  cells = CELLS_PER_DAY,
): number {
  if (height <= 0) return 0;
  const index = Math.floor(((clientY - top) / height) * cells);
  return Math.max(0, Math.min(cells - 1, index));
}

/**
 * One-hour default for a touch tap, clamped so it never passes closing time. Pass
 * `extend: false` when the next cell is not free, so a tap on a free cell next to a blocked
 * one still selects a valid half hour.
 */
export function touchSelectionFromCell(
  date: IsoDate,
  index: number,
  extend = true,
): LocalTimeRange {
  return selectionFromCells(date, index, extend ? Math.min(index + 1, CELLS_PER_DAY - 1) : index);
}
