import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccessDecision,
  AccessRequest,
  AccessRequestFilter,
  AccessRequestSummary,
} from '../../core/domain/access-request';
import { err, ok, type Result } from '../../core/domain/result';
import type { AccessRequestRepository, PortError, PortResult } from '../../core/ports';
import { mapAccessError, mapRequestRow, mapSummaryRows } from './access-rows';

const UNAVAILABLE: PortError = {
  kind: 'unavailable',
  message: 'The access service is not available.',
};
const UNAUTHENTICATED: PortError = { kind: 'unauthenticated', message: 'You are not signed in.' };

type Response = {
  readonly data: unknown;
  readonly error: Parameters<typeof mapAccessError>[0] | null;
};

/**
 * {@link AccessRequestRepository} on the access-request RPCs. All writes and the tutor's list
 * go through security-definer functions; only the caller's own row is read directly (RLS).
 * Every response is validated and errors are mapped, so raw SQL text never reaches the UI.
 */
export class SupabaseAccessRequestRepository implements AccessRequestRepository {
  constructor(private readonly client: SupabaseClient) {}

  requestAccess(message: string): PortResult<AccessRequest> {
    return this.callRpc('request_access', { p_message: message }, mapRequestRow);
  }

  async getMine(): PortResult<AccessRequest | null> {
    try {
      const { data: auth, error: authError } = await this.client.auth.getSession();
      const userId = auth.session?.user.id;
      if (authError || !userId) return err(UNAUTHENTICATED);
      const response: Response = await this.client
        .from('access_requests')
        .select(
          'user_id,status,message,created_at,requested_at,decided_at,next_request_at,request_count',
        )
        .eq('user_id', userId)
        .maybeSingle();
      if (response.error) return err(mapAccessError(response.error));
      return response.data === null ? ok(null) : mapRequestRow(response.data);
    } catch {
      return err(UNAVAILABLE);
    }
  }

  listRequests(status?: AccessRequestFilter): PortResult<readonly AccessRequestSummary[]> {
    return this.callRpc('list_access_requests', { p_status: status ?? null }, mapSummaryRows);
  }

  decide(userId: string, decision: AccessDecision): PortResult<AccessRequest> {
    return this.callRpc(
      'decide_access_request',
      { p_user_id: userId, p_decision: decision },
      mapRequestRow,
    );
  }

  allowRequestAgain(userId: string): PortResult<AccessRequest> {
    return this.callRpc('allow_access_request_again', { p_user_id: userId }, mapRequestRow);
  }

  private async callRpc<T>(
    name: string,
    args: Record<string, unknown>,
    map: (data: unknown) => Result<T, PortError>,
  ): PortResult<T> {
    try {
      const response: Response = await this.client.rpc(name, args);
      return response.error ? err(mapAccessError(response.error)) : map(response.data);
    } catch {
      return err(UNAVAILABLE);
    }
  }
}
