import { describe, expect, it } from 'vitest';
import { formatSessionDuration, validateSessionRequestRange } from './session-request-rules';

// 2027-03-01T12:00Z is 13:00 in Brussels (UTC+1).
const NOW = new Date('2027-03-01T12:00:00Z');
const check = (startsAt: string, endsAt: string) =>
  validateSessionRequestRange({ startsAt, endsAt }, NOW);

describe('validateSessionRequestRange', () => {
  it('accepts valid ranges at the limits', () => {
    expect(check('2027-03-10T09:00:00Z', '2027-03-10T09:30:00Z')).toBeNull();
    expect(check('2027-03-10T09:00:00Z', '2027-03-10T11:00:00Z')).toBeNull();
    expect(check('2027-03-10T07:00:00Z', '2027-03-10T08:00:00Z')).toBeNull(); // 08:00 local
    expect(check('2027-03-10T20:00:00Z', '2027-03-10T21:00:00Z')).toBeNull(); // 22:00 local
  });

  it('rejects durations, alignment, hours and midnight crossings', () => {
    expect(check('2027-03-10T09:00:00Z', '2027-03-10T09:15:00Z')).toBe('duration-too-short');
    expect(check('2027-03-10T09:00:00Z', '2027-03-10T11:30:00Z')).toBe('duration-too-long');
    expect(check('2027-03-10T09:15:00Z', '2027-03-10T10:15:00Z')).toBe('not-aligned');
    expect(check('2027-03-10T22:30:00Z', '2027-03-10T23:30:00Z')).toBe('not-aligned');
    expect(check('2027-03-10T06:30:00Z', '2027-03-10T07:30:00Z')).toBe('outside-hours');
    expect(check('2027-03-10T20:30:00Z', '2027-03-10T21:30:00Z')).toBe('outside-hours');
    expect(check('2027-03-10T10:00:00Z', '2027-03-10T10:00:00Z')).toBe('invalid-range');
    expect(check('nope', '2027-03-10T10:00:00Z')).toBe('invalid-range');
  });

  it('applies exact 24-hour notice and the 30-day horizon', () => {
    expect(check('2027-03-02T12:00:00Z', '2027-03-02T13:00:00Z')).toBeNull();
    expect(check('2027-03-02T11:30:00Z', '2027-03-02T12:30:00Z')).toBe('too-soon');
    expect(check('2027-03-31T10:00:00Z', '2027-03-31T11:00:00Z')).toBeNull();
    expect(check('2027-03-31T19:30:00Z', '2027-03-31T20:00:00Z')).toBeNull(); // 21:30 local, day 30
    expect(check('2027-04-01T07:00:00Z', '2027-04-01T08:00:00Z')).toBe('too-far'); // day 31
  });

  it('uses calendar dates for the horizon across the clock change', () => {
    // 2027-03-01 13:00 local, day 30 is 2027-03-31 whatever the time of day.
    expect(check('2027-03-31T06:00:00Z', '2027-03-31T06:30:00Z')).toBeNull(); // 08:00 CEST
    const late = new Date('2027-03-01T22:30:00Z'); // 23:30 local
    const lateCheck = (s: string, e: string) =>
      validateSessionRequestRange({ startsAt: s, endsAt: e }, late);
    expect(lateCheck('2027-03-31T10:00:00Z', '2027-03-31T11:00:00Z')).toBeNull();
    expect(lateCheck('2027-04-01T07:00:00Z', '2027-04-01T08:00:00Z')).toBe('too-far');
  });

  it('rejects ranges across the last Sunday of March and October', () => {
    // 2027-03-28 02:00 CET jumps to 03:00 CEST: 01:30 -> 03:30 local is 1 hour elapsed.
    expect(check('2027-03-28T00:30:00Z', '2027-03-28T01:30:00Z')).toBe('ambiguous-local-time');
    // 2027-10-31 03:00 CEST falls back to 02:00 CET: 02:30 -> 02:30 local is 1 hour elapsed.
    const autumn = (s: string, e: string) =>
      validateSessionRequestRange({ startsAt: s, endsAt: e }, new Date('2027-10-01T12:00:00Z'));
    expect(autumn('2027-10-31T00:30:00Z', '2027-10-31T01:30:00Z')).toBe('ambiguous-local-time');
    expect(autumn('2027-10-31T00:00:00Z', '2027-10-31T02:00:00Z')).toBe('ambiguous-local-time');
    // Ordinary ranges on the same days remain valid.
    expect(check('2027-03-28T08:00:00Z', '2027-03-28T09:00:00Z')).toBeNull();
    expect(autumn('2027-10-31T09:00:00Z', '2027-10-31T10:00:00Z')).toBeNull();
  });

  it('rejects instants that are not on a whole minute', () => {
    expect(check('2027-03-10T09:00:30Z', '2027-03-10T10:00:30Z')).toBe('not-aligned');
  });

  it('uses Brussels wall-clock hours across the DST change', () => {
    expect(check('2027-03-30T06:00:00Z', '2027-03-30T07:00:00Z')).toBeNull(); // 08:00 CEST
    expect(check('2027-03-30T05:30:00Z', '2027-03-30T06:30:00Z')).toBe('outside-hours');
    expect(check('2027-03-20T07:00:00Z', '2027-03-20T08:00:00Z')).toBeNull(); // 08:00 CET
  });
});

describe('formatSessionDuration', () => {
  it('formats half-hour steps', () => {
    expect(formatSessionDuration(30)).toBe('30 minutes');
    expect(formatSessionDuration(60)).toBe('1 hour');
    expect(formatSessionDuration(90)).toBe('1 hour 30 minutes');
    expect(formatSessionDuration(120)).toBe('2 hours');
  });
});
