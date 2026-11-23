import type { IsoDateTime } from './user';

/** Lifecycle of a tutee's request for a slot. */
export type SessionRequestStatus = 'pending' | 'accepted' | 'declined';

/** A tutee's request to book an availability slot. */
export interface SessionRequest {
  readonly id: string;
  readonly slotId: string;
  readonly userId: string;
  readonly status: SessionRequestStatus;
  readonly createdAt: IsoDateTime;
}

/** The tutor's decision on a session request. */
export type SessionDecision = Exclude<SessionRequestStatus, 'pending'>;

/** Event the tutor is notified about (tutor-only, see ADR 0001). */
export type TutorNotification =
  | { readonly type: 'access-requested'; readonly requestId: string }
  | { readonly type: 'session-requested'; readonly requestId: string };
