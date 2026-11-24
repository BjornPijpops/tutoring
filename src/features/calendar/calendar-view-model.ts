import type { CalendarEvent } from '../../core/domain/calendar-event';
import { clipInterval, mergeIntervals } from '../../core/domain/blocked-intervals';
import {
  fromMs,
  overlaps,
  toMs,
  type Interval,
  type IsoDateTime,
} from '../../core/domain/interval';
import {
  addDays,
  startOfLocalDay,
  wallTimeToInstant,
  type IsoDate,
} from '../../core/domain/local-time';
import { SLOT_MINUTES, TUTOR_TIME_ZONE, TUTORING_HOURS } from '../../core/domain/tutoring-hours';

const SLOT_MS = SLOT_MINUTES * 60_000;

/** Whether an open half hour is free, covered completely, or covered in part. */
export type CellState = 'free' | 'blocked' | 'partial';

/** One half hour inside tutoring hours. */
export interface OpenCell extends Interval {
  /** Start time as shown in the row header, e.g. `08:30`. */
  readonly label: string;
  readonly state: CellState;
  /** Title of the event that starts the block here (admin only). */
  readonly title?: string;
  /** Number of further events overlapping this cell (admin only). */
  readonly moreCount: number;
}

/** A stretch of the day for the list layout. */
export interface Segment extends Interval {
  readonly kind: 'free' | 'blocked' | 'closed';
  readonly title?: string;
}

/** Everything the calendar needs to draw one day. */
export interface DayModel {
  readonly date: IsoDate;
  readonly isToday: boolean;
  readonly closedBefore: Interval;
  readonly closedAfter: Interval;
  readonly openCells: readonly OpenCell[];
  readonly segments: readonly Segment[];
}

/** Input of {@link buildWeekModel}. */
export interface WeekModelInput {
  readonly weekStart: IsoDate;
  readonly today: IsoDate;
  /** Merged blocked intervals of the week (without closed hours). */
  readonly blocked: readonly Interval[];
  /** Events with titles; only given to the tutor. Titles never come from `blocked`. */
  readonly events?: readonly CalendarEvent[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function slotLabel(index: number): string {
  const minutes = TUTORING_HOURS.openHour * 60 + index * SLOT_MINUTES;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function coveredMs(range: Interval, blocked: readonly Interval[]): number {
  return blocked.reduce((sum, interval) => {
    const clipped = clipInterval(interval, { from: range.startsAt, to: range.endsAt });
    return clipped ? sum + toMs(clipped.endsAt) - toMs(clipped.startsAt) : sum;
  }, 0);
}

/** Builds the model of one local day. Pure: all times are computed in Brussels. */
function buildDay(
  date: IsoDate,
  today: IsoDate,
  blocked: readonly Interval[],
  events: readonly CalendarEvent[],
): DayModel {
  const dayStart = startOfLocalDay(date, TUTOR_TIME_ZONE);
  const dayEnd = startOfLocalDay(addDays(date, 1), TUTOR_TIME_ZONE);
  const open = wallTimeToInstant(date, TUTORING_HOURS.openHour, 0, TUTOR_TIME_ZONE);
  const close = wallTimeToInstant(date, TUTORING_HOURS.closeHour, 0, TUTOR_TIME_ZONE);
  const openInterval: Interval = { startsAt: open, endsAt: close };
  const dayBlocked = mergeIntervals(blocked, { from: open, to: close });
  const dayEvents = events
    .filter((event) => overlaps(event, openInterval))
    .sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt));

  const cellCount = ((TUTORING_HOURS.closeHour - TUTORING_HOURS.openHour) * 60) / SLOT_MINUTES;
  const titled = new Set<string>();
  const openCells: OpenCell[] = Array.from({ length: cellCount }, (_, index) => {
    const startsAt = fromMs(toMs(open) + index * SLOT_MS);
    const endsAt = fromMs(toMs(startsAt) + SLOT_MS);
    const cell: Interval = { startsAt, endsAt };
    const covered = coveredMs(cell, dayBlocked);
    const state: CellState = covered === 0 ? 'free' : covered >= SLOT_MS ? 'blocked' : 'partial';

    const inCell = dayEvents.filter((event) => overlaps(event, cell));
    const starter = inCell.find((event) => !titled.has(event.id));
    inCell.forEach((event) => titled.add(event.id));
    return {
      ...cell,
      label: slotLabel(index),
      state,
      ...(starter ? { title: starter.title } : {}),
      moreCount: Math.max(0, inCell.length - 1),
    };
  });

  const segments: Segment[] = [
    { kind: 'closed', startsAt: dayStart, endsAt: open },
    ...openSegments(openInterval, dayBlocked, dayEvents),
    { kind: 'closed', startsAt: close, endsAt: dayEnd },
  ];

  return {
    date,
    isToday: date === today,
    closedBefore: { startsAt: dayStart, endsAt: open },
    closedAfter: { startsAt: close, endsAt: dayEnd },
    openCells,
    segments,
  };
}

function openSegments(
  open: Interval,
  blocked: readonly Interval[],
  events: readonly CalendarEvent[],
): Segment[] {
  const segments: Segment[] = [];
  let cursor = open.startsAt;
  const push = (kind: 'free' | 'blocked', startsAt: IsoDateTime, endsAt: IsoDateTime) => {
    if (toMs(endsAt) <= toMs(startsAt)) return;
    const title = events
      .filter((event) => overlaps(event, { startsAt, endsAt }))
      .map((event) => event.title)
      .filter((value) => value !== '')
      .join(', ');
    segments.push({ kind, startsAt, endsAt, ...(kind === 'blocked' && title ? { title } : {}) });
  };
  for (const interval of blocked) {
    push('free', cursor, interval.startsAt);
    push('blocked', interval.startsAt, interval.endsAt);
    cursor = interval.endsAt;
  }
  push('free', cursor, open.endsAt);
  return segments;
}

/** Seven days, Monday first, ready to render as a table or a list. */
export function buildWeekModel({
  weekStart,
  today,
  blocked,
  events = [],
}: WeekModelInput): readonly DayModel[] {
  return Array.from({ length: 7 }, (_, index) =>
    buildDay(addDays(weekStart, index), today, blocked, events),
  );
}

/** The instant range covering the seven local days from `weekStart`. */
export function weekRange(weekStart: IsoDate): {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
} {
  return {
    from: startOfLocalDay(weekStart, TUTOR_TIME_ZONE),
    to: startOfLocalDay(addDays(weekStart, 7), TUTOR_TIME_ZONE),
  };
}
