import type { Interval, IsoDateTime } from './interval';

export type SessionRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface SessionRequest extends Interval {
  readonly id: string;
  readonly slotId?: string;
  readonly userId: string;
  readonly status: SessionRequestStatus;
  readonly createdAt: IsoDateTime;
  readonly updatedAt?: IsoDateTime;
  readonly decidedAt?: IsoDateTime;
  readonly cancelledAt?: IsoDateTime;
}

/** Tutor-only identity projection used by the decision page. */
export interface TutorSessionRequest extends SessionRequest {
  readonly requesterName: string;
  readonly requesterEmail: string;
}

export interface SessionDecisionResult {
  readonly request: SessionRequest;
  readonly overlapDeclinedCount: number;
}

export type SessionDecision = 'accepted' | 'declined';

export type TutorNotification =
  | { readonly type: 'access-requested'; readonly requestId: string }
  | { readonly type: 'session-requested'; readonly requestId: string };
