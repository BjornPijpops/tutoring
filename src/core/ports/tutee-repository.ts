import type {
  TuteeAction,
  SessionPolicy,
  TuteeDetail,
  TuteeList,
  TuteeListQuery,
  TuteeActionResult,
} from '../domain/tutee';
import type { SessionRequest } from '../domain/session-request';
import type { PortResult } from './port-error';
export interface TuteeRepository {
  list(query: TuteeListQuery): PortResult<TuteeList>;
  get(userId: string): PortResult<TuteeDetail>;
  act(userId: string, action: TuteeAction, policy?: SessionPolicy): PortResult<TuteeActionResult>;
  allowAgain(userId: string): PortResult<void>;
  cancelSession(requestId: string): PortResult<SessionRequest>;
}
