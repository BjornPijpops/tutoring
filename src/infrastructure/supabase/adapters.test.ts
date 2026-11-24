import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuthProvider } from './auth-provider';
import { SupabaseBlockedTimeRepository } from './blocked-time-repository';
import { SupabaseCalendarEventRepository } from './calendar-event-repository';

const asClient = (fake: unknown) => fake as SupabaseClient;

/** Chainable query builder that resolves to `result` when awaited. */
function builder(result: unknown, calls: { name: string; args: unknown[] }[] = []) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === 'then') {
          return (resolve: (value: unknown) => void) => {
            resolve(result);
          };
        }
        return (...args: unknown[]) => {
          calls.push({ name, args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

describe('SupabaseAuthProvider', () => {
  const session = { user: { id: 'u1', email: 'x@example.test' } };

  function provider(overrides: { auth?: object; rpc?: unknown }) {
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(),
      ...overrides.auth,
    };
    const rpc = vi.fn().mockResolvedValue(overrides.rpc ?? { data: true, error: null });
    return {
      auth,
      rpc,
      adapter: new SupabaseAuthProvider(asClient({ auth, rpc }), 'https://x.test/app/'),
    };
  }

  it('maps the admin check to the tutor role without exposing the e-mail', async () => {
    const { adapter, rpc } = provider({});
    const result = await adapter.getSession();
    expect(rpc).toHaveBeenCalledWith('is_admin');
    expect(result).toEqual({ ok: true, value: { user: { id: 'u1', role: 'tutor' } } });
  });

  it('maps a non-admin to tutee', async () => {
    const { adapter } = provider({ rpc: { data: false, error: null } });
    expect(await adapter.getSession()).toEqual({
      ok: true,
      value: { user: { id: 'u1', role: 'tutee' } },
    });
  });

  it('reports unavailable when the admin check fails', async () => {
    const { adapter } = provider({ rpc: { data: null, error: { message: 'boom' } } });
    const result = await adapter.getSession();
    expect(result.ok).toBe(false);
  });

  it('returns null without a session and does not call the rpc', async () => {
    const { adapter, rpc } = provider({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    });
    expect(await adapter.getSession()).toEqual({ ok: true, value: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('starts Google PKCE sign-in with the redirect URL', async () => {
    const { adapter, auth } = provider({});
    expect((await adapter.signIn('google')).ok).toBe(true);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://x.test/app/' },
    });
  });

  it('does not support Microsoft', async () => {
    const { adapter, auth } = provider({});
    const result = await adapter.signIn('azure');
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-supported' } });
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('maps network failures on sign-in and sign-out', async () => {
    const networkError = { name: 'AuthRetryableFetchError', message: 'x' };
    const { adapter } = provider({
      auth: {
        signInWithOAuth: vi.fn().mockResolvedValue({ error: networkError }),
        signOut: vi.fn().mockRejectedValue(new Error('offline')),
      },
    });
    expect(await adapter.signIn('google')).toMatchObject({ error: { kind: 'unavailable' } });
    expect(await adapter.signOut()).toMatchObject({ error: { kind: 'unavailable' } });
  });

  it('notifies listeners of session changes and unsubscribes', async () => {
    vi.useFakeTimers();
    let handler: (event: string, session: unknown) => void = () => undefined;
    const unsubscribe = vi.fn();
    const { adapter } = provider({
      auth: {
        onAuthStateChange: vi.fn((cb: typeof handler) => {
          handler = cb;
          return { data: { subscription: { unsubscribe } } };
        }),
      },
    });
    const listener = vi.fn();
    const stop = adapter.onSessionChange(listener);
    handler('SIGNED_IN', session);
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledWith({ user: { id: 'u1', role: 'tutor' } });
    stop();
    expect(unsubscribe).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('SupabaseCalendarEventRepository', () => {
  const row = {
    id: 'e1',
    starts_at: '2026-11-24T09:00:00+00:00',
    ends_at: '2026-11-24T10:00:00+00:00',
    title: 'Lesson',
    source: 'manual',
    external_id: null,
  };
  const range = { from: '2026-11-23T00:00:00Z', to: '2026-11-30T00:00:00Z' };

  it('lists events overlapping the range', async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const client = { from: vi.fn(() => builder({ data: [row], error: null }, calls)) };
    const result = await new SupabaseCalendarEventRepository(asClient(client)).listEvents(range);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 'e1',
          startsAt: '2026-11-24T09:00:00Z',
          endsAt: '2026-11-24T10:00:00Z',
          title: 'Lesson',
          source: 'manual',
        },
      ],
    });
    expect(calls).toContainEqual({ name: 'lt', args: ['starts_at', range.to] });
    expect(calls).toContainEqual({ name: 'gt', args: ['ends_at', range.from] });
  });

  it('maps a forbidden error', async () => {
    const client = { from: () => builder({ data: null, error: { code: '42501', message: 'x' } }) };
    const result = await new SupabaseCalendarEventRepository(asClient(client)).listEvents(range);
    expect(result).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('rejects invalid events before calling the service', async () => {
    const from = vi.fn();
    const result = await new SupabaseCalendarEventRepository(asClient({ from })).addEvents([
      { startsAt: range.to, endsAt: range.from, title: 'Bad', source: 'manual' },
    ]);
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(from).not.toHaveBeenCalled();
  });

  it('upserts in batches with conflict handling', async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const client = { from: vi.fn(() => builder({ data: [row], error: null }, calls)) };
    const events = Array.from({ length: 501 }, (_, i) => ({
      startsAt: '2026-11-24T09:00:00Z',
      endsAt: '2026-11-24T10:00:00Z',
      title: 'Imported',
      source: 'ics' as const,
      externalId: `uid#${String(i)}`,
    }));
    const result = await new SupabaseCalendarEventRepository(asClient(client)).addEvents(events);
    expect(result.ok).toBe(true);
    const upserts = calls.filter((call) => call.name === 'upsert');
    expect(upserts).toHaveLength(2);
    expect(upserts[0]?.args[1]).toEqual({
      onConflict: 'source,external_id',
      ignoreDuplicates: true,
    });
  });

  it('returns not-found when a delete removes no row', async () => {
    const client = { from: () => builder({ data: [], error: null }) };
    const repo = new SupabaseCalendarEventRepository(asClient(client));
    expect(await repo.removeEvent('x')).toMatchObject({ ok: false, error: { kind: 'not-found' } });
  });

  it('removes an event and imported events', async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const client = { from: () => builder({ data: [{ id: 'e1' }], error: null }, calls) };
    const repo = new SupabaseCalendarEventRepository(asClient(client));
    expect((await repo.removeEvent('e1')).ok).toBe(true);
    expect((await repo.removeImportedEvents()).ok).toBe(true);
    expect(calls).toContainEqual({ name: 'eq', args: ['source', 'ics'] });
  });

  it('maps thrown errors to unavailable', async () => {
    const client = {
      from: () => {
        throw new Error('offline');
      },
    };
    const repo = new SupabaseCalendarEventRepository(asClient(client));
    expect(await repo.listEvents(range)).toMatchObject({ error: { kind: 'unavailable' } });
    expect(await repo.removeImportedEvents()).toMatchObject({ error: { kind: 'unavailable' } });
  });
});

describe('SupabaseBlockedTimeRepository', () => {
  const range = { from: '2026-11-23T00:00:00Z', to: '2026-11-30T00:00:00Z' };

  it('calls the RPC and maps intervals', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ starts_at: '2026-11-24T09:00:00+00:00', ends_at: '2026-11-24T10:00:00+00:00' }],
      error: null,
    });
    const result = await new SupabaseBlockedTimeRepository(asClient({ rpc })).listBlockedIntervals(
      range,
    );
    expect(rpc).toHaveBeenCalledWith('get_blocked_intervals', {
      p_from: range.from,
      p_to: range.to,
    });
    expect(result).toEqual({
      ok: true,
      value: [{ startsAt: '2026-11-24T09:00:00Z', endsAt: '2026-11-24T10:00:00Z' }],
    });
  });

  it('maps errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
    const repo = new SupabaseBlockedTimeRepository(asClient({ rpc }));
    expect(await repo.listBlockedIntervals(range)).toMatchObject({ error: { kind: 'forbidden' } });
    rpc.mockRejectedValue(new Error('offline'));
    expect(await repo.listBlockedIntervals(range)).toMatchObject({
      error: { kind: 'unavailable' },
    });
  });
});
