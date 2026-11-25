import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionRequest } from '../../core/domain/session-request';
import type {
  SessionPolicy,
  TuteeAction,
  TuteeActionResult,
  TuteeDetail,
  TuteeList,
  TuteeListQuery,
} from '../../core/domain/tutee';
import { err, type Result } from '../../core/domain/result';
import type { PortError, PortResult, TuteeRepository } from '../../core/ports';
import { mapAccessError } from './access-rows';
import {
  mapAllowAgain,
  mapSessionRow,
  mapTuteeAction,
  mapTuteeDetail,
  mapTuteeList,
} from './tutee-rows';

const UNAVAILABLE: PortError = {
  kind: 'unavailable',
  message: 'The tutee service is not available.',
};

/** {@link TuteeRepository} on the tutee RPCs; every response is validated and errors mapped. */
export class SupabaseTuteeRepository implements TuteeRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(
    name: string,
    args: Record<string, unknown>,
    map: (data: unknown) => Result<T, PortError>,
  ): PortResult<T> {
    try {
      const response = await this.client.rpc(name, args);
      return response.error ? err(mapAccessError(response.error)) : map(response.data);
    } catch {
      return err(UNAVAILABLE);
    }
  }

  list(query: TuteeListQuery): PortResult<TuteeList> {
    return this.rpc(
      'list_tutees',
      {
        p_status: query.status ?? null,
        p_search: query.search ?? null,
        p_limit: query.limit ?? null,
        p_offset: query.offset ?? null,
      },
      mapTuteeList,
    );
  }

  get(userId: string): PortResult<TuteeDetail> {
    return this.rpc('get_tutee_detail', { p_user_id: userId }, mapTuteeDetail);
  }

  act(
    userId: string,
    action: TuteeAction,
    policy: SessionPolicy = 'keep',
  ): PortResult<TuteeActionResult> {
    return this.rpc(
      'act_on_tutee',
      { p_user_id: userId, p_action: action, p_session_policy: policy },
      mapTuteeAction,
    );
  }

  allowAgain(userId: string): PortResult<void> {
    return this.rpc('allow_access_request_again', { p_user_id: userId }, mapAllowAgain);
  }

  cancelSession(requestId: string): PortResult<SessionRequest> {
    return this.rpc('cancel_session_as_tutor', { p_request_id: requestId }, mapSessionRow);
  }
}
