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
const UNEXPECTED: PortError = {
  kind: 'unavailable',
  message: 'The access service returned unexpected data.',
};

type Response = {
  readonly data: unknown;
  readonly error: Parameters<typeof mapAccessError>[0] | null;
};

/**
 * {@link AccessRequestRepository} on the access-request RPCs. All reads and writes go through
 * security-definer functions (the tutee cannot read the table: revoked and blocked are
 * projected to denied on the server). Every response is validated and errors are mapped, so
 * raw SQL text never reaches the UI.
 */
export class SupabaseAccessRequestRepository implements AccessRequestRepository {
  constructor(private readonly client: SupabaseClient) {}

  requestAccess(message: string): PortResult<AccessRequest> {
    return this.callRpc('request_access', { p_message: message }, mapRequestRow);
  }

  async getMine(): PortResult<AccessRequest | null> {
    // The table is not readable by tutees: the RPC projects revoked/blocked to denied.
    const rows = await this.callRpc('get_my_access_request', {}, (data) =>
      Array.isArray(data) && data.length === 0
        ? ok(null)
        : Array.isArray(data) && data.length === 1
          ? mapRequestRow(data[0])
          : err(UNEXPECTED),
    );
    return rows;
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
