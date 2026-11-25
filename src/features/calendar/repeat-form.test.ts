import { describe, expect, it } from 'vitest';
import {
  defaultEndDate,
  defaultRepeatValues,
  followDate,
  repeatEventCount,
  repeatOptions,
  repeatSummary,
  toggleWeekday,
  validateRepeat,
  weekdayOf,
  type RepeatBase,
  type RepeatFormValues,
} from './repeat-form';

const TODAY = '2026-11-25';
const BASE: RepeatBase = { date: '2026-12-01', startMinutes: 600, endMinutes: 660 };

const withValues = (patch: Partial<RepeatFormValues>): RepeatFormValues => ({
  ...defaultRepeatValues(BASE.date, TODAY),
  ...patch,
});

describe('repeat defaults', () => {
  it('starts as does-not-repeat with the end three months after the start', () => {
    const values = defaultRepeatValues('2026-12-01', TODAY);
    expect(values.choice).toBe('none');
    expect(values.endKind).toBe('until');
    expect(values.endDate).toBe('2027-03-01');
    expect(values.weekdays).toEqual([2]);
    expect(values.intervalWeeks).toBe('1');
  });

  it('caps the suggested end at the 12-month limit', () => {
    expect(defaultEndDate('2027-10-01', TODAY)).toBe('2027-11-25');
  });

  it('has no end date or weekday without a valid date', () => {
    const values = defaultRepeatValues('', TODAY);
    expect(values.endDate).toBe('');
    expect(values.weekdays).toEqual([]);
  });

  it('names the weekday in the weekly option', () => {
    expect(repeatOptions('2026-12-01').map((option) => option.label)).toEqual([
      'Does not repeat',
      'Every week on Tuesday',
      'Every weekday (Monday to Friday)',
      'Custom\u2026',
    ]);
    expect(weekdayOf('2026-12-06')).toBe(7);
    expect(weekdayOf('nope')).toBeUndefined();
  });
});

describe('followDate', () => {
  it('moves the weekday and end date until the tutor touches them', () => {
    const next = followDate(defaultRepeatValues('2026-12-01', TODAY), '2026-12-03', TODAY);
    expect(next.weekdays).toEqual([4]);
    expect(next.endDate).toBe('2027-03-03');
  });

  it('keeps a chosen end date and chosen weekdays', () => {
    const touched = toggleWeekday(
      withValues({ endDate: '2027-01-01', endDateTouched: true }),
      3,
      true,
    );
    const next = followDate(touched, '2026-12-03', TODAY);
    expect(next.endDate).toBe('2027-01-01');
    expect(next.weekdays).toEqual([2, 3]);
  });
});

describe('toggleWeekday', () => {
  it('adds in Monday-first order and removes', () => {
    let values = withValues({});
    values = toggleWeekday(values, 5, true);
    values = toggleWeekday(values, 1, true);
    expect(values.weekdays).toEqual([1, 2, 5]);
    expect(toggleWeekday(values, 2, false).weekdays).toEqual([1, 5]);
  });
});

describe('validateRepeat', () => {
  it('accepts does-not-repeat without a rule', () => {
    expect(validateRepeat(withValues({}), BASE, TODAY)).toEqual({ errors: {} });
  });

  it('builds a weekly rule on the weekday of the date', () => {
    const { rule, errors } = validateRepeat(withValues({ choice: 'weekly' }), BASE, TODAY);
    expect(errors).toEqual({});
    expect(rule?.weekdays).toEqual([2]);
    expect(rule?.intervalWeeks).toBe(1);
  });

  it('builds a Monday to Friday rule', () => {
    const { rule } = validateRepeat(withValues({ choice: 'weekdays' }), BASE, TODAY);
    expect(rule?.weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it.each(['0', '13', '', 'x'])('rejects the interval %j', (intervalWeeks) => {
    const { errors } = validateRepeat(withValues({ choice: 'custom', intervalWeeks }), BASE, TODAY);
    expect(errors.repeatInterval).toBe('Enter a number of weeks from 1 to 12.');
  });

  it('requires at least one weekday in a custom pattern', () => {
    const values = toggleWeekday(withValues({ choice: 'custom' }), 2, false);
    expect(validateRepeat(values, BASE, TODAY).errors.repeatWeekdays).toBe(
      'Choose at least one day.',
    );
  });

  it('names the latest allowed date when the end is too late', () => {
    const { errors } = validateRepeat(
      withValues({ choice: 'weekly', endDate: '2028-01-01' }),
      BASE,
      TODAY,
    );
    expect(errors.repeatEndDate).toContain('25 Nov 2027');
  });

  it('rejects a missing end date and an end before the start', () => {
    expect(
      validateRepeat(withValues({ choice: 'weekly', endDate: '' }), BASE, TODAY).errors
        .repeatEndDate,
    ).toBe('Enter an end date.');
    expect(
      validateRepeat(withValues({ choice: 'weekly', endDate: '2026-11-30' }), BASE, TODAY).errors
        .repeatEndDate,
    ).toContain('1 Dec 2026');
  });

  it.each(['1', '401', ''])('rejects the count %j', (count) => {
    const { errors } = validateRepeat(
      withValues({ choice: 'weekly', endKind: 'count', count }),
      BASE,
      TODAY,
    );
    expect(errors.repeatCount).toBe('Enter a number of events from 2 to 400.');
  });

  it('reports a date in the past on the date field', () => {
    const past = { ...BASE, date: '2026-11-01' };
    expect(validateRepeat(withValues({ choice: 'weekly' }), past, TODAY).errors.date).toBe(
      'Choose today or a later date for a repeating event.',
    );
  });
});

describe('repeat summary and count', () => {
  it('describes a valid rule with its count', () => {
    const values = withValues({ choice: 'weekly', endKind: 'count', count: '4' });
    expect(repeatSummary(values, BASE, TODAY)).toBe('Weekly on Tue until 22 Dec 2026 (4 events)');
    expect(repeatEventCount(values, BASE, TODAY)).toBe(4);
  });

  it('asks for a choice while the rule is incomplete', () => {
    const message = 'Choose how this event repeats to see a summary.';
    expect(repeatSummary(withValues({}), BASE, TODAY)).toBe(message);
    expect(repeatSummary(withValues({ choice: 'weekly' }), undefined, TODAY)).toBe(message);
    expect(
      repeatEventCount(withValues({ choice: 'weekly', endKind: 'count', count: '1' }), BASE, TODAY),
    ).toBeUndefined();
  });
});
