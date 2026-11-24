import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js';
import { err, ok } from '../../core/domain/result';
import type { Identity, Session, SignInProvider } from '../../core/domain/user';
import type { AuthProvider, PortError, PortResult, Unsubscribe } from '../../core/ports';
import { mapMyAccess, type MyAccess } from './access-rows';

const NO_ACCESS: MyAccess = { isAdmin: false, accessState: 'none' };

const NETWORK_ERROR: PortError = {
  kind: 'unavailable',
  message: 'The sign-in service could not be reached.',
};
const FAILED: PortError = { kind: 'unauthenticated', message: 'Sign-in failed.' };
const UNSUPPORTED: PortError = {
  kind: 'not-supported',
  message: 'Microsoft sign-in is not available yet.',
};

function isNetworkError(error: { readonly name?: string }): boolean {
  return error.name === 'AuthRetryableFetchError';
}

/**
 * {@link AuthProvider} backed by Supabase Auth (Google only, PKCE).
 * The role and access state are decided by the server through `rpc('get_my_access')`; user
 * metadata is never used for them, and any failure to ask means "not the tutor, no request".
 * The e-mail address is only exposed through {@link getIdentity}, to show it back to the user.
 */
export class SupabaseAuthProvider implements AuthProvider {
  constructor(
    private readonly client: SupabaseClient,
    private readonly redirectTo: string,
  ) {}

  async getSession(): PortResult<Session | null> {
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) return err(isNetworkError(error) ? NETWORK_ERROR : FAILED);
      if (!data.session) return ok(null);
      const access = await this.myAccess();
      return access === undefined ? err(NETWORK_ERROR) : ok(toSession(data.session, access));
    } catch {
      return err(NETWORK_ERROR);
    }
  }

  async getIdentity(): PortResult<Identity | null> {
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) return err(isNetworkError(error) ? NETWORK_ERROR : FAILED);
      const user = data.session?.user;
      if (!user) return ok(null);
      return user.email ? ok(toIdentity(user.email, user.user_metadata)) : err(FAILED);
    } catch {
      return err(NETWORK_ERROR);
    }
  }

  async signIn(provider: SignInProvider): PortResult<void> {
    if (provider !== 'google') return err(UNSUPPORTED);
    try {
      const { error } = await this.client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: this.redirectTo },
      });
      if (error) return err(isNetworkError(error) ? NETWORK_ERROR : FAILED);
      return ok(undefined);
    } catch {
      return err(NETWORK_ERROR);
    }
  }

  async signOut(): PortResult<void> {
    try {
      const { error } = await this.client.auth.signOut();
      if (error) return err(isNetworkError(error) ? NETWORK_ERROR : FAILED);
      return ok(undefined);
    } catch {
      return err(NETWORK_ERROR);
    }
  }

  onSessionChange(listener: (session: Session | null) => void): Unsubscribe {
    const { data } = this.client.auth.onAuthStateChange((_event, supabaseSession) => {
      // Deferred: Supabase calls must not be awaited inside this callback (it holds the auth lock).
      setTimeout(() => {
        void this.resolve(supabaseSession).then(listener);
      }, 0);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }

  private async resolve(supabaseSession: SupabaseSession | null): Promise<Session | null> {
    if (!supabaseSession) return null;
    return toSession(supabaseSession, (await this.myAccess()) ?? NO_ACCESS);
  }

  /** `undefined` when the server could not be asked. */
  private async myAccess(): Promise<MyAccess | undefined> {
    try {
      const response = await this.client.rpc('get_my_access');
      const data: unknown = response.data;
      return response.error ? undefined : mapMyAccess(data);
    } catch {
      return undefined;
    }
  }
}

function toSession(supabaseSession: SupabaseSession, access: MyAccess): Session {
  return {
    user: {
      id: supabaseSession.user.id,
      role: access.isAdmin ? 'tutor' : 'tutee',
      accessState: access.accessState,
    },
  };
}

/** Name and e-mail of the signed-in Google account; shown to the user, never used for access. */
function toIdentity(email: string, metadata: unknown): Identity {
  const meta = typeof metadata === 'object' && metadata !== null ? metadata : {};
  const name = 'full_name' in meta ? meta.full_name : 'name' in meta ? meta.name : undefined;
  return typeof name === 'string' && name.trim() !== ''
    ? { displayName: name.trim().slice(0, 100), email }
    : { email };
}
