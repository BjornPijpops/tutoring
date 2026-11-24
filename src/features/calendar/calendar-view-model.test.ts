import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { buildWeekModel, weekRange } from './calendar-view-model';

const WEEK = '2026-11-23';
const TODAY = '2026-11-24';

function event(id: string, startsAt: string, endsAt: string, title = id): CalendarEvent {
  return { id, startsAt, endsAt, title, source: 'manual' };
}

describe('buildWeekModel', () => {
  it('builds seven days with 28 open cells and marks today', () => {
    const days = buildWeekModel({ weekStart: WEEK, today: TODAY, blocked: [] });
    expect(days).toHaveLength(7);
    expect(days.map((day) => day.date)[0]).toBe('2026-11-23');
    expect(days.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY]);
    expect(days[0]?.openCells).toHaveLength(28);
    expect(days[0]?.openCells[0]?.label).toBe('08:00');
    expect(days[0]?.openCells[27]?.label).toBe('21:30');
    expect(days[0]?.openCells.every((cell) => cell.state === 'free')).toBe(true);
  });

  it('marks full and partial cells (Brussels winter time is UTC+1)', () => {
    // 09:10-10:30 Brussels on Tuesday
    const blocked = [{ startsAt: '2026-11-24T08:10:00Z', endsAt: '2026-11-24T09:30:00Z' }];
    const tuesday = buildWeekModel({ weekStart: WEEK, today: TODAY, blocked })[1];
    const states = tuesday?.openCells.slice(2, 6).map((cell) => [cell.label, cell.state]);
    expect(states).toEqual([
      ['09:00', 'partial'],
      ['09:30', 'blocked'],
      ['10:00', 'blocked'],
      ['10:30', 'free'],
    ]);
  });

  it('titles only the first cell of an event and counts overlaps', () => {
    const events = [
      event('a', '2026-11-24T08:00:00Z', '2026-11-24T09:00:00Z', 'Maths'),
      event('b', '2026-11-24T08:00:00Z', '2026-11-24T08:30:00Z', 'Other'),
    ];
    const tuesday = buildWeekModel({
      weekStart: WEEK,
      today: TODAY,
      blocked: events,
      events,
    })[1];
    const cells = tuesday?.openCells.slice(2, 5);
    expect(cells?.[0]).toMatchObject({ label: '09:00', title: 'Maths', moreCount: 1 });
    expect(cells?.[1]).toMatchObject({ label: '09:30', state: 'blocked' });
    expect(cells?.[1]?.title).toBeUndefined();
    expect(cells?.[1]?.moreCount).toBe(0);
  });

  it('never carries titles when no events are given', () => {
    const blocked = [{ startsAt: '2026-11-24T08:00:00Z', endsAt: '2026-11-24T09:00:00Z' }];
    const model = buildWeekModel({ weekStart: WEEK, today: TODAY, blocked });
    expect(JSON.stringify(model)).not.toContain('title');
  });

  it('builds list segments: closed, free, blocked, free, closed', () => {
    const events = [event('a', '2026-11-24T08:00:00Z', '2026-11-24T09:30:00Z', 'Maths')];
    const tuesday = buildWeekModel({ weekStart: WEEK, today: TODAY, blocked: events, events })[1];
    expect(tuesday?.segments.map((s) => [s.kind, s.title])).toEqual([
      ['closed', undefined],
      ['free', undefined],
      ['blocked', 'Maths'],
      ['free', undefined],
      ['closed', undefined],
    ]);
  });

  it('has a single free segment on an empty day', () => {
    const monday = buildWeekModel({ weekStart: WEEK, today: TODAY, blocked: [] })[0];
    expect(monday?.segments.map((s) => s.kind)).toEqual(['closed', 'free', 'closed']);
  });

  it('handles exact 08:00/22:00 boundaries and an event spanning midnight', () => {
    const days = buildWeekModel({
      weekStart: '2026-11-23',
      today: TODAY,
      blocked: [
        { startsAt: '2026-11-24T07:00:00Z', endsAt: '2026-11-24T08:00:00Z' },
        { startsAt: '2026-11-24T20:00:00Z', endsAt: '2026-11-25T08:00:00Z' },
      ],
      events: [event('overnight', '2026-11-24T20:00:00Z', '2026-11-25T08:00:00Z', 'Overnight')],
    });
    const tuesday = days[1];
    const wednesday = days[2];
    expect(tuesday?.openCells.at(-1)).toMatchObject({ label: '21:30', state: 'blocked' });
    expect(wednesday?.openCells[0]).toMatchObject({ label: '08:00', state: 'blocked' });
    expect(tuesday?.segments.at(-1)?.kind).toBe('closed');
    expect(wednesday?.segments[1]).toMatchObject({ kind: 'blocked', title: 'Overnight' });
  });
  it('keeps the 25 October day (25 hours) consistent', () => {
    const sunday = buildWeekModel({ weekStart: '2026-10-19', today: TODAY, blocked: [] })[6];
    expect(sunday?.date).toBe('2026-10-25');
    expect(sunday?.openCells).toHaveLength(28);
    const hours =
      (Date.parse(sunday?.closedAfter.endsAt ?? '') -
        Date.parse(sunday?.closedBefore.startsAt ?? '')) /
      3_600_000;
    expect(hours).toBe(25);
  });
});

describe('weekRange', () => {
  it('spans seven local days', () => {
    expect(weekRange(WEEK)).toEqual({
      from: '2026-11-22T23:00:00Z',
      to: '2026-11-29T23:00:00Z',
    });
  });
});
