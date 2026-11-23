import type { TutorNotification } from '../domain/session-request';
import type { PortResult } from './port-error';

/** Sends notifications to the tutor only (tutees are never emailed, see ADR 0001). */
export interface Notifier {
  notifyTutor(event: TutorNotification): PortResult<void>;
}
