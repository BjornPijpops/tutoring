/** UTC instant as an ISO-8601 string, e.g. `2026-01-05T09:00:00Z`. */
export type IsoDateTime = string;

/** Role of a signed-in person. */
export type Role = 'tutor' | 'tutee';

/** Minimal user profile (no email: personal data is kept to a minimum). */
export interface User {
  readonly id: string;
  readonly displayName?: string;
  readonly role: Role;
}

/** Authenticated session as seen by the app. */
export interface Session {
  readonly user: User;
}

/** Third-party identity providers a tutee can sign in with. */
export type SignInProvider = 'google' | 'azure';

/** Approval state of a tutee's access request. */
export type AccessStatus = 'pending' | 'approved' | 'denied';
