import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js';
import { err, ok } from '../../core/domain/result';
import type { Session, SignInProvider } from '../../core/domain/user';
import type { AuthProvider, PortError, PortResult, Unsubscribe } from '../../core/ports';

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
 * The role is decided by the server through `rpc('is_admin')`; the client never reads
 * the e-mail address or user metadata, and any failure to ask means "not the tutor".
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
      const isAdmin = await this.isAdmin();
      return isAdmin === undefined ? err(NETWORK_ERROR) : ok(toSession(data.session, isAdmin));
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
    return toSession(supabaseSession, (await this.isAdmin()) ?? false);
  }

  /** `undefined` when the server could not be asked. */
  private async isAdmin(): Promise<boolean | undefined> {
    try {
      const response = await this.client.rpc('is_admin');
      const data: unknown = response.data;
      return response.error ? undefined : data === true;
    } catch {
      return undefined;
    }
  }
}

function toSession(supabaseSession: SupabaseSession, isAdmin: boolean): Session {
  return { user: { id: supabaseSession.user.id, role: isAdmin ? 'tutor' : 'tutee' } };
}
