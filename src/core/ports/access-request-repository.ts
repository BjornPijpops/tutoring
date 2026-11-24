import type {
  AccessDecision,
  AccessRequest,
  AccessRequestFilter,
  AccessRequestSummary,
} from '../domain/access-request';
import type { PortResult } from './port-error';

/**
 * Storage and workflow of tutee access requests.
 * Failures the user can act on are `conflict` errors carrying a `code`.
 */
export interface AccessRequestRepository {
  /**
   * Asks for access as the current user, or asks again after a denial. Asking while pending
   * or approved returns the existing request unchanged.
   */
  requestAccess(message: string): PortResult<AccessRequest>;
  /** The current user's request, or `null` if none. */
  getMine(): PortResult<AccessRequest | null>;
  /** Requests, pending first then newest first, optionally of one status (tutor only; at most 200). */
  listRequests(status?: AccessRequestFilter): PortResult<readonly AccessRequestSummary[]>;
  /** Approves or denies (revokes) a request (tutor only). Denying starts the cooldown. */
  decide(userId: string, decision: AccessDecision): PortResult<AccessRequest>;
  /** Lets a denied tutee ask again immediately (tutor only). */
  allowRequestAgain(userId: string): PortResult<AccessRequest>;
}
