import { describe, expect, it } from 'vitest';
import {
  expandRecurrence,
  formatRecurrenceSummary,
  latestRecurrenceDate,
  recurrenceProblem,
  ruleOccurrenceProblem,
  validateRecurrence,
  type RecurrenceRule,
  type Weekday,
} from './recurrence';

const rule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  startDate: '2027-03-01',
  intervalWeeks: 1,
  weekdays: [2],
  startMinutes: 18 * 60,
  endMinutes: 20 * 60,
  end: { kind: 'count', count: 3 },
  ...overrides,
});

const dates = (r: RecurrenceRule, today = '2027-03-01') =>
  expandRecurrence(r, today).occurrences.map((o) => o.date);

describe('expandRecurrence', () => {
  it('starts on the first selected weekday on or after the start date', () => {
    // 2027-03-01 is a Monday; Tuesday is the next day.
    expect(dates(rule())).toEqual(['2027-03-02', '2027-03-09', '2027-03-16']);
    // Start on a Wednesday: the Tuesday of that week is skipped.
    expect(dates(rule({ startDate: '2027-03-03' }), '2027-03-03')).toEqual([
      '2027-03-09',
      '2027-03-16',
      '2027-03-23',
    ]);
  });

  it('handles several weekdays in date order, whatever order they are given', () => {
    const weekdays: Weekday[] = [4, 2, 3, 2];
    expect(dates(rule({ weekdays, end: { kind: 'count', count: 5 } }))).toEqual([
      '2027-03-02',
      '2027-03-03',
      '2027-03-04',
      '2027-03-09',
      '2027-03-10',
    ]);
  });

  it('anchors every N weeks on the Monday-based week of the start date', () => {
    // Start on Sunday 2027-03-07: its week begins Monday 03-01. Next occurrence is 2 weeks later.
    const r = rule({
      startDate: '2027-03-07',
      intervalWeeks: 2,
      weekdays: [1, 7],
      end: { kind: 'count', count: 4 },
    });
    expect(dates(r, '2027-03-07')).toEqual([
      '2027-03-07',
      '2027-03-15',
      '2027-03-21',
      '2027-03-29',
    ]);
  });

  it('ends on a date, inclusive', () => {
    const r = rule({ weekdays: [2], end: { kind: 'until', date: '2027-03-16' } });
    expect(dates(r)).toEqual(['2027-03-02', '2027-03-09', '2027-03-16']);
  });

  it('never passes the 12-month horizon', () => {
    const r = rule({ end: { kind: 'until', date: '2030-01-01' } });
    const all = dates(r);
    expect(all.at(-1)).toBe('2028-02-29');
    expect(latestRecurrenceDate('2027-03-01')).toBe('2028-03-01');
    expect(all.every((date) => date <= '2028-03-01')).toBe(true);
  });

  it('clamps the horizon to the end of a shorter month', () => {
    expect(latestRecurrenceDate('2027-02-28')).toBe('2028-02-28');
    expect(latestRecurrenceDate('2028-02-29')).toBe('2029-02-28');
  });

  it('returns nothing for an unusable interval instead of looping', () => {
    expect(dates(rule({ intervalWeeks: 0 }))).toEqual([]);
  });

  describe('Brussels wall clock across daylight-saving changes', () => {
    const wall = (r: RecurrenceRule, today: string) =>
      expandRecurrence(r, today).occurrences.map((o) => `${o.date} ${o.startsAt} ${o.endsAt}`);

    it('keeps 09:00-10:00 over the last Sunday of March (2027-03-28)', () => {
      const r = rule({
        startDate: '2027-03-26',
        weekdays: [5, 6, 7, 1],
        startMinutes: 9 * 60,
        endMinutes: 10 * 60,
        end: { kind: 'count', count: 4 },
      });
      expect(wall(r, '2027-03-01')).toEqual([
        '2027-03-26 2027-03-26T08:00:00Z 2027-03-26T09:00:00Z',
        '2027-03-27 2027-03-27T08:00:00Z 2027-03-27T09:00:00Z',
        '2027-03-28 2027-03-28T07:00:00Z 2027-03-28T08:00:00Z',
        '2027-03-29 2027-03-29T07:00:00Z 2027-03-29T08:00:00Z',
      ]);
    });

    it('keeps 09:00-10:00 over the last Sunday of October (2027-10-31)', () => {
      const r = rule({
        startDate: '2027-10-29',
        weekdays: [5, 6, 7, 1],
        startMinutes: 9 * 60,
        endMinutes: 10 * 60,
        end: { kind: 'count', count: 4 },
      });
      expect(wall(r, '2027-10-01')).toEqual([
        '2027-10-29 2027-10-29T07:00:00Z 2027-10-29T08:00:00Z',
        '2027-10-30 2027-10-30T07:00:00Z 2027-10-30T08:00:00Z',
        '2027-10-31 2027-10-31T08:00:00Z 2027-10-31T09:00:00Z',
        '2027-11-01 2027-11-01T08:00:00Z 2027-11-01T09:00:00Z',
      ]);
    });

    it('keeps the evening slot of a weekly series on every side of both changes', () => {
      const r = rule({
        startDate: '2027-03-23',
        weekdays: [2],
        startMinutes: 19 * 60 + 30,
        endMinutes: 21 * 60,
        end: { kind: 'until', date: '2028-03-01' },
      });
      const { occurrences } = expandRecurrence(r, '2027-03-20');
      const march = occurrences.find((o) => o.date === '2027-03-30');
      const october = occurrences.find((o) => o.date === '2027-10-26');
      const winter = occurrences.find((o) => o.date === '2027-11-02');
      expect(occurrences[0]?.startsAt).toBe('2027-03-23T18:30:00Z');
      expect(march?.startsAt).toBe('2027-03-30T17:30:00Z');
      expect(october?.startsAt).toBe('2027-10-26T17:30:00Z');
      expect(winter?.startsAt).toBe('2027-11-02T18:30:00Z');
      const minutes = (o: { startsAt: string; endsAt: string }) =>
        (Date.parse(o.endsAt) - Date.parse(o.startsAt)) / 60_000;
      expect(occurrences.every((o) => minutes(o) === 90)).toBe(true);
    });
  });
});

describe('validateRecurrence', () => {
  const today = '2027-03-01';
  const check = (overrides: Partial<RecurrenceRule>) => validateRecurrence(rule(overrides), today);

  it('accepts a valid rule', () => {
    expect(check({})).toBeUndefined();
  });

  it.each([
    [
      'a past start',
      { startDate: '2027-02-28' },
      'Choose today or a later date for a repeating event.',
    ],
    ['a malformed start', { startDate: '2027-13-01' }, 'Enter a date.'],
    ['an interval of 0', { intervalWeeks: 0 }, 'Enter a number of weeks from 1 to 12.'],
    ['an interval of 13', { intervalWeeks: 13 }, 'Enter a number of weeks from 1 to 12.'],
    ['no weekday', { weekdays: [] }, 'Choose at least one day.'],
    ['a start before 08:00', { startMinutes: 450 }, 'Choose a time between 08:00 and 22:00.'],
    ['an end after 22:00', { endMinutes: 1350 }, 'Choose a time between 08:00 and 22:00.'],
    ['an off-grid time', { startMinutes: 8 * 60 + 15 }, 'Choose a time between 08:00 and 22:00.'],
    ['an end before the start', { endMinutes: 17 * 60 }, 'Choose a time between 08:00 and 22:00.'],
    [
      'a count of 1',
      { end: { kind: 'count', count: 1 } },
      'Enter a number of events from 2 to 400.',
    ],
    [
      'a count of 401',
      { end: { kind: 'count', count: 401 } },
      'Enter a number of events from 2 to 400.',
    ],
    [
      'an end before the start date',
      { end: { kind: 'until', date: '2027-02-01' } },
      'Choose an end date on or after 1 Mar 2027.',
    ],
    [
      'an end past 12 months',
      { end: { kind: 'until', date: '2028-03-02' } },
      'Choose an end date on or before 1 Mar 2028. Events can repeat for 12 months at most.',
    ],
    [
      'an end that gives one event',
      { end: { kind: 'until', date: '2027-03-02' } },
      'This would create only one event. Choose a later end.',
    ],
  ] as const)('rejects %s', (_name, overrides, message) => {
    expect(check(overrides as Partial<RecurrenceRule>)).toBe(message);
  });

  it('never silently shortens a count that passes the horizon', () => {
    expect(check({ end: { kind: 'count', count: 100 } })).toBe(
      '100 events would run past 1 Mar 2028, the latest date allowed. Choose fewer events or an earlier end.',
    );
  });

  it('names the field each problem belongs to', () => {
    const field = (overrides: Partial<RecurrenceRule>) =>
      recurrenceProblem(rule(overrides), today)?.field;
    expect(field({ startDate: '2027-02-28' })).toBe('date');
    expect(field({ intervalWeeks: 0 })).toBe('interval');
    expect(field({ weekdays: [] })).toBe('weekdays');
    expect(field({ startMinutes: 450 })).toBe('time');
    expect(field({ end: { kind: 'until', date: '2027-02-01' } })).toBe('endDate');
    expect(field({ end: { kind: 'count', count: 1 } })).toBe('count');
    expect(field({ end: { kind: 'until', date: '2027-03-02' } })).toBe('end');
    expect(field({})).toBeUndefined();
  });

  it('accepts the largest daily series within a year', () => {
    const everyDay: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
    expect(
      check({ weekdays: everyDay, end: { kind: 'until', date: '2028-03-01' } }),
    ).toBeUndefined();
    expect(
      dates(rule({ weekdays: everyDay, end: { kind: 'until', date: '2028-03-01' } })),
    ).toHaveLength(367);
  });
});

describe('formatRecurrenceSummary', () => {
  const today = '2027-03-01';

  it('summarises a weekly multi-day series with a plural count', () => {
    expect(
      formatRecurrenceSummary(
        rule({ weekdays: [2, 3, 4], end: { kind: 'count', count: 6 } }),
        today,
      ),
    ).toBe('Weekly on Tue, Wed, Thu until 11 Mar 2027 (6 events)');
  });

  it('uses "Every weekday" and "Every N weeks"', () => {
    expect(
      formatRecurrenceSummary(
        rule({ weekdays: [1, 2, 3, 4, 5], end: { kind: 'count', count: 5 } }),
        today,
      ),
    ).toBe('Every weekday until 5 Mar 2027 (5 events)');
    expect(
      formatRecurrenceSummary(rule({ intervalWeeks: 2, end: { kind: 'count', count: 2 } }), today),
    ).toBe('Every 2 weeks on Tue until 16 Mar 2027 (2 events)');
  });

  it('can leave the count out for describing a stored series', () => {
    expect(formatRecurrenceSummary(rule({ end: { kind: 'count', count: 3 } }), today, false)).toBe(
      'Weekly on Tue until 16 Mar 2027',
    );
  });

  it('says "event" for a single occurrence and guides when empty', () => {
    expect(formatRecurrenceSummary(rule({ end: { kind: 'count', count: 1 } }), today)).toMatch(
      /\(1 event\)$/,
    );
    expect(formatRecurrenceSummary(rule({ weekdays: [] }), today)).toBe(
      'Choose how this event repeats to see a summary.',
    );
  });
});

describe('ruleOccurrenceProblem', () => {
  const today = '2027-03-01';
  const dated = ['2027-03-02', '2027-03-09', '2027-03-16'];
  const problem = (overrides: Partial<RecurrenceRule>, found = dated) =>
    ruleOccurrenceProblem(rule({ startDate: '2027-03-02', ...overrides }), found, today);

  it('accepts a rule that agrees with its occurrences', () => {
    expect(problem({})).toBeUndefined();
    expect(problem({ end: { kind: 'until', date: '2027-03-16' } })).toBeUndefined();
  });

  it.each([
    ['a start date in the past', { startDate: '2027-02-28' }],
    ['a start date after the first occurrence', { startDate: '2027-03-03' }],
    ['a start date beyond the 12-month limit', { startDate: '2028-03-02' }],
    ['an end date before the start date', { end: { kind: 'until', date: '2027-03-01' } }],
    ['an end date before the last occurrence', { end: { kind: 'until', date: '2027-03-10' } }],
    ['an end date past the 12-month limit', { end: { kind: 'until', date: '2028-03-02' } }],
    ['a count that differs from the occurrences', { end: { kind: 'count', count: 4 } }],
  ] satisfies [string, Partial<RecurrenceRule>][])('rejects %s', (_name, overrides) => {
    expect(problem(overrides)).toMatch(/does not match/);
  });

  it('rejects no occurrences', () => {
    expect(problem({}, [])).toMatch(/does not match/);
  });
});
