import { z } from 'zod';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { fromMs, toMs, type Interval } from '../../core/domain/interval';
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
  }));
}

/** Validates and maps `get_blocked_intervals` rows to domain intervals. */
export function mapIntervalRows(rows: unknown): Result<readonly Interval[], PortError> {
  return mapRows(intervalRowSchema, rows, (row) => ({
    startsAt: canonical(row.starts_at),
    endsAt: canonical(row.ends_at),
  }));
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
    case '22023':
    case '23514':
      return { kind: 'validation', message: 'The calendar service rejected the input.' };
    default:
      return { kind: 'unavailable', message: 'The calendar service is not available.' };
  }
}
