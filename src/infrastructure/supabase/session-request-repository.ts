import type { SupabaseClient } from '@supabase/supabase-js';
import type { Interval } from '../../core/domain/interval';
import type {
  SessionDecision,
  SessionDecisionResult,
  SessionRequest,
  TutorSessionRequest,
} from '../../core/domain/session-request';
import { err, ok, type Result } from '../../core/domain/result';
import type { PortError, PortResult, SessionRequestRepository } from '../../core/ports';
import { z } from 'zod';

const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const requestSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  starts_at: timestamp,
  ends_at: timestamp,
  status: z.enum(['pending', 'accepted', 'declined', 'cancelled']),
  created_at: timestamp,
  updated_at: timestamp.optional(),
  decided_at: timestamp.nullable().optional(),
  cancelled_at: timestamp.nullable().optional(),
});
const tutorSchema = requestSchema.extend({
  requester_name: z.string(),
  requester_email: z.string(),
});
const acceptedSchema = z.object({
  id: z.string(),
  starts_at: timestamp,
  ends_at: timestamp,
  requester_name: z.string(),
});
const malformed: PortError = {
  kind: 'unavailable',
  message: 'The session request service returned unexpected data.',
};
function mapRow(row: z.infer<typeof requestSchema>): SessionRequest {
  return {
    id: row.id,
    userId: row.user_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdAt: row.created_at,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
  };
}
function mapError(error: { code?: string; message: string }): PortError {
  if (error.code === '42501' || error.code === 'PGRST301')
    return { kind: 'forbidden', message: 'You need an approved account to request a session.' };
  if (error.code === '23P01' || error.code === 'TR002')
    return {
      kind: 'conflict',
      code: 'schedule_unavailable',
      message: 'This time is no longer available. Choose another time.',
    };
  if (error.code === 'TR001')
    return {
      kind: 'conflict',
      code: 'pending_limit',
      message:
        'You already have 3 pending requests. Wait for a decision or cancel one before requesting another.',
    };
  if (error.code === 'TR003')
    return {
      kind: 'conflict',
      code: 'state_conflict',
      message: 'This request can no longer be changed. Refresh and try again.',
    };
  if (error.code === '22023' && error.message.includes('ambiguous_local_time'))
    return {
      kind: 'validation',
      message: 'This time range spans a clock change. Choose a different time.',
    };
  if (error.code === '22023') return { kind: 'validation', message: 'Choose a valid time range.' };
  return { kind: 'unavailable', message: 'The session request service is not available.' };
}
async function call<T>(
  action: () => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
  parse: (value: unknown) => Result<T, PortError>,
): Promise<Result<T, PortError>> {
  try {
    const response = await action();
    return response.error ? err(mapError(response.error)) : parse(response.data);
  } catch {
    return err({ kind: 'unavailable', message: 'The session request service is not available.' });
  }
}
export class SupabaseSessionRequestRepository implements SessionRequestRepository {
  constructor(private readonly client: SupabaseClient) {}
  create(range: Interval): PortResult<SessionRequest> {
    return call(
      () =>
        this.client.rpc('create_session_request', {
          p_starts_at: range.startsAt,
          p_ends_at: range.endsAt,
        }),
      (value) => {
        const parsed = requestSchema.safeParse(
          value && !Array.isArray(value) ? value : Array.isArray(value) ? value[0] : value,
        );
        return parsed.success ? ok(mapRow(parsed.data)) : err(malformed);
      },
    );
  }
  listMine(range?: Interval): PortResult<readonly SessionRequest[]> {
    return call(
      () =>
        this.client.rpc('list_my_session_requests', {
          p_from: range?.startsAt ?? new Date(0).toISOString(),
          p_to: range?.endsAt ?? new Date('9999-12-31').toISOString(),
        }),
      (value) => {
        const parsed = z.array(requestSchema).safeParse(value);
        return parsed.success ? ok(parsed.data.map(mapRow)) : err(malformed);
      },
    );
  }
  listPending(): PortResult<readonly TutorSessionRequest[]> {
    return call(
      () => this.client.rpc('list_session_requests_for_tutor'),
      (value) => {
        const parsed = z.array(tutorSchema).safeParse(value);
        return parsed.success
          ? ok(
              parsed.data.map((row) => ({
                ...mapRow(row),
                requesterName: row.requester_name,
                requesterEmail: row.requester_email,
              })),
            )
          : err(malformed);
      },
    );
  }
  listAccepted(range: Interval): PortResult<readonly TutorSessionRequest[]> {
    return call(
      () =>
        this.client.rpc('list_accepted_sessions_for_tutor', {
          p_from: range.startsAt,
          p_to: range.endsAt,
        }),
      (value) => {
        const parsed = z.array(acceptedSchema).safeParse(value);
        return parsed.success
          ? ok(
              parsed.data.map((row) => ({
                id: row.id,
                userId: '',
                startsAt: row.starts_at,
                endsAt: row.ends_at,
                status: 'accepted' as const,
                createdAt: row.starts_at,
                requesterName: row.requester_name,
                requesterEmail: '',
              })),
            )
          : err(malformed);
      },
    );
  }
  decide(id: string, decision: SessionDecision): PortResult<SessionDecisionResult> {
    return call(
      () => this.client.rpc('decide_session_request', { p_request_id: id, p_decision: decision }),
      (value) => {
        const row = z
          .object({
            request: requestSchema,
            overlap_declined_count: z.number().int().nonnegative(),
          })
          .safeParse(value && Array.isArray(value) ? value[0] : value);
        return row.success
          ? ok({
              request: mapRow(row.data.request),
              overlapDeclinedCount: row.data.overlap_declined_count,
            })
          : err(malformed);
      },
    );
  }
  cancel(id: string): PortResult<SessionRequest> {
    return call(
      () => this.client.rpc('cancel_session_request', { p_request_id: id }),
      (value) => {
        const parsed = requestSchema.safeParse(value && Array.isArray(value) ? value[0] : value);
        return parsed.success ? ok(mapRow(parsed.data)) : err(malformed);
      },
    );
  }
}
