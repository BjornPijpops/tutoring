import { describe, expect, it } from 'vitest';
import { createContainer } from './container';

describe('createContainer', () => {
  it('returns every service wired to in-memory adapters', async () => {
    const services = createContainer({
      supabaseUrl: undefined,
      supabaseAnonKey: undefined,
      basePath: '/tutoring/',
    });

    expect(Object.keys(services).sort()).toEqual([
      'accessRequests',
      'auth',
      'availability',
      'notifier',
      'sessionRequests',
    ]);
    expect(await services.auth.getSession()).toEqual({ ok: true, value: null });
  });

  it('shares slots between availability and session requests', async () => {
    const services = createContainer({
      supabaseUrl: undefined,
      supabaseAnonKey: undefined,
      basePath: '/',
    });
    const slot = await services.availability.upsertSlot({
      startsAt: '2026-01-05T09:00:00Z',
      endsAt: '2026-01-05T10:00:00Z',
    });
    if (!slot.ok) throw new Error('slot not created');
    expect((await services.sessionRequests.create(slot.value.id)).ok).toBe(true);
  });
});
