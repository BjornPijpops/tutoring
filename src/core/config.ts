import { z } from 'zod';
import { err, ok, type Result } from './domain/result';

/** Validated, public build-time configuration. */
export interface AppConfig {
  /** Supabase project URL; optional until the Supabase adapter lands. */
  readonly supabaseUrl: string | undefined;
  /** Supabase anon (public) key; optional until the Supabase adapter lands. */
  readonly supabaseAnonKey: string | undefined;
  /** Path the site is served from. */
  readonly basePath: string;
}

/** Configuration could not be validated. */
export interface ConfigError {
  readonly message: string;
  /** Names of the invalid environment variables. */
  readonly fields: readonly string[];
}

const DEFAULT_BASE_PATH = '/tutoring/';

// Empty strings (e.g. unset repository variables in CI) count as "not provided".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

// The Supabase variables become required when the Supabase adapter replaces the in-memory one.
const envSchema = z.object({
  VITE_SUPABASE_URL: optional(z.url()),
  VITE_SUPABASE_ANON_KEY: optional(z.string().min(1)),
  VITE_BASE_PATH: optional(z.string().startsWith('/')),
});

/**
 * Validates raw `import.meta.env`-style values into an {@link AppConfig}.
 * Pure: pass the environment in, no globals are read.
 */
export function parseConfig(
  env: Readonly<Record<string, unknown>>,
): Result<AppConfig, ConfigError> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    return err({ message: `Invalid configuration: ${fields.join(', ')}`, fields });
  }
  const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_BASE_PATH } = parsed.data;
  return ok({
    supabaseUrl: VITE_SUPABASE_URL,
    supabaseAnonKey: VITE_SUPABASE_ANON_KEY,
    basePath: VITE_BASE_PATH ?? DEFAULT_BASE_PATH,
  });
}
