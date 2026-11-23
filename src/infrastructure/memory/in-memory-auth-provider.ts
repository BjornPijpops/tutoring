import { ok } from '../../core/domain/result';
import type { Session, SignInProvider } from '../../core/domain/user';
import type { AuthProvider, PortResult, Unsubscribe } from '../../core/ports';

/** Session created by {@link InMemoryAuthProvider.signIn}. */
const FAKE_TUTEE_SESSION: Session = { user: { id: 'user-1', role: 'tutee' } };

/** In-memory {@link AuthProvider}: signing in with any provider creates a fake tutee session. */
export class InMemoryAuthProvider implements AuthProvider {
  private readonly listeners = new Set<(session: Session | null) => void>();

  constructor(private session: Session | null = null) {}

  getSession(): PortResult<Session | null> {
    return Promise.resolve(ok(this.session));
  }

  signIn(_provider: SignInProvider): PortResult<void> {
    this.update(FAKE_TUTEE_SESSION);
    return Promise.resolve(ok(undefined));
  }

  signOut(): PortResult<void> {
    this.update(null);
    return Promise.resolve(ok(undefined));
  }

  onSessionChange(listener: (session: Session | null) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(session: Session | null): void {
    this.session = session;
    this.listeners.forEach((listener) => {
      listener(session);
    });
  }
}
