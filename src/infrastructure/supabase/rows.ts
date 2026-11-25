import { z } from 'zod';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { fromMs, toMs, type Interval } from '../../core/domain/interval';
import type { RecurrenceRule } from '../../core/domain/recurrence';
import { err, ok, type Result } from '../../core/domain/result';
import type { PortError } from '../../core/ports';

const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));

const eventRowSchema = z.object({
  id: z.string().min(1),
  starts_at: timestamp,
  ends_at: timestamp,
  title: z.string(),
  source: z.enum(['manual', 'ics']),
  external_id: z.string().nullable(),
  updated_at: timestamp.optional(),
  series_id: z.string().nullable().optional(),
  series_index: z.number().int().nonnegative().nullable().optional(),
});

const intervalRowSchema = z.object({ starts_at: timestamp, ends_at: timestamp });

/** Row shape of `public.calendar_events` as used by the app. */
export type CalendarEventRow = z.input<typeof eventRowSchema>;

const MALFORMED: PortError = {
  kind: 'unavailable',
  message: 'The calendar service returned unexpected data.',
};

function canonical(instant: string): string {
  return fromMs(toMs(instant));
}

function mapRows<Row, T>(
  schema: z.ZodType<Row>,
  rows: unknown,
  map: (row: Row) => T,
): Result<readonly T[], PortError> {
  const parsed = z.array(schema).safeParse(rows);
  return parsed.success ? ok(parsed.data.map(map)) : err(MALFORMED);
}

/** Validates and maps `calendar_events` rows to domain events. */
export function mapEventRows(rows: unknown): Result<readonly CalendarEvent[], PortError> {
  return mapRows(eventRowSchema, rows, (row) => ({
    id: row.id,
    startsAt: canonical(row.starts_at),
    endsAt: canonical(row.ends_at),
    title: row.title,
    source: row.source,
    ...(row.external_id === null ? {} : { externalId: row.external_id }),
    ...(row.updated_at ? { updatedAt: canonical(row.updated_at) } : {}),
    ...(row.series_id ? { seriesId: row.series_id } : {}),
    ...(typeof row.series_index === 'number' ? { seriesIndex: row.series_index } : {}),
  }));
}

/** Validates and maps `get_blocked_intervals` rows to domain intervals. */
export function mapIntervalRows(rows: unknown): Result<readonly Interval[], PortError> {
  return mapRows(intervalRowSchema, rows, (row) => ({
    startsAt: canonical(row.starts_at),
    endsAt: canonical(row.ends_at),
  }));
}

const count = z.number().int().nonnegative();
const weekdaySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);
const ruleSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  intervalWeeks: z.number().int().positive(),
  weekdays: z.array(weekdaySchema).min(1),
  startMinutes: z.number().int(),
  endMinutes: z.number().int(),
  end: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('until'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    z.object({ kind: z.literal('count'), count: z.number().int() }),
  ]),
});
const addedSeriesSchema = z.object({ series_id: z.string().min(1), occurrence_count: count });
const updatedRowSchema = z.object({
  affected_count: count,
  series_id: z.string().nullable().optional(),
});
const removedRowSchema = z.object({ affected_count: count });
const seriesRowSchema = z.object({ rule: ruleSchema });

function firstRow<Row>(schema: z.ZodType<Row>, rows: unknown): Result<Row, PortError> {
  const parsed = z.array(schema).min(1).safeParse(rows);
  return parsed.success && parsed.data[0] !== undefined ? ok(parsed.data[0]) : err(MALFORMED);
}

/** Maps the single row of `create_calendar_series`. */
export function mapAddedSeries(
  rows: unknown,
): Result<{ readonly seriesId: string; readonly occurrenceCount: number }, PortError> {
  const row = firstRow(addedSeriesSchema, rows);
  return row.ok
    ? ok({ seriesId: row.value.series_id, occurrenceCount: row.value.occurrence_count })
    : row;
}

/** Maps the single row of `update_calendar_event`. */
export function mapUpdatedRow(
  rows: unknown,
): Result<{ readonly affectedCount: number; readonly seriesId?: string }, PortError> {
  const row = firstRow(updatedRowSchema, rows);
  if (!row.ok) return row;
  const { affected_count: affectedCount, series_id: seriesId } = row.value;
  return ok({ affectedCount, ...(seriesId ? { seriesId } : {}) });
}

/** Maps the single row of `delete_calendar_event`. */
export function mapRemovedRow(
  rows: unknown,
): Result<{ readonly affectedCount: number }, PortError> {
  const row = firstRow(removedRowSchema, rows);
  return row.ok ? ok({ affectedCount: row.value.affected_count }) : row;
}

/** Maps the rows of `calendar_event_series` to the stored rule. */
export function mapSeriesRule(rows: unknown): Result<RecurrenceRule, PortError> {
  const row = firstRow(seriesRowSchema, rows);
  return row.ok ? ok(row.value.rule) : row;
}

/** Maps a Supabase/PostgREST error onto a {@link PortError}. */
export function mapSupabaseError(error: {
  readonly code?: string | undefined;
  readonly message: string;
}): PortError {
  switch (error.code) {
    case '42501':
    case 'PGRST301':
      return { kind: 'forbidden', message: 'You do not have access to the calendar.' };
    case '23505':
      return { kind: 'conflict', message: 'That event already exists.' };
    case '40001':
      return { kind: 'conflict', message: 'This event changed. Review the times and try again.' };
    case 'P0002':
      return { kind: 'not-found', message: 'That event no longer exists.' };
    case '22023':
    case '23514':
      return { kind: 'validation', message: 'The calendar service rejected the input.' };
    default:
      return { kind: 'unavailable', message: 'The calendar service is not available.' };
  }
}
