import { describe, expect, it } from 'vitest';
import {
  addDays,
  isIsoDate,
  localDateOf,
  localTimeOf,
  startOfWeek,
  wallTimeToInstant,
  weekDates,
} from './local-time';
import { fromMs, isValidInterval, isValidRange, overlaps, toMs } from './interval';

describe('local-time', () => {
  it('validates iso dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-02-28')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('starts the week on Monday', () => {
    expect(startOfWeek('2026-11-24')).toBe('2026-11-23');
    expect(startOfWeek('2026-11-29')).toBe('2026-11-23');
    expect(startOfWeek('2026-11-23')).toBe('2026-11-23');
    expect(weekDates('2026-11-23')).toHaveLength(7);
    expect(weekDates('2026-11-23')[6]).toBe('2026-11-29');
  });

  it('converts Brussels wall time to UTC with the correct offset', () => {
    expect(wallTimeToInstant('2026-01-05', 8, 0, 'Europe/Brussels')).toBe('2026-01-05T07:00:00Z');
    expect(wallTimeToInstant('2026-07-05', 8, 0, 'Europe/Brussels')).toBe('2026-07-05T06:00:00Z');
    expect(wallTimeToInstant('2026-03-29', 8, 0, 'Europe/Brussels')).toBe('2026-03-29T06:00:00Z');
    expect(wallTimeToInstant('2026-10-25', 8, 0, 'Europe/Brussels')).toBe('2026-10-25T07:00:00Z');
  });

  it('reads the local date and time of an instant', () => {
    expect(localDateOf('2026-01-05T23:30:00Z', 'Europe/Brussels')).toBe('2026-01-06');
    expect(localTimeOf('2026-07-05T06:30:00Z', 'Europe/Brussels')).toEqual({ hour: 8, minute: 30 });
  });
});

describe('interval', () => {
  it('rejects reversed, empty and unparseable intervals', () => {
    expect(
      isValidInterval({ startsAt: '2026-01-05T10:00:00Z', endsAt: '2026-01-05T11:00:00Z' }),
    ).toBe(true);
    expect(
      isValidInterval({ startsAt: '2026-01-05T11:00:00Z', endsAt: '2026-01-05T10:00:00Z' }),
    ).toBe(false);
    expect(
      isValidInterval({ startsAt: '2026-01-05T10:00:00Z', endsAt: '2026-01-05T10:00:00Z' }),
    ).toBe(false);
    expect(isValidInterval({ startsAt: 'x', endsAt: 'y' })).toBe(false);
    expect(isValidRange({ from: '2026-01-05T10:00:00Z', to: '2026-01-05T11:00:00Z' })).toBe(true);
  });

  it('detects overlap but not touching', () => {
    const a = { startsAt: '2026-01-05T10:00:00Z', endsAt: '2026-01-05T11:00:00Z' };
    expect(overlaps(a, { startsAt: '2026-01-05T10:30:00Z', endsAt: '2026-01-05T12:00:00Z' })).toBe(
      true,
    );
    expect(overlaps(a, { startsAt: '2026-01-05T11:00:00Z', endsAt: '2026-01-05T12:00:00Z' })).toBe(
      false,
    );
  });

  it('round-trips milliseconds', () => {
    expect(fromMs(toMs('2026-01-05T10:00:00Z'))).toBe('2026-01-05T10:00:00Z');
  });
});
