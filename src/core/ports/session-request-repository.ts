import type { Interval } from '../domain/interval';
import type {
  SessionDecision,
  SessionDecisionResult,
  SessionRequest,
  TutorSessionRequest,
} from '../domain/session-request';
import type { PortResult } from './port-error';

/** Storage and workflow of range-based timeslot requests. */
export interface SessionRequestRepository {
  create(range: Interval | string): PortResult<SessionRequest>;
  listMine(range?: Interval): PortResult<readonly SessionRequest[]>;
  listPending(): PortResult<readonly TutorSessionRequest[]>;
  /** Tutor only: accepted sessions intersecting `range`, for the read-only calendar blocks. */
  listAccepted(range: Interval): PortResult<readonly TutorSessionRequest[]>;
  decide(id: string, decision: SessionDecision): PortResult<SessionDecisionResult>;
  cancel(id: string): PortResult<SessionRequest>;
}
