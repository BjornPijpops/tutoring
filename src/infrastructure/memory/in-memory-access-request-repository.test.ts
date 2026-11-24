import { describe, expect, it } from 'vitest';
import type { AccessRequestSummary } from '../../core/domain/access-request';
import { InMemoryAccessRequestRepository } from './in-memory-access-request-repository';
import { type Actor } from './support';

const TUTEE: Actor = { id: 'tutee-1', role: 'tutee' };
const TUTOR: Actor = { id: 'tutor-1', role: 'tutor' };
const START = Date.parse('2026-01-05T10:00:00Z');

function setup() {
  let now = START;
  const clock = () => new Date(now).toISOString().replace('.000Z', 'Z');
  const repo = new InMemoryAccessRequestRepository({
    actor: TUTEE,
    now: clock,
    people: { 'tutee-1': { displayName: 'Alex Example', email: 'alex@example.test' } },
  });
  return {
    tutee: repo,
    tutor: repo.as(TUTOR),
    repo,
    advanceHours: (hours: number) => {
      now += hours * 3_600_000;
    },
  };
}

describe('InMemoryAccessRequestRepository', () => {
  it('creates a pending request with one notification event and is idempotent while pending', async () => {
    const { tutee, repo } = setup();
    const created = await tutee.requestAccess('  hello  ');
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: 'tutee-1',
        userId: 'tutee-1',
        status: 'pending',
        message: 'hello',
        requestCount: 1,
        decidedAt: null,
        nextRequestAt: null,
      },
    });
    await tutee.requestAccess('again');
    expect(await tutee.getMine()).toMatchObject({ ok: true, value: { message: 'hello' } });
    expect(repo.notificationCount).toBe(1);
  });

  it('rejects a message over 500 characters and the tutor asking', async () => {
    const { tutee, tutor } = setup();
    expect(await tutee.requestAccess('x'.repeat(501))).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    expect((await tutee.requestAccess('x'.repeat(500))).ok).toBe(true);
    expect(await tutor.requestAccess('hi')).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });

  it('returns null from getMine before asking', async () => {
    expect(await setup().tutee.getMine()).toEqual({ ok: true, value: null });
  });

  it('lets the tutor approve and revoke, starting an eight hour cooldown on denial', async () => {
    const { tutee, tutor } = setup();
    await tutee.requestAccess('');
    expect(await tutor.decide('tutee-1', 'approved')).toMatchObject({
      ok: true,
      value: { status: 'approved', nextRequestAt: null, decidedAt: '2026-01-05T10:00:00Z' },
    });
    expect(await tutor.decide('tutee-1', 'denied')).toMatchObject({
      ok: true,
      value: { status: 'denied', nextRequestAt: '2026-01-05T18:00:00Z' },
    });
  });

  it('blocks asking again until the exact cooldown boundary, then counts a new event', async () => {
    const { tutee, tutor, repo, advanceHours } = setup();
    await tutee.requestAccess('first');
    await tutor.decide('tutee-1', 'denied');
    advanceHours(7.99);
    expect(await tutee.requestAccess('early')).toMatchObject({
      ok: false,
      error: { kind: 'conflict', code: 'cooldown_active' },
    });
    advanceHours(0.01);
    expect(await tutee.requestAccess('second')).toMatchObject({
      ok: true,
      value: { status: 'pending', message: 'second', requestCount: 2, decidedAt: null },
    });
    expect(repo.notificationCount).toBe(2);
  });

  it('lets the tutor clear the cooldown, only for denied requests', async () => {
    const { tutee, tutor } = setup();
    await tutee.requestAccess('');
    expect(await tutor.allowRequestAgain('tutee-1')).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    });
    await tutor.decide('tutee-1', 'denied');
    expect(await tutor.allowRequestAgain('tutee-1')).toMatchObject({
      ok: true,
      value: { nextRequestAt: null },
    });
    expect((await tutee.requestAccess('again')).ok).toBe(true);
  });

  it('lists pending first, newest first, filtered, with name and e-mail', async () => {
    const { tutor, repo, advanceHours } = setup();
    await repo.requestAccess('one');
    advanceHours(1);
    await repo.as({ id: 'tutee-2', role: 'tutee' }).requestAccess('');
    advanceHours(1);
    await repo.as({ id: 'tutee-3', role: 'tutee' }).requestAccess('');
    await tutor.decide('tutee-3', 'approved');

    const all = await tutor.listRequests();
    expect(all.ok && all.value.map((r) => [r.userId, r.status])).toEqual([
      ['tutee-2', 'pending'],
      ['tutee-1', 'pending'],
      ['tutee-3', 'approved'],
    ]);
    expect(all.ok && all.value[1]).toMatchObject({
      displayName: 'Alex Example',
      email: 'alex@example.test',
    });
    const approved = await tutor.listRequests('approved');
    expect(approved.ok && approved.value).toHaveLength(1);
  });

  it('closes new requests at 50 pending but keeps serving existing users', async () => {
    const seed: AccessRequestSummary[] = Array.from({ length: 50 }, (_, index) => ({
      userId: `seed-${String(index)}`,
      displayName: 'Seed',
      email: 'seed@example.test',
      message: '',
      status: 'pending',
      requestedAt: '2026-01-01T00:00:00Z',
      decidedAt: null,
      nextRequestAt: null,
      requestCount: 1,
    }));
    const repo = new InMemoryAccessRequestRepository({ actor: TUTEE, seed });
    expect(await repo.requestAccess('hi')).toMatchObject({
      ok: false,
      error: { kind: 'conflict', code: 'access_requests_closed' },
    });
    const existing = new InMemoryAccessRequestRepository({
      actor: { id: 'seed-1', role: 'tutee' },
      seed,
    });
    expect((await existing.requestAccess('hi')).ok).toBe(true);
  });

  it('returns not-found for an unknown user', async () => {
    expect(await setup().tutor.decide('nope', 'denied')).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    });
  });

  it('forbids tutor-only operations for a tutee', async () => {
    const { tutee } = setup();
    expect(await tutee.listRequests()).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await tutee.decide('x', 'approved')).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    expect(await tutee.allowRequestAgain('x')).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });
});
