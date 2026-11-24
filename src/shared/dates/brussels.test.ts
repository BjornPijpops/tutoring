import { describe, expect, it } from 'vitest';
import {
  formatDayLabel,
  formatEventWhen,
  formatShortDate,
  formatTime,
  formatTimeRange,
  formatWeekRange,
  timeZoneNote,
  todayInBrussels,
} from './brussels';

describe('brussels formatting', () => {
  it('formats days and dates in en-GB', () => {
    expect(formatDayLabel('2026-11-24')).toBe('Tue 24 Nov');
    expect(formatShortDate('2027-11-24')).toBe('24 Nov 2027');
  });

  it('formats Brussels times on a 24-hour clock', () => {
    expect(formatTime('2026-11-24T13:00:00Z')).toBe('14:00');
    expect(formatTime('2027-06-15T12:00:00Z')).toBe('14:00');
    expect(formatTimeRange('2026-11-24T08:30:00Z', '2026-11-24T10:00:00Z')).toBe('09:30-11:00');
  });

  it('formats events within and across days', () => {
    expect(formatEventWhen('2026-11-24T13:00:00Z', '2026-11-24T14:30:00Z')).toBe(
      'Tue 24 Nov, 14:00-15:30',
    );
    expect(formatEventWhen('2026-11-23T21:00:00Z', '2026-11-24T01:00:00Z')).toBe(
      'Mon 23 Nov 22:00 - Tue 24 Nov 02:00',
    );
  });

  it('formats week ranges', () => {
    expect(formatWeekRange('2026-11-23')).toBe('23 - 29 November 2026');
    expect(formatWeekRange('2026-11-30')).toBe('30 Nov - 6 Dec 2026');
    expect(formatWeekRange('2026-12-28')).toBe('28 Dec 2026 - 3 Jan 2027');
  });

  it('uses the Brussels date for today', () => {
    expect(todayInBrussels(new Date('2026-11-24T23:30:00Z'))).toBe('2026-11-25');
  });

  it('describes the time zone of the week', () => {
    expect(timeZoneNote('2026-11-23')).toBe('Times are shown in Brussels time (CET, UTC+1).');
    expect(timeZoneNote('2027-06-14')).toBe('Times are shown in Brussels time (CEST, UTC+2).');
    expect(timeZoneNote('2026-10-19')).toContain('clocks change on Sunday 25 October');
    expect(timeZoneNote('2026-03-23')).toContain('clocks change on Sunday 29 March');
    expect(timeZoneNote('2026-11-23', 'America/New_York')).toContain(
      'Your device is set to America/New_York.',
    );
  });
});
