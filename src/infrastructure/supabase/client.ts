import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../../core/config';

/** Supabase settings that are guaranteed to be present. */
export interface SupabaseSettings {
  readonly url: string;
  readonly anonKey: string;
}

/** Returns the Supabase settings when both public values are configured. */
export function supabaseSettings(config: AppConfig): SupabaseSettings | undefined {
  return config.supabaseUrl && config.supabaseAnonKey
    ? { url: config.supabaseUrl, anonKey: config.supabaseAnonKey }
    : undefined;
}

/**
 * Creates the Supabase client. PKCE keeps tokens out of the URL fragment, which the
 * HashRouter owns: the OAuth callback arrives as `?code=` in the query string.
 */
export function createSupabaseClient({ url, anonKey }: SupabaseSettings): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  }) as SupabaseClient;
}
