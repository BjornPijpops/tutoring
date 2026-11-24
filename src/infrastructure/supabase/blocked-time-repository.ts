import type { SupabaseClient } from '@supabase/supabase-js';
import type { Interval, TimeRange } from '../../core/domain/interval';
import { err } from '../../core/domain/result';
import type { BlockedTimeRepository, PortResult } from '../../core/ports';
import { mapIntervalRows, mapSupabaseError } from './rows';

/** {@link BlockedTimeRepository} on the `get_blocked_intervals` RPC (merged intervals only). */
export class SupabaseBlockedTimeRepository implements BlockedTimeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listBlockedIntervals(range: TimeRange): PortResult<readonly Interval[]> {
    try {
      const response = await this.client.rpc('get_blocked_intervals', {
        p_from: range.from,
        p_to: range.to,
      });
      const data: unknown = response.data;
      return response.error ? err(mapSupabaseError(response.error)) : mapIntervalRows(data);
    } catch {
      return err({ kind: 'unavailable', message: 'The calendar service is not available.' });
    }
  }
}
