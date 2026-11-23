import { describe, expect, it } from 'vitest';
import type { AvailabilitySlot } from '../../core/domain/availability-slot';
import { InMemoryAvailabilityRepository } from './in-memory-availability-repository';

const slot = (id: string, startsAt: string): AvailabilitySlot => ({
  id,
  startsAt,
  endsAt: '2026-01-09T10:00:00Z',
  status: 'open',
});

describe('InMemoryAvailabilityRepository', () => {
  it('lists only slots starting in the range, sorted', async () => {
    const repo = new InMemoryAvailabilityRepository({
      seed: [
        slot('b', '2026-01-06T09:00:00Z'),
        slot('a', '2026-01-05T09:00:00Z'),
        slot('c', '2026-02-01T09:00:00Z'),
      ],
    });
    const result = await repo.listSlots({
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-31T00:00:00Z',
    });
    expect(result.ok && result.value.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('creates an open slot with a generated id', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const result = await repo.upsertSlot({
      startsAt: '2026-01-05T09:00:00Z',
      endsAt: '2026-01-05T10:00:00Z',
    });
    expect(result).toMatchObject({ ok: true, value: { id: 'slot-1', status: 'open' } });
  });

  it('updates an existing slot and keeps its status', async () => {
    const repo = new InMemoryAvailabilityRepository({
      seed: [{ ...slot('a', '2026-01-05T09:00:00Z'), status: 'booked' }],
    });
    const result = await repo.upsertSlot({
      id: 'a',
      startsAt: '2026-01-05T11:00:00Z',
      endsAt: '2026-01-05T12:00:00Z',
    });
    expect(result).toMatchObject({ ok: true, value: { id: 'a', status: 'booked' } });
  });

  it('validates that a slot ends after it starts', async () => {
    const result = await new InMemoryAvailabilityRepository().upsertSlot({
      startsAt: '2026-01-05T10:00:00Z',
      endsAt: '2026-01-05T09:00:00Z',
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  it('returns not-found when updating or removing an unknown slot', async () => {
    const repo = new InMemoryAvailabilityRepository();
    const update = await repo.upsertSlot({
      id: 'zzz',
      startsAt: '2026-01-05T09:00:00Z',
      endsAt: '2026-01-05T10:00:00Z',
    });
    expect(update).toMatchObject({ ok: false, error: { kind: 'not-found' } });
    expect(await repo.removeSlot('zzz')).toMatchObject({ ok: false, error: { kind: 'not-found' } });
  });

  it('removes a slot', async () => {
    const repo = new InMemoryAvailabilityRepository({ seed: [slot('a', '2026-01-05T09:00:00Z')] });
    expect(await repo.removeSlot('a')).toEqual({ ok: true, value: undefined });
    expect(repo.find('a')).toBeUndefined();
  });

  it('forbids tutor-only operations for a tutee', async () => {
    const repo = new InMemoryAvailabilityRepository({ actor: { id: 't', role: 'tutee' } });
    expect(await repo.removeSlot('a')).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    const upsert = await repo.upsertSlot({ startsAt: 'a', endsAt: 'b' });
    expect(upsert).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });
});
