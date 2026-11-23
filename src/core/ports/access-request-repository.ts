import type { AccessDecision, AccessRequest } from '../domain/access-request';
import type { PortResult } from './port-error';

/** Storage and workflow of tutee access requests. */
export interface AccessRequestRepository {
  /** Creates an access request for the current user. */
  request(): PortResult<AccessRequest>;
  /** The current user's request, or `null` if none. */
  getMine(): PortResult<AccessRequest | null>;
  /** Pending requests (tutor only). */
  listPending(): PortResult<readonly AccessRequest[]>;
  /** Approves or denies a request (tutor only). */
  decide(id: string, decision: AccessDecision): PortResult<AccessRequest>;
}
