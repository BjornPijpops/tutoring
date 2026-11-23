import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

describe('parseConfig', () => {
  it('accepts valid values', () => {
    const result = parseConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_BASE_PATH: '/x/',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon',
        basePath: '/x/',
      },
    });
  });

  it('allows missing Supabase variables and defaults the base path', () => {
    const result = parseConfig({});
    expect(result).toEqual({
      ok: true,
      value: { supabaseUrl: undefined, supabaseAnonKey: undefined, basePath: '/tutoring/' },
    });
  });

  it('treats empty strings as not provided', () => {
    const result = parseConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' });
    expect(result.ok).toBe(true);
  });

  it('names the invalid field', () => {
    const result = parseConfig({ VITE_SUPABASE_URL: 'not a url' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fields).toEqual(['VITE_SUPABASE_URL']);
      expect(result.error.message).toContain('VITE_SUPABASE_URL');
    }
  });

  it('rejects a base path without a leading slash', () => {
    expect(parseConfig({ VITE_BASE_PATH: 'tutoring' }).ok).toBe(false);
  });
});
