import { z } from 'zod';
import type { AccessRequest, AccessRequestSummary } from '../../core/domain/access-request';
import { fromMs, toMs } from '../../core/domain/interval';
import { err, ok, type Result } from '../../core/domain/result';
import type { AccessState } from '../../core/domain/user';
import type { PortError } from '../../core/ports';

const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const status = z.enum(['pending', 'approved', 'denied']);

const requestRowSchema = z.object({
  user_id: z.string().min(1),
  status,
  message: z.string(),
  created_at: timestamp,
  requested_at: timestamp,
  decided_at: timestamp.nullable(),
  next_request_at: timestamp.nullable(),
  request_count: z.number().int().min(1),
});

const summaryRowSchema = z.object({
  user_id: z.string().min(1),
  display_name: z.string(),
  email: z.string(),
  message: z.string(),
  status,
  requested_at: timestamp,
  decided_at: timestamp.nullable(),
  next_request_at: timestamp.nullable(),
  request_count: z.number().int().min(1),
});

const myAccessRowSchema = z.object({ is_admin: z.boolean(), status: status.nullable() });

/** Row of `public.access_requests` as returned by the API. */
export type AccessRequestRow = z.input<typeof requestRowSchema>;

const MALFORMED: PortError = {
  kind: 'unavailable',
  message: 'The access service returned unexpected data.',
};

const canonical = (instant: string) => fromMs(toMs(instant));
const canonicalOrNull = (instant: string | null) => (instant === null ? null : canonical(instant));

/** Validates and maps one `access_requests` row to the tutee's own request. */
export function mapRequestRow(row: unknown): Result<AccessRequest, PortError> {
  const parsed = requestRowSchema.safeParse(row);
  if (!parsed.success) return err(MALFORMED);
  const data = parsed.data;
  return ok({
    id: data.user_id,
    userId: data.user_id,
    status: data.status,
    message: data.message,
    createdAt: canonical(data.created_at),
    requestedAt: canonical(data.requested_at),
    decidedAt: canonicalOrNull(data.decided_at),
    nextRequestAt: canonicalOrNull(data.next_request_at),
    requestCount: data.request_count,
  });
}

/** Validates and maps `list_access_requests` rows to tutor summaries. */
export function mapSummaryRows(rows: unknown): Result<readonly AccessRequestSummary[], PortError> {
  const parsed = z.array(summaryRowSchema).safeParse(rows);
  if (!parsed.success) return err(MALFORMED);
  return ok(
    parsed.data.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      message: row.message,
      status: row.status,
      requestedAt: canonical(row.requested_at),
      decidedAt: canonicalOrNull(row.decided_at),
      nextRequestAt: canonicalOrNull(row.next_request_at),
      requestCount: row.request_count,
    })),
  );
}

/** What `get_my_access` says about the caller: admin or not, plus the request state. */
export interface MyAccess {
  readonly isAdmin: boolean;
  readonly accessState: AccessState;
}

/** Validates the single row returned by `get_my_access`. */
export function mapMyAccess(rows: unknown): MyAccess | undefined {
  const parsed = z.tuple([myAccessRowSchema]).safeParse(rows);
  if (!parsed.success) return undefined;
  const [row] = parsed.data;
  return { isAdmin: row.is_admin, accessState: row.status ?? 'none' };
}

/**
 * Maps a PostgREST error from the access RPCs onto a {@link PortError}. Only the stable
 * messages raised by the migration are recognised; raw SQL text never leaves this function.
 */
export function mapAccessError(error: {
  readonly code?: string | undefined;
  readonly message: string;
}): PortError {
  switch (error.code) {
    case '42501':
    case 'PGRST301':
      return { kind: 'forbidden', message: 'You do not have access to this.' };
    case 'P0002':
      return { kind: 'not-found', message: 'That request was not found.' };
    case '22023':
    case '23514':
      return { kind: 'validation', message: 'The access service rejected the input.' };
    case '23505':
      return {
        kind: 'conflict',
        code: 'state_conflict',
        message: 'The request changed in the meantime.',
      };
    case 'P0001':
      return mapRaisedConflict(error.message);
    default:
      return { kind: 'unavailable', message: 'The access service is not available.' };
  }
}

function mapRaisedConflict(message: string): PortError {
  if (message.includes('temporarily closed')) {
    return {
      kind: 'conflict',
      code: 'access_requests_closed',
      message: 'Access requests are paused.',
    };
  }
  if (message.includes('cooldown active')) {
    return { kind: 'conflict', code: 'cooldown_active', message: 'You cannot ask again yet.' };
  }
  return { kind: 'unavailable', message: 'The access service is not available.' };
}
