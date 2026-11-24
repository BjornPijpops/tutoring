import { describe, expect, it } from 'vitest';
import type { CalendarEvent, NewCalendarEvent } from '../../core/domain/calendar-event';
import { InMemoryBlockedTimeRepository } from './in-memory-blocked-time-repository';
import { InMemoryCalendarEventRepository } from './in-memory-calendar-event-repository';

const manual = (startsAt: string, endsAt: string, title = 'Secret title'): NewCalendarEvent => ({
  startsAt,
  endsAt,
  title,
  source: 'manual',
});
const imported = (externalId: string, startsAt: string, endsAt: string): NewCalendarEvent => ({
  startsAt,
  endsAt,
  title: 'Imported',
  source: 'ics',
  externalId,
});
const week = { from: '2026-01-05T00:00:00Z', to: '2026-01-12T00:00:00Z' };

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
}

describe('InMemoryCalendarEventRepository', () => {
  it('stores events, assigns ids and lists only intersecting ones in order', async () => {
    const repo = new InMemoryCalendarEventRepository();
    await repo.addEvents([
      manual('2026-01-07T10:00:00Z', '2026-01-07T11:00:00Z'),
      manual('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z'),
      manual('2026-02-05T10:00:00Z', '2026-02-05T11:00:00Z'),
    ]);

    const listed = unwrap(await repo.listEvents(week));

    expect(listed.map((event) => event.startsAt)).toEqual([
      '2026-01-05T10:00:00Z',
      '2026-01-07T10:00:00Z',
    ]);
    expect(listed.map((event) => event.id)).toEqual(['event-2', 'event-1']);
  });

  it('is idempotent for the same (source, externalId)', async () => {
    const repo = new InMemoryCalendarEventRepository();
    const event = imported('uid#1', '2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z');

    expect(unwrap(await repo.addEvents([event]))).toHaveLength(1);
    expect(unwrap(await repo.addEvents([event]))).toHaveLength(0);
    expect(unwrap(await repo.listEvents(week))).toHaveLength(1);
  });

  it('rejects invalid events without storing any of them', async () => {
    const repo = new InMemoryCalendarEventRepository();
    const result = await repo.addEvents([
      manual('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z'),
      manual('2026-01-05T11:00:00Z', '2026-01-05T10:00:00Z'),
    ]);

    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(unwrap(await repo.listEvents(week))).toHaveLength(0);
  });

  it('removes one event or all imported events only', async () => {
    const repo = new InMemoryCalendarEventRepository();
    const [keep, drop] = unwrap(
      await repo.addEvents([
        manual('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z'),
        manual('2026-01-06T10:00:00Z', '2026-01-06T11:00:00Z'),
      ]),
    ) as [CalendarEvent, CalendarEvent];
    await repo.addEvents([imported('uid#1', '2026-01-07T10:00:00Z', '2026-01-07T11:00:00Z')]);

    expect((await repo.removeEvent(drop.id)).ok).toBe(true);
    expect(await repo.removeEvent(drop.id)).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    });
    await repo.removeImportedEvents();

    expect(unwrap(await repo.listEvents(week)).map((event) => event.id)).toEqual([keep.id]);
  });
});

describe('InMemoryBlockedTimeRepository', () => {
  it('returns merged intervals without titles or ids', async () => {
    const events = new InMemoryCalendarEventRepository();
    await events.addEvents([
      manual('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z'),
      manual('2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z'),
      manual('2026-02-05T10:00:00Z', '2026-02-05T11:00:00Z'),
    ]);

    const blocked = unwrap(
      await new InMemoryBlockedTimeRepository(events).listBlockedIntervals(week),
    );

    expect(blocked).toEqual([{ startsAt: '2026-01-05T10:00:00Z', endsAt: '2026-01-05T12:00:00Z' }]);
    expect(JSON.stringify(blocked)).not.toContain('Secret');
  });
});
