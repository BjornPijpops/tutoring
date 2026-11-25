import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { expandRecurrence, type RecurrenceRule } from '../../core/domain/recurrence';
import type { PortResult } from '../../core/ports';
import { InMemoryCalendarEventRepository } from './in-memory-calendar-event-repository';

const TODAY = '2027-03-01';

// Tuesdays 10:00-11:00 Brussels from 23 Mar 2027; the clocks change on 28 Mar.
const rule: RecurrenceRule = {
  startDate: '2027-03-23',
  intervalWeeks: 1,
  weekdays: [2],
  startMinutes: 600,
  endMinutes: 660,
  end: { kind: 'count', count: 8 },
};

function repository(seed: readonly CalendarEvent[] = []) {
  return new InMemoryCalendarEventRepository({ today: () => TODAY, seed });
}

async function unwrap<T>(result: PortResult<T>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(`expected ok, got ${settled.error.kind}`);
  return settled.value;
}

async function seeded(title = 'Dentist') {
  const repo = repository();
  const { seriesId } = await unwrap(
    repo.addSeries({ rule, title, occurrences: expandRecurrence(rule, TODAY).occurrences }),
  );
  const events = repo.snapshot();
  return { repo, seriesId, events };
}

const range = { from: '2027-01-01T00:00:00Z', to: '2028-01-01T00:00:00Z' };

describe('InMemoryCalendarEventRepository series', () => {
  it('creates a series with versioned events and a readable rule', async () => {
    const { repo, seriesId, events } = await seeded();
    expect(events).toHaveLength(8);
    expect(events.every((event) => event.seriesId === seriesId && event.source === 'manual')).toBe(
      true,
    );
    expect(events.every((event) => event.updatedAt !== undefined)).toBe(true);
    expect(events.map((event) => event.startsAt)).toContain('2027-03-30T08:00:00Z');
    expect(await unwrap(repo.getSeries(seriesId))).toEqual(rule);
    expect(await repo.getSeries('nope')).toMatchObject({ error: { kind: 'not-found' } });
  });

  it('reports the number of events created', async () => {
    const repo = repository();
    const result = await unwrap(
      repo.addSeries({ rule, title: 'x', occurrences: expandRecurrence(rule, TODAY).occurrences }),
    );
    expect(result.occurrenceCount).toBe(8);
  });

  it('rejects invalid series without storing anything', async () => {
    const repo = repository();
    const all = expandRecurrence(rule, TODAY).occurrences;
    const first = all[0];
    if (!first) throw new Error('expected an occurrence');
    const cases = [
      { rule: { ...rule, weekdays: [] }, title: 'x', occurrences: all },
      { rule, title: 'x'.repeat(201), occurrences: all },
      { rule, title: 'x', occurrences: [first] },
      { rule, title: 'x', occurrences: Array.from({ length: 401 }, () => first) },
      { rule, title: 'x', occurrences: [first, { ...first, endsAt: first.startsAt }] },
      {
        rule,
        title: 'x',
        occurrences: [first, { startsAt: '2027-03-30T08:15:00Z', endsAt: '2027-03-30T09:00:00Z' }],
      },
      {
        rule,
        title: 'x',
        occurrences: [first, { startsAt: '2027-03-30T05:00:00Z', endsAt: '2027-03-30T06:00:00Z' }],
      },
      {
        rule,
        title: 'x',
        occurrences: [first, { startsAt: '2027-03-30T08:00:00Z', endsAt: '2027-03-31T08:00:00Z' }],
      },
      {
        rule,
        title: 'x',
        occurrences: [first, { startsAt: '2029-03-30T08:00:00Z', endsAt: '2029-03-30T09:00:00Z' }],
      },
      {
        rule,
        title: 'x',
        occurrences: [first, { startsAt: '2027-02-23T09:00:00Z', endsAt: '2027-02-23T10:00:00Z' }],
      },
    ];
    for (const series of cases) {
      expect(await repo.addSeries(series)).toMatchObject({ error: { kind: 'validation' } });
    }
    expect(repo.snapshot()).toHaveLength(0);
  });

  it('does not check overlaps with other events', async () => {
    const repo = repository();
    await unwrap(
      repo.addEvents([
        {
          startsAt: '2027-03-23T09:00:00Z',
          endsAt: '2027-03-23T10:00:00Z',
          title: 'Existing',
          source: 'manual',
        },
      ]),
    );
    const occurrences = expandRecurrence(rule, TODAY).occurrences;
    expect((await repo.addSeries({ rule, title: 'Same slot', occurrences })).ok).toBe(true);
    expect(repo.snapshot()).toHaveLength(9);
  });

  it('keeps imported events out of every series scope', async () => {
    const { repo } = await seeded();
    await repo.addEvents([
      {
        startsAt: '2027-03-23T09:00:00Z',
        endsAt: '2027-03-23T10:00:00Z',
        title: 'Imported',
        source: 'ics',
        externalId: 'uid#1',
      },
    ]);
    const ics = repo.snapshot().find((event) => event.source === 'ics');
    if (!ics) throw new Error('expected an imported event');
    expect(await repo.updateEvent(ics, ics.updatedAt ?? '')).toMatchObject({
      error: { kind: 'validation' },
    });
    expect(await repo.removeEvent(ics.id, 'all')).toMatchObject({ error: { kind: 'validation' } });
    await repo.removeEvent(ics.id);
    expect(repo.snapshot().filter((event) => event.source === 'ics')).toHaveLength(0);
    await repo.removeImportedEvents();
    expect(repo.snapshot()).toHaveLength(8);
  });
});

describe('InMemoryCalendarEventRepository series updates', () => {
  it('updates only this event and keeps the series', async () => {
    const { repo, seriesId, events } = await seeded();
    const target = events[2] as CalendarEvent;
    const result = await unwrap(
      repo.updateEvent(target, target.updatedAt ?? '', 'this', {
        title: 'Moved',
        date: '2027-04-07',
      }),
    );
    expect(result).toMatchObject({ affectedCount: 1, seriesId });
    const stored = repo.snapshot().filter((event) => event.title === 'Moved');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.startsAt).toBe('2027-04-07T08:00:00Z');
    expect(repo.snapshot().filter((event) => event.title === 'Dentist')).toHaveLength(7);
  });

  it('applies title and time changes to all events and keeps Brussels wall-clock time', async () => {
    const { repo, seriesId, events } = await seeded();
    const target = events[0] as CalendarEvent;
    const result = await unwrap(
      repo.updateEvent(target, target.updatedAt ?? '', 'all', {
        title: 'Physio',
        startMinutes: 660,
        endMinutes: 750,
      }),
    );
    expect(result.affectedCount).toBe(8);
    const after = repo.snapshot();
    expect(after.every((event) => event.title === 'Physio')).toBe(true);
    expect(after.map((event) => event.startsAt.slice(0, 16))).toEqual([
      '2027-03-23T10:00',
      '2027-03-30T09:00',
      '2027-04-06T09:00',
      '2027-04-13T09:00',
      '2027-04-20T09:00',
      '2027-04-27T09:00',
      '2027-05-04T09:00',
      '2027-05-11T09:00',
    ]);
    expect(await unwrap(repo.getSeries(seriesId))).toMatchObject({
      startMinutes: 660,
      endMinutes: 750,
    });
  });

  it('splits the series at the clicked event for scope following', async () => {
    const { repo, seriesId, events } = await seeded();
    const target = events[3] as CalendarEvent;
    const result = await unwrap(
      repo.updateEvent(target, target.updatedAt ?? '', 'following', { title: 'Later' }),
    );
    expect(result.affectedCount).toBe(5);
    expect(result.seriesId).toBeDefined();
    expect(result.seriesId).not.toBe(seriesId);
    const after = repo.snapshot();
    expect(after.slice(0, 3).every((event) => event.seriesId === seriesId)).toBe(true);
    expect(after.slice(3).every((event) => event.seriesId === result.seriesId)).toBe(true);
    expect(after.slice(0, 3).every((event) => event.title === 'Dentist')).toBe(true);
    expect(after.slice(3).every((event) => event.title === 'Later')).toBe(true);
    expect(await unwrap(repo.getSeries(seriesId))).toMatchObject({
      end: { kind: 'until', date: '2027-04-06' },
    });
    expect(await unwrap(repo.getSeries(result.seriesId ?? ''))).toMatchObject({
      startDate: '2027-04-13',
      end: { kind: 'until', date: '2027-05-11' },
    });
  });

  it('follows the occurrence order after one occurrence was moved to a later date', async () => {
    const { repo, seriesId, events } = await seeded();
    const first = events[0] as CalendarEvent;
    await unwrap(repo.updateEvent(first, first.updatedAt ?? '', 'this', { date: '2027-05-20' }));
    const earlier = repo.snapshot().find((event) => event.id === (events[2] as CalendarEvent).id);
    const result = await unwrap(
      repo.updateEvent(earlier as CalendarEvent, earlier?.updatedAt ?? '', 'following', {
        title: 'Later',
      }),
    );
    expect(result.affectedCount).toBe(6);
    const moved = repo.snapshot().find((event) => event.id === first.id);
    expect(moved?.seriesId).toBe(seriesId);
    expect(moved?.title).toBe('Dentist');
    const second = repo.snapshot().find((event) => event.id === (events[1] as CalendarEvent).id);
    expect(second?.seriesId).toBe(seriesId);
    const split = repo.snapshot().filter((event) => event.seriesId === result.seriesId);
    expect(split.map((event) => event.seriesIndex)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(await unwrap(repo.getSeries(seriesId))).toMatchObject({
      end: { kind: 'until', date: '2027-05-20' },
    });
    expect(await unwrap(repo.getSeries(result.seriesId ?? ''))).toMatchObject({
      startDate: '2027-04-06',
      end: { kind: 'until', date: '2027-05-11' },
    });
  });

  it('does not reach earlier occurrences that were moved past the clicked one', async () => {
    const { repo, seriesId, events } = await seeded();
    const second = events[1] as CalendarEvent;
    await unwrap(repo.updateEvent(second, second.updatedAt ?? '', 'this', { date: '2027-05-20' }));
    const clicked = repo.snapshot().find((event) => event.id === (events[5] as CalendarEvent).id);
    const result = await unwrap(
      repo.updateEvent(clicked as CalendarEvent, clicked?.updatedAt ?? '', 'following', {
        title: 'Tail',
      }),
    );
    expect(result.affectedCount).toBe(3);
    const after = repo.snapshot();
    expect(after.find((event) => event.id === second.id)).toMatchObject({
      seriesId,
      title: 'Dentist',
    });
    expect(after.filter((event) => event.title === 'Tail')).toHaveLength(3);
  });

  it('removes by occurrence order after an occurrence was moved', async () => {
    const { repo, events } = await seeded();
    const first = events[0] as CalendarEvent;
    await unwrap(repo.updateEvent(first, first.updatedAt ?? '', 'this', { date: '2027-05-20' }));
    const result = await unwrap(repo.removeEvent((events[3] as CalendarEvent).id, 'following'));
    expect(result.affectedCount).toBe(5);
    expect(repo.snapshot().map((event) => event.id)).toEqual(
      [events[1], events[2], first].map((event) => (event as CalendarEvent).id),
    );
  });

  it('rejects a rule that does not match the occurrences', async () => {
    const repo = repository();
    const { occurrences } = expandRecurrence(rule, TODAY);
    const mismatched = { ...rule, end: { kind: 'count', count: 5 } } as const;
    expect(await repo.addSeries({ rule: mismatched, title: 'x', occurrences })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    const early = { ...rule, startDate: '2027-02-01' };
    expect(await repo.addSeries({ rule: early, title: 'x', occurrences })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
  });

  it('does not split when the clicked event is the first one', async () => {
    const { repo, seriesId, events } = await seeded();
    const target = events[0] as CalendarEvent;
    const result = await unwrap(
      repo.updateEvent(target, target.updatedAt ?? '', 'following', { title: 'All of it' }),
    );
    expect(result).toMatchObject({ affectedCount: 8, seriesId });
  });

  it('derives changes from the passed event when none are given', async () => {
    const { repo, events } = await seeded();
    const target = events[1] as CalendarEvent;
    const edited = { ...target, title: 'Renamed' };
    const result = await unwrap(repo.updateEvent(edited, target.updatedAt ?? ''));
    expect(result.event.title).toBe('Renamed');
    expect(result.event.startsAt).toBe(target.startsAt);
    expect(result.event.updatedAt).toBeDefined();
  });

  it('rejects stale versions, unknown events and invalid scopes or changes', async () => {
    const { repo, events } = await seeded();
    const target = events[0] as CalendarEvent;
    const version = target.updatedAt ?? '';
    expect(await repo.updateEvent(target, '2000-01-01T00:00:00Z')).toMatchObject({
      error: { kind: 'conflict' },
    });
    expect(await repo.updateEvent({ ...target, id: 'nope' }, version)).toMatchObject({
      error: { kind: 'not-found' },
    });
    const invalid: Record<string, object> = {
      date: { date: '2027-04-07' },
      grid: { startMinutes: 615 },
      early: { startMinutes: 420 },
      late: { endMinutes: 1380 },
      order: { startMinutes: 720 },
      title: { title: 'x'.repeat(201) },
      horizon: { date: '2029-01-05' },
      past: { date: '2027-02-01' },
    };
    for (const [name, changes] of Object.entries(invalid)) {
      const scope = name === 'date' ? 'all' : 'this';
      expect(await repo.updateEvent(target, version, scope, changes)).toMatchObject({
        error: { kind: 'validation' },
      });
    }
    expect(repo.snapshot()[0]).toEqual(target);
  });

  it('rejects series scopes for events outside a series', async () => {
    const repo = repository();
    const [single] = await unwrap(
      repo.addEvents([
        {
          startsAt: '2027-03-23T09:00:00Z',
          endsAt: '2027-03-23T10:00:00Z',
          title: 'Single',
          source: 'manual',
        },
      ]),
    );
    const event = single as CalendarEvent;
    expect(await repo.updateEvent(event, event.updatedAt ?? '', 'all')).toMatchObject({
      error: { kind: 'validation' },
    });
    expect(await repo.removeEvent(event.id, 'following')).toMatchObject({
      error: { kind: 'validation' },
    });
    const result = await unwrap(repo.updateEvent(event, event.updatedAt ?? '', 'this'));
    expect(result.affectedCount).toBe(1);
    expect(result.seriesId).toBeUndefined();
  });
});

describe('InMemoryCalendarEventRepository series removal', () => {
  it('removes one event and keeps the series', async () => {
    const { repo, seriesId, events } = await seeded();
    const result = await unwrap(repo.removeEvent((events[4] as CalendarEvent).id));
    expect(result.affectedCount).toBe(1);
    expect(repo.snapshot()).toHaveLength(7);
    expect((await repo.getSeries(seriesId)).ok).toBe(true);
  });

  it('removes this and following events and ends the series the day before', async () => {
    const { repo, seriesId, events } = await seeded();
    const result = await unwrap(repo.removeEvent((events[5] as CalendarEvent).id, 'following'));
    expect(result.affectedCount).toBe(3);
    expect(repo.snapshot()).toHaveLength(5);
    expect(await unwrap(repo.getSeries(seriesId))).toMatchObject({
      end: { kind: 'until', date: '2027-04-20' },
    });
  });

  it('removes the whole series and its rule', async () => {
    const { repo, seriesId, events } = await seeded();
    const result = await unwrap(repo.removeEvent((events[3] as CalendarEvent).id, 'all'));
    expect(result.affectedCount).toBe(8);
    expect(await unwrap(repo.listEvents(range))).toHaveLength(0);
    expect(await repo.getSeries(seriesId)).toMatchObject({ error: { kind: 'not-found' } });
  });

  it('drops the rule when following from the first event empties the series', async () => {
    const { repo, seriesId, events } = await seeded();
    const result = await unwrap(repo.removeEvent((events[0] as CalendarEvent).id, 'following'));
    expect(result.affectedCount).toBe(8);
    expect(await repo.getSeries(seriesId)).toMatchObject({ error: { kind: 'not-found' } });
  });

  it('reports a missing event', async () => {
    expect(await repository().removeEvent('nope', 'all')).toMatchObject({
      error: { kind: 'not-found' },
    });
  });
});
