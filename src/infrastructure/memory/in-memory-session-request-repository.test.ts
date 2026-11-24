import { describe, expect, it } from 'vitest';
import type { AvailabilitySlot } from '../../core/domain/availability-slot';
import { InMemoryAvailabilityRepository } from './in-memory-availability-repository';
import { InMemorySessionRequestRepository } from './in-memory-session-request-repository';

const openSlot: AvailabilitySlot = {
  id: 'slot-a',
  startsAt: '2026-01-05T09:00:00Z',
  endsAt: '2026-01-05T10:00:00Z',
  status: 'open',
};

function setup(slot: AvailabilitySlot = openSlot) {
  const availability = new InMemoryAvailabilityRepository({ seed: [slot] });
  const repo = new InMemorySessionRequestRepository({ availability });
  return { availability, repo };
}

describe('InMemorySessionRequestRepository', () => {
  it('creates a pending request for an open slot', async () => {
    const { repo } = setup();
    expect(await repo.create('slot-a')).toMatchObject({
      ok: true,
      value: { slotId: 'slot-a', status: 'pending', userId: 'user-1' },
    });
    const mine = await repo.listMine();
    expect(mine.ok && mine.value).toHaveLength(1);
  });

  it('conflicts when the slot is booked', async () => {
    const { repo } = setup({ ...openSlot, status: 'booked' });
    expect(await repo.create('slot-a')).toMatchObject({ ok: false, error: { kind: 'conflict' } });
  });

  it('returns not-found for an unknown slot', async () => {
    const { repo } = setup();
    expect(await repo.create('nope')).toMatchObject({ ok: false, error: { kind: 'not-found' } });
  });

  it('books the slot when accepted and then conflicts for competing requests', async () => {
    const { repo, availability } = setup();
    await repo.create('slot-a');
    await repo.create('slot-a');
    expect(await repo.decide('session-request-1', 'accepted')).toMatchObject({
      ok: true,
      value: { request: { status: 'accepted' }, overlapDeclinedCount: 1 },
    });
    expect(availability.find('slot-a')?.status).toBe('booked');
    expect(await repo.decide('session-request-2', 'accepted')).toMatchObject({
      ok: false,
      error: { kind: 'conflict' },
    });
  });

  it('leaves the slot open when declined and drops it from pending', async () => {
    const { repo, availability } = setup();
    await repo.create('slot-a');
    await repo.decide('session-request-1', 'declined');
    expect(availability.find('slot-a')?.status).toBe('open');
    const pending = await repo.listPending();
    expect(pending.ok && pending.value).toHaveLength(0);
  });

  it('returns not-found when deciding an unknown request', async () => {
    const { repo } = setup();
    expect(await repo.decide('nope', 'declined')).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    });
  });

  it('forbids tutor-only operations for a tutee', async () => {
    const availability = new InMemoryAvailabilityRepository({ seed: [openSlot] });
    const repo = new InMemorySessionRequestRepository({
      availability,
      actor: { id: 't', role: 'tutee' },
    });
    expect(await repo.listPending()).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await repo.decide('x', 'accepted')).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });
});

describe('InMemorySessionRequestRepository (range requests)', () => {
  const range = (day: string, start: string, end: string) => ({
    startsAt: `2026-01-${day}T${start}:00Z`,
    endsAt: `2026-01-${day}T${end}:00Z`,
  });
  const tutor = () => new InMemorySessionRequestRepository({});
  const tutee = (seed: ConstructorParameters<typeof InMemorySessionRequestRepository>[0] = {}) =>
    new InMemorySessionRequestRepository({ actor: { id: 'tutee-1', role: 'tutee' }, ...seed });

  it.each([
    ['09:00', '09:15', 'Choose a session of at least 30 minutes.'],
    ['09:00', '11:30', 'Choose a session of no more than 2 hours.'],
    ['09:15', '10:15', 'Choose a start and end time on the 30-minute grid.'],
    ['06:00', '07:00', 'Choose a time on one day between 08:00 and 22:00.'],
  ])('blocks %s-%s with the specified copy', async (start, end, message) => {
    expect(await tutee().create(range('10', start, end))).toMatchObject({
      ok: false,
      error: { kind: 'validation', message },
    });
  });

  it('enforces 24 hours notice and the 30-day horizon', async () => {
    expect(await tutee().create(range('01', '12:00', '13:00'))).toMatchObject({
      ok: false,
      error: { message: 'Requests must be made at least 24 hours in advance.' },
    });
    expect(
      await tutee().create({ startsAt: '2026-03-10T09:00:00Z', endsAt: '2026-03-10T10:00:00Z' }),
    ).toMatchObject({
      ok: false,
      error: { message: 'Requests can be made up to 30 days ahead.' },
    });
  });

  it('rejects a fourth pending request but not after an acceptance', async () => {
    const repo = tutee();
    for (const day of ['10', '11', '12'])
      expect((await repo.create(range(day, '09:00', '10:00'))).ok).toBe(true);
    expect(await repo.create(range('13', '09:00', '10:00'))).toMatchObject({
      ok: false,
      error: { kind: 'conflict', code: 'pending_limit' },
    });
  });

  it('declines overlapping pending requests on acceptance and reports the count', async () => {
    const seed = (id: string, userId: string, start: string, end: string) => ({
      id,
      userId,
      status: 'pending' as const,
      createdAt: '2026-01-01T00:00:00Z',
      ...range('10', start, end),
    });
    const repo = tutor();
    const other = new InMemorySessionRequestRepository({
      seed: [
        seed('a', 'u1', '09:00', '10:00'),
        seed('b', 'u2', '09:30', '10:30'),
        seed('c', 'u3', '10:00', '11:00'),
      ],
    });
    expect(await other.decide('a', 'accepted')).toMatchObject({
      ok: true,
      value: { request: { status: 'accepted' }, overlapDeclinedCount: 1 },
    });
    const pending = await other.listPending();
    expect(pending.ok && pending.value.map((r) => r.id)).toEqual(['c']);
    expect(await repo.decide('a', 'accepted')).toMatchObject({ ok: false });
  });

  it('refuses a request over an accepted session and keeps cancel owner-only', async () => {
    const accepted = {
      id: 'x',
      userId: 'someone',
      status: 'accepted' as const,
      createdAt: '2026-01-01T00:00:00Z',
      ...range('10', '09:00', '10:00'),
    };
    const repo = tutee({ seed: [accepted] });
    expect(await repo.create(range('10', '09:30', '10:30'))).toMatchObject({
      ok: false,
      error: { code: 'schedule_unavailable' },
    });
    expect(await repo.create(range('10', '10:00', '11:00'))).toMatchObject({ ok: true });
    expect(await repo.cancel('x')).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await repo.cancel('nope')).toMatchObject({ ok: false, error: { kind: 'not-found' } });
  });

  it('cancels pending and accepted requests once, keeping history', async () => {
    const repo = tutee();
    const made = await repo.create(range('10', '09:00', '10:00'));
    const id = made.ok ? made.value.id : '';
    expect(await repo.cancel(id)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    expect(await repo.cancel(id)).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    const mine = await repo.listMine();
    expect(mine.ok && mine.value.map((r) => r.status)).toEqual(['cancelled']);
    expect(await repo.create(range('10', '09:00', '10:00'))).toMatchObject({ ok: true });
  });

  it('lists only accepted sessions in range for the tutor, and refuses tutees', async () => {
    const seed = (id: string, status: 'accepted' | 'pending', day: string) => ({
      id,
      userId: 'u1',
      status,
      createdAt: '2026-01-01T00:00:00Z',
      ...range(day, '09:00', '10:00'),
    });
    const repo = new InMemorySessionRequestRepository({
      seed: [seed('a', 'accepted', '10'), seed('b', 'pending', '10'), seed('c', 'accepted', '20')],
    });
    const listed = await repo.listAccepted({
      startsAt: '2026-01-09T00:00:00Z',
      endsAt: '2026-01-12T00:00:00Z',
    });
    expect(listed.ok && listed.value.map((r) => r.id)).toEqual(['a']);
    expect(
      await tutee().listAccepted({
        startsAt: '2026-01-09T00:00:00Z',
        endsAt: '2026-01-12T00:00:00Z',
      }),
    ).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('does not leak other users requests through listMine', async () => {
    const repo = tutee({
      seed: [
        {
          id: 'o',
          userId: 'someone',
          status: 'accepted',
          createdAt: '2026-01-01T00:00:00Z',
          ...range('10', '09:00', '10:00'),
        },
      ],
    });
    const mine = await repo.listMine();
    expect(mine.ok && mine.value).toEqual([]);
  });
});
