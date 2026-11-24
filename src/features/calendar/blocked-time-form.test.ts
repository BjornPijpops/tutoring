import { describe, expect, it } from 'vitest';
import { validateBlockedTimeForm } from './blocked-time-form';

const valid = { date: '2026-11-24', start: '14:00', end: '15:30', title: 'Maths' };

describe('validateBlockedTimeForm', () => {
  it('builds a manual event in Brussels time', () => {
    expect(validateBlockedTimeForm(valid)).toEqual({
      errors: {},
      partlyClosed: false,
      event: {
        startsAt: '2026-11-24T13:00:00Z',
        endsAt: '2026-11-24T14:30:00Z',
        title: 'Maths',
        source: 'manual',
      },
    });
  });

  it('uses summer time in summer', () => {
    const result = validateBlockedTimeForm({ ...valid, date: '2027-06-15' });
    expect(result.event?.startsAt).toBe('2027-06-15T12:00:00Z');
  });

  it('allows an empty title and trims it', () => {
    expect(validateBlockedTimeForm({ ...valid, title: '  ' }).event?.title).toBe('');
  });

  it('requires date, start and end', () => {
    const result = validateBlockedTimeForm({ date: '', start: '', end: '', title: '' });
    expect(result.errors).toEqual({
      date: 'Enter a date.',
      start: 'Enter a start time.',
      end: 'Enter an end time.',
    });
    expect(result.event).toBeUndefined();
  });

  it('rejects an end that is not after the start', () => {
    expect(validateBlockedTimeForm({ ...valid, end: '14:00' }).errors.end).toContain(
      'End time must be after the start time.',
    );
  });

  it('rejects titles over 200 characters', () => {
    expect(validateBlockedTimeForm({ ...valid, title: 'x'.repeat(201) }).errors.title).toBe(
      'Title must be 200 characters or fewer.',
    );
  });

  it('rejects ranges entirely in closed hours', () => {
    const late = validateBlockedTimeForm({ ...valid, start: '22:30', end: '23:30' });
    expect(late.errors.end).toContain('already closed');
    const early = validateBlockedTimeForm({ ...valid, start: '06:00', end: '08:00' });
    expect(early.errors.end).toContain('already closed');
  });

  it('accepts partly closed ranges and reports it', () => {
    const result = validateBlockedTimeForm({ ...valid, start: '07:00', end: '09:00' });
    expect(result.errors).toEqual({});
    expect(result.partlyClosed).toBe(true);
    expect(result.event).toBeDefined();
  });
});
