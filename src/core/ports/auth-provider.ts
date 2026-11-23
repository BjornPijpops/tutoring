import type { Session, SignInProvider } from '../domain/user';
import type { PortResult, Unsubscribe } from './port-error';

/** Authentication with an external identity provider. */
export interface AuthProvider {
  /** Current session, or `null` when signed out. */
  getSession(): PortResult<Session | null>;
  /** Starts sign-in with the given provider. */
  signIn(provider: SignInProvider): PortResult<void>;
  /** Ends the current session. */
  signOut(): PortResult<void>;
  /** Subscribes to session changes; returns a function that unsubscribes. */
  onSessionChange(listener: (session: Session | null) => void): Unsubscribe;
}
