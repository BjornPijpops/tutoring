import type { AccessStatus, IsoDateTime } from './user';

/** Length limit of the optional message a tutee sends with a request. */
export const ACCESS_MESSAGE_MAX_LENGTH = 500;

/** How long a denied tutee waits before asking again (unless the tutor allows it sooner). */
export const ACCESS_COOLDOWN_HOURS = 8;

/** New requests pause while this many are pending (a flood guard). */
export const MAX_PENDING_REQUESTS = 50;

/** A tutee's own request for access (no name or e-mail: those stay with the tutor's view). */
export interface AccessRequest {
  /** Equals {@link userId}: there is one request per user. */
  readonly id: string;
  readonly userId: string;
  readonly status: AccessStatus;
  readonly message: string;
  readonly createdAt: IsoDateTime;
  /** When the latest request was made. */
  readonly requestedAt: IsoDateTime;
  /** When the tutor last decided; `null` while pending. */
  readonly decidedAt: IsoDateTime | null;
  /** After a denial: the first instant the tutee may ask again; `null` when allowed now. */
  readonly nextRequestAt: IsoDateTime | null;
  /** How many times the tutee has asked. */
  readonly requestCount: number;
  /**
   * `false` when the tutor blocked the tutee: the request shows as denied without a retry
   * date. Absent or `true` otherwise. The tutee never learns the word "blocked".
   */
  readonly canAskAgain?: boolean;
}

/** A request as the tutor sees it, including who asked. */
export interface AccessRequestSummary {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly message: string;
  readonly status: AccessStatus;
  readonly requestedAt: IsoDateTime;
  readonly decidedAt: IsoDateTime | null;
  readonly nextRequestAt: IsoDateTime | null;
  readonly requestCount: number;
}

/** The tutor's decision on an access request. */
export type AccessDecision = Exclude<AccessStatus, 'pending'>;

/** Optional status filter for the tutor's list. */
export type AccessRequestFilter = AccessStatus | undefined;
