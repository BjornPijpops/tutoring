import { describe, expect, it } from 'vitest';
import {
  blockedIntervals,
  clipInterval,
  closedHoursIntervals,
  freeIntervals,
  isBlocked,
  mergeIntervals,
} from './blocked-intervals';
import { durationMs, type Interval } from './interval';

const HOUR = 3_600_000;
const iv = (startsAt: string, endsAt: string): Interval => ({ startsAt, endsAt });

describe('clipInterval', () => {
  const range = { from: '2026-01-05T09:00:00Z', to: '2026-01-05T12:00:00Z' };

  it('keeps only the part inside the range', () => {
    expect(clipInterval(iv('2026-01-05T08:00:00Z', '2026-01-05T10:00:00Z'), range)).toEqual(
      iv('2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z'),
    );
  });

  it('returns null without overlap, also when only touching', () => {
    expect(clipInterval(iv('2026-01-05T12:00:00Z', '2026-01-05T13:00:00Z'), range)).toBeNull();
    expect(clipInterval(iv('2026-01-05T07:00:00Z', '2026-01-05T08:00:00Z'), range)).toBeNull();
  });
});

describe('mergeIntervals', () => {
  it('sorts and merges overlapping and touching intervals', () => {
    const merged = mergeIntervals([
      iv('2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z'),
      iv('2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z'),
      iv('2026-01-05T10:00:00Z', '2026-01-05T10:30:00Z'),
      iv('2026-01-05T09:30:00Z', '2026-01-05T09:45:00Z'),
    ]);
    expect(merged).toEqual([
      iv('2026-01-05T09:00:00Z', '2026-01-05T10:30:00Z'),
      iv('2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z'),
    ]);
  });

  it('drops invalid, reversed and empty intervals', () => {
    expect(
      mergeIntervals([
        iv('nope', '2026-01-05T10:00:00Z'),
        iv('2026-01-05T10:00:00Z', '2026-01-05T09:00:00Z'),
        iv('2026-01-05T10:00:00Z', '2026-01-05T10:00:00Z'),
      ]),
    ).toEqual([]);
  });

  it('clips to a range before merging', () => {
    expect(
      mergeIntervals([iv('2026-01-05T08:00:00Z', '2026-01-05T13:00:00Z')], {
        from: '2026-01-05T09:00:00Z',
        to: '2026-01-05T10:00:00Z',
      }),
    ).toEqual([iv('2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z')]);
  });
});

describe('closedHoursIntervals', () => {
  it('returns the hours before 08:00 and after 22:00 Brussels time (winter)', () => {
    const closed = closedHoursIntervals({
      from: '2026-01-05T00:00:00Z',
      to: '2026-01-06T00:00:00Z',
    });
    expect(closed).toEqual([
      iv('2026-01-05T00:00:00Z', '2026-01-05T07:00:00Z'),
      iv('2026-01-05T21:00:00Z', '2026-01-06T00:00:00Z'),
    ]);
  });

  it('uses the summer offset in July', () => {
    const closed = closedHoursIntervals({
      from: '2026-07-05T00:00:00Z',
      to: '2026-07-06T00:00:00Z',
    });
    expect(closed).toEqual([
      iv('2026-07-05T00:00:00Z', '2026-07-05T06:00:00Z'),
      iv('2026-07-05T20:00:00Z', '2026-07-06T00:00:00Z'),
    ]);
  });

  it('gives the 23-hour spring-forward day (2026-03-29) its real length', () => {
    const closed = closedHoursIntervals({
      from: '2026-03-28T23:00:00Z',
      to: '2026-03-29T22:00:00Z',
    });
    expect(closed).toEqual([
      iv('2026-03-28T23:00:00Z', '2026-03-29T06:00:00Z'),
      iv('2026-03-29T20:00:00Z', '2026-03-29T22:00:00Z'),
    ]);
    const total = closed.reduce((sum, interval) => sum + durationMs(interval), 0);
    expect(total).toBe(9 * HOUR);
  });

  it('gives the 25-hour fall-back day (2026-10-25) its real length', () => {
    const closed = closedHoursIntervals({
      from: '2026-10-24T22:00:00Z',
      to: '2026-10-25T23:00:00Z',
    });
    expect(closed).toEqual([
      iv('2026-10-24T22:00:00Z', '2026-10-25T07:00:00Z'),
      iv('2026-10-25T21:00:00Z', '2026-10-25T23:00:00Z'),
    ]);
    expect(durationMs(closed[0] as Interval) + durationMs(closed[1] as Interval)).toBe(11 * HOUR);
  });

  it('clips closed hours to the range and handles an empty range', () => {
    expect(
      closedHoursIntervals({ from: '2026-01-05T06:00:00Z', to: '2026-01-05T08:00:00Z' }),
    ).toEqual([iv('2026-01-05T06:00:00Z', '2026-01-05T07:00:00Z')]);
    expect(
      closedHoursIntervals({ from: '2026-01-05T06:00:00Z', to: '2026-01-05T06:00:00Z' }),
    ).toEqual([]);
  });
});

describe('blockedIntervals', () => {
  const range = { from: '2026-01-05T00:00:00Z', to: '2026-01-06T00:00:00Z' };

  it('unites closed hours and events into canonical merged intervals', () => {
    const blocked = blockedIntervals({
      range,
      eventIntervals: [
        iv('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z'),
        iv('2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z'),
        iv('2026-01-05T06:30:00Z', '2026-01-05T08:00:00Z'),
      ],
    });
    expect(blocked).toEqual([
      iv('2026-01-05T00:00:00Z', '2026-01-05T08:00:00Z'),
      iv('2026-01-05T10:00:00Z', '2026-01-05T12:00:00Z'),
      iv('2026-01-05T21:00:00Z', '2026-01-06T00:00:00Z'),
    ]);
  });

  it('ignores event parts outside the range', () => {
    const blocked = blockedIntervals({
      range,
      eventIntervals: [iv('2026-01-04T10:00:00Z', '2026-01-08T10:00:00Z')],
    });
    expect(blocked).toEqual([iv(range.from, range.to)]);
  });
});

describe('isBlocked / freeIntervals', () => {
  const blocked = [iv('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z')];

  it('treats intervals as half-open', () => {
    expect(isBlocked(blocked, '2026-01-05T10:00:00Z')).toBe(true);
    expect(isBlocked(blocked, '2026-01-05T11:00:00Z')).toBe(false);
  });

  it('returns what is left of a range', () => {
    expect(
      freeIntervals({ from: '2026-01-05T09:00:00Z', to: '2026-01-05T12:00:00Z' }, blocked),
    ).toEqual([
      iv('2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z'),
      iv('2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z'),
    ]);
  });
});
