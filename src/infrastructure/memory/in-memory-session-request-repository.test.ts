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
      value: { status: 'accepted' },
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
