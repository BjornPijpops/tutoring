import type { Result } from '../domain/result';

/** Why a port call failed; adapters map backend errors onto these kinds. */
export interface PortError {
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
