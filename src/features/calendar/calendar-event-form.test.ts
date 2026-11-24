import { describe, expect, it } from 'vitest';
import { validateCalendarEventForm } from './calendar-event-form';

describe('calendar event form', () => {
  it('rejects reversed and closed-only intervals', () => {
    expect(
      validateCalendarEventForm({ date: '2026-11-24', start: '10:00', end: '09:00', title: '' })
        .errors.end,
    ).toContain('after');
    expect(
      validateCalendarEventForm({ date: '2026-11-24', start: '22:00', end: '23:00', title: '' })
        .errors.end,
    ).toContain('08:00');
  });
  it('maps a valid Brussels event to UTC', () => {
    const result = validateCalendarEventForm({
      date: '2026-11-24',
      start: '10:00',
      end: '11:00',
      title: 'Focus',
    });
    expect(result.event).toMatchObject({
      title: 'Focus',
      source: 'manual',
      startsAt: '2026-11-24T09:00:00Z',
    });
  });
  it('clips to open hours and returns the clipped values', () => {
    const result = validateCalendarEventForm({
      date: '2026-11-24',
      start: '07:00',
      end: '23:00',
      title: 'Long',
    });
    expect(result.clipped).toBe(true);
    expect(result.clippedValues).toEqual({
      date: '2026-11-24',
      start: '08:00',
      end: '22:00',
      title: 'Long',
    });
    expect(
      validateCalendarEventForm({ date: '2026-11-24', start: '09:00', end: '10:00', title: '' })
        .clippedValues,
    ).toBeUndefined();
  });
});
