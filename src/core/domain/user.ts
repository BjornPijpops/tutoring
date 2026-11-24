/** UTC instant as an ISO-8601 string, e.g. `2026-01-05T09:00:00Z`. */
export type IsoDateTime = string;

/** Role of a signed-in person: `tutor` is the admin; everyone else is a `tutee`. */
export type Role = 'tutor' | 'tutee';

/** Approval state of a tutee's access request. */
export type AccessStatus = 'pending' | 'approved' | 'denied';

/** A tutee's access state; `none` means no request has been made yet. */
export type AccessState = AccessStatus | 'none';

/**
 * Minimal user profile (no email: personal data is kept to a minimum).
 * `accessState` only chooses what to show; the server enforces access.
 */
export interface User {
  readonly id: string;
  readonly displayName?: string;
  readonly role: Role;
  readonly accessState: AccessState;
}

/** Authenticated session as seen by the app. */
export interface Session {
  readonly user: User;
}

/** Third-party identity providers a tutee can sign in with. */
export type SignInProvider = 'google' | 'azure';

/** Name and e-mail of the signed-in account, to show back to the user (never for access). */
export interface Identity {
  readonly displayName?: string;
  readonly email: string;
}
