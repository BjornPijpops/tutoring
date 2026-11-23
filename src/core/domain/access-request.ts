import type { AccessStatus, IsoDateTime } from './user';

/** A tutee's request to be given access to the calendar. */
export interface AccessRequest {
  readonly id: string;
  readonly userId: string;
  readonly status: AccessStatus;
  readonly createdAt: IsoDateTime;
}

/** The tutor's decision on an access request. */
export type AccessDecision = Exclude<AccessStatus, 'pending'>;
