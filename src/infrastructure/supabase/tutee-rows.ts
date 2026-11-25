import { z } from 'zod';
import type { SessionRequest } from '../../core/domain/session-request';
import type {
  TuteeActionResult,
  TuteeDetail,
  TuteeList,
  TuteeSession,
  TuteeSummary,
} from '../../core/domain/tutee';
import { err, ok, type Result } from '../../core/domain/result';
import type { PortError } from '../../core/ports';

const MALFORMED: PortError = {
  kind: 'unavailable',
  message: 'The tutee service returned unexpected data.',
};

const instant = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const count = z.number().int().nonnegative();
const status = z.enum(['pending', 'approved', 'denied', 'revoked', 'blocked']);
const sessionStatus = z.enum(['pending', 'accepted', 'declined', 'cancelled']);

const summarySchema = z.object({
  user_id: z.string().min(1),
  display_name: z.string(),
  email: z.string(),
  status,
  created_at: instant,
  requested_at: instant,
  decided_at: instant.nullable(),
  next_request_at: instant.nullable(),
  request_count: count,
  pending_sessions: count,
  accepted_future_sessions: count,
});

const listSchema = z.object({
  items: z.array(summarySchema),
  total: count,
  counts: z.object({
    pending: count,
    approved: count,
    denied: count,
    revoked: count,
    blocked: count,
    all: count,
  }),
});

const detailSchema = z.object({
  tutee: summarySchema.extend({ message: z.string() }),
  sessions: z.array(
    z.object({
      id: z.string().min(1),
      starts_at: instant,
      ends_at: instant,
      status: sessionStatus,
      created_at: instant,
      decided_at: instant.nullable(),
      cancelled_at: instant.nullable(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.union([z.string().min(1), z.number().int()]),
      action: z.enum([
        'requested',
        're_requested',
        'approved',
        'denied',
        'revoked',
        'restored',
        'blocked',
        'unblocked',
        'cooldown_reset',
      ]),
      from_status: status.nullable(),
      to_status: status.nullable(),
      sessions_ended: count,
      created_at: instant,
    }),
  ),
  history_starts_at: instant.nullable(),
});

const actionSchema = z.object({
  status,
  pending_declined: count,
  accepted_cancelled: count,
});

const sessionRowSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  starts_at: instant,
  ends_at: instant,
  status: sessionStatus,
  created_at: instant,
  updated_at: instant.nullable().optional(),
  decided_at: instant.nullable().optional(),
  cancelled_at: instant.nullable().optional(),
});

const iso = (value: string) => new Date(value).toISOString();
const isoOrNull = (value: string | null) => (value === null ? null : iso(value));

function mapSummary(row: z.infer<typeof summarySchema>): TuteeSummary {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    createdAt: iso(row.created_at),
    requestedAt: iso(row.requested_at),
    decidedAt: isoOrNull(row.decided_at),
    nextRequestAt: isoOrNull(row.next_request_at),
    requestCount: row.request_count,
    pendingSessions: row.pending_sessions,
    acceptedFutureSessions: row.accepted_future_sessions,
  };
}

export function mapTuteeList(data: unknown): Result<TuteeList, PortError> {
  const parsed = listSchema.safeParse(data);
  if (!parsed.success) return err(MALFORMED);
  return ok({
    items: parsed.data.items.map(mapSummary),
    total: parsed.data.total,
    counts: parsed.data.counts,
  });
}

export function mapTuteeDetail(data: unknown): Result<TuteeDetail, PortError> {
  const parsed = detailSchema.safeParse(data);
  if (!parsed.success) return err(MALFORMED);
  const value = parsed.data;
  const sessions: TuteeSession[] = value.sessions.map((row) => ({
    id: row.id,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    status: row.status,
    createdAt: iso(row.created_at),
    decidedAt: isoOrNull(row.decided_at),
    cancelledAt: isoOrNull(row.cancelled_at),
  }));
  return ok({
    tutee: { ...mapSummary(value.tutee), message: value.tutee.message },
    sessions,
    events: value.events.map((row) => ({
      id: String(row.id),
      action: row.action,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      sessionsEnded: row.sessions_ended,
      createdAt: iso(row.created_at),
    })),
    historyStartsAt: isoOrNull(value.history_starts_at),
  });
}

export function mapTuteeAction(data: unknown): Result<TuteeActionResult, PortError> {
  const parsed = actionSchema.safeParse(data);
  if (!parsed.success) return err(MALFORMED);
  return ok({
    status: parsed.data.status,
    pendingDeclined: parsed.data.pending_declined,
    acceptedCancelled: parsed.data.accepted_cancelled,
  });
}

export function mapSessionRow(data: unknown): Result<SessionRequest, PortError> {
  const parsed = sessionRowSchema.safeParse(Array.isArray(data) ? data[0] : data);
  if (!parsed.success) return err(MALFORMED);
  const row = parsed.data;
  return ok({
    id: row.id,
    userId: row.user_id,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    status: row.status,
    createdAt: iso(row.created_at),
    ...(row.updated_at ? { updatedAt: iso(row.updated_at) } : {}),
    ...(row.decided_at ? { decidedAt: iso(row.decided_at) } : {}),
    ...(row.cancelled_at ? { cancelledAt: iso(row.cancelled_at) } : {}),
  });
}

/** `allow_access_request_again` returns the updated row; only its shape is checked. */
export function mapAllowAgain(data: unknown): Result<void, PortError> {
  const parsed = z
    .object({ user_id: z.string().min(1), next_request_at: z.null() })
    .safeParse(Array.isArray(data) ? data[0] : data);
  return parsed.success ? ok(undefined) : err(MALFORMED);
}
