import type { Result } from '../domain/result';

/** Stable reason for a `conflict` the user can act on. */
export type ConflictCode = 'access_requests_closed' | 'cooldown_active' | 'state_conflict';

/** Why a port call failed; adapters map backend errors onto these kinds. */
export interface PortError {
  /** Set on `conflict` errors that the UI explains in its own words. */
  readonly code?: ConflictCode;
  readonly kind:
    | 'unauthenticated'
    | 'forbidden'
    | 'not-found'
    | 'conflict'
    | 'validation'
    | 'not-supported'
    | 'unavailable';
  readonly message: string;
}

/** Result of an asynchronous port call. */
export type PortResult<T> = Promise<Result<T, PortError>>;

/** Function that stops a subscription. */
export type Unsubscribe = () => void;
