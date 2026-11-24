import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, SignInProvider } from '../../core/domain/user';
import { useServices } from '../../app/services-context';
import { readOAuthCallback } from './callback';

/** What the app knows about the current sign-in. */
export type AuthState =
  | { readonly status: 'checking' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly session: Session }
  | { readonly status: 'error' };

/** Why the last sign-in attempt did not work. */
export type SignInProblem = 'cancelled' | 'failed' | 'network';

/** Value of the auth context. */
export interface AuthContextValue {
  readonly state: AuthState;
  readonly signingIn: boolean;
  readonly signInProblem: SignInProblem | null;
  readonly signOutFailed: boolean;
  /** Starts sign-in; redirect-based providers leave the page. */
  signIn: (provider: SignInProvider) => Promise<void>;
  /** Ends the session; resolves to whether it worked. */
  signOut: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toState(session: Session | null): AuthState {
  return session ? { status: 'signed-in', session } : { status: 'signed-out' };
}

/** Props of {@link AuthProvider}. */
export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Keeps the session in React state: restores it on load (finishing a `?code=` OAuth
 * callback if present), follows later changes and exposes sign-in and sign-out.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const { auth } = useServices();
  const [state, setState] = useState<AuthState>({ status: 'checking' });
  const [signingIn, setSigningIn] = useState(false);
  const [callback] = useState(() => readOAuthCallback(new URL(window.location.href)));
  const [signInProblem, setSignInProblem] = useState<SignInProblem | null>(
    callback.outcome === 'cancelled' || callback.outcome === 'failed' ? callback.outcome : null,
  );
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    const removeCallbackParams = () => {
      if (callback.outcome !== 'none') {
        window.history.replaceState(window.history.state, '', callback.cleanUrl);
      }
    };

    if (callback.outcome === 'cancelled' || callback.outcome === 'failed') {
      removeCallbackParams();
      window.location.hash = '#/login';
    }

    let active = true;
    void auth.getSession().then((result) => {
      if (!active) return;
      // getSession resolves after the code exchange, so the query can go now.
      if (callback.outcome === 'success') {
        removeCallbackParams();
        window.location.hash = '#/calendar';
      }
      setState(result.ok ? toState(result.value) : { status: 'error' });
    });
    const unsubscribe = auth.onSessionChange((session) => {
      if (active) setState(toState(session));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth, callback]);

  const signIn = useCallback(
    async (provider: SignInProvider) => {
      setSigningIn(true);
      setSignInProblem(null);
      const result = await auth.signIn(provider);
      if (!result.ok) {
        setSignInProblem(result.error.kind === 'unavailable' ? 'network' : 'failed');
        setSigningIn(false);
      }
    },
    [auth],
  );

  const signOut = useCallback(async () => {
    setSignOutFailed(false);
    const result = await auth.signOut();
    if (!result.ok) {
      setSignOutFailed(true);
      return false;
    }
    setSigningIn(false);
    setState({ status: 'signed-out' });
    return true;
  }, [auth]);

  const value = useMemo(
    () => ({ state, signingIn, signInProblem, signOutFailed, signIn, signOut }),
    [state, signingIn, signInProblem, signOutFailed, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Returns the auth state and actions; throws outside an {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within an AuthProvider');
  return value;
}
