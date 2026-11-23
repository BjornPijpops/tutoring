import type { SessionDecision, SessionRequest } from '../domain/session-request';
import type { PortResult } from './port-error';

/** Storage and workflow of timeslot requests. */
export interface SessionRequestRepository {
  /** Requests the slot for the current user; conflicts if the slot is already booked. */
  create(slotId: string): PortResult<SessionRequest>;
  /** The current user's requests. */
  listMine(): PortResult<readonly SessionRequest[]>;
  /** Pending requests (tutor only). */
  listPending(): PortResult<readonly SessionRequest[]>;
  /** Accepts or declines a request (tutor only). */
  decide(id: string, decision: SessionDecision): PortResult<SessionRequest>;
}
