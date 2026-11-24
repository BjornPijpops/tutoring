import { ok } from '../../core/domain/result';
import type { Identity, Session, SignInProvider } from '../../core/domain/user';
import type { AuthProvider, PortResult, Unsubscribe } from '../../core/ports';

/** Session created by {@link InMemoryAuthProvider.signIn} unless another one is given. */
const FAKE_TUTEE_SESSION: Session = { user: { id: 'user-1', role: 'tutee', accessState: 'none' } };

/** Account shown by {@link InMemoryAuthProvider.getIdentity} unless another one is given. */
const FAKE_IDENTITY: Identity = { displayName: 'Alex Example', email: 'alex@example.test' };

/** In-memory {@link AuthProvider}: signing in with any provider creates a fake session. */
export class InMemoryAuthProvider implements AuthProvider {
  private readonly listeners = new Set<(session: Session | null) => void>();

  constructor(
    private session: Session | null = null,
    private readonly signInSession: Session = FAKE_TUTEE_SESSION,
    private readonly identity: Identity = FAKE_IDENTITY,
  ) {}

  getSession(): PortResult<Session | null> {
    return Promise.resolve(ok(this.session));
  }

  getIdentity(): PortResult<Identity | null> {
    return Promise.resolve(ok(this.session ? this.identity : null));
  }

  signIn(_provider: SignInProvider): PortResult<void> {
    this.update(this.signInSession);
    return Promise.resolve(ok(undefined));
  }

  signOut(): PortResult<void> {
    this.update(null);
    return Promise.resolve(ok(undefined));
  }

  /** Simulates the server-side state changing, e.g. the tutor approving the user. */
  setSession(session: Session | null): void {
    this.session = session;
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
