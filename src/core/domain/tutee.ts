import type { IsoDateTime } from './user';
export type TuteeStatus = 'pending' | 'approved' | 'denied' | 'revoked' | 'blocked';
export type TuteeAction = 'approve' | 'deny' | 'revoke' | 'restore' | 'block' | 'unblock';
export type SessionPolicy = 'keep' | 'cancel_all';
export type TuteeAuditAction =
  | 'requested'
  | 're_requested'
  | 'approved'
  | 'denied'
  | 'revoked'
  | 'restored'
  | 'blocked'
  | 'unblocked'
  | 'cooldown_reset';
export interface TuteeSummary {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly status: TuteeStatus;
  readonly createdAt: IsoDateTime;
  readonly requestedAt: IsoDateTime;
  readonly decidedAt: IsoDateTime | null;
  readonly nextRequestAt: IsoDateTime | null;
  readonly requestCount: number;
  readonly pendingSessions: number;
  readonly acceptedFutureSessions: number;
}
export interface TuteeSession {
  readonly id: string;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  readonly createdAt: IsoDateTime;
  readonly decidedAt: IsoDateTime | null;
  readonly cancelledAt: IsoDateTime | null;
}
export interface TuteeEvent {
  readonly id: string;
  readonly action: TuteeAuditAction;
  readonly fromStatus: TuteeStatus | null;
  readonly toStatus: TuteeStatus | null;
  readonly sessionsEnded: number;
  readonly createdAt: IsoDateTime;
}
export interface TuteeListQuery {
  readonly status?: TuteeStatus;
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}
export interface TuteeList {
  readonly items: readonly TuteeSummary[];
  readonly total: number;
  readonly counts: Record<TuteeStatus | 'all', number>;
}
export interface TuteeDetail {
  readonly tutee: TuteeSummary & { readonly message: string };
  readonly sessions: readonly TuteeSession[];
  readonly events: readonly TuteeEvent[];
  readonly historyStartsAt: IsoDateTime | null;
}
export interface TuteeActionResult {
  readonly status: TuteeStatus;
  readonly pendingDeclined: number;
  readonly acceptedCancelled: number;
}
export const TUTEE_SEARCH_MAX = 100;
export const TUTEE_PAGE_DEFAULT = 50;
export const TUTEE_PAGE_MAX = 100;
