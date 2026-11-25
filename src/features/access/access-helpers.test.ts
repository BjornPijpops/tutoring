import { describe, expect, it } from 'vitest';
import type { AccessRequest } from '../../core/domain/access-request';
import { getAccessView } from './access-view';
import { formatCooldown } from './format-cooldown';

const request = (overrides: Partial<AccessRequest>): AccessRequest => ({
  id: 'u',
  userId: 'u',
  status: 'pending',
  message: '',
  createdAt: '2026-11-24T09:00:00Z',
  requestedAt: '2026-11-24T09:00:00Z',
  decidedAt: null,
  nextRequestAt: null,
  requestCount: 1,
  ...overrides,
});

const NOW = new Date('2026-11-24T12:00:00Z');

describe('getAccessView', () => {
  it('picks the view per state', () => {
    expect(getAccessView(null, NOW)).toBe('form');
    expect(getAccessView(request({ status: 'pending' }), NOW)).toBe('pending');
    expect(getAccessView(request({ status: 'approved' }), NOW)).toBe('approved');
  });

  it('shows blocked tutees the denial view without a retry date', () => {
    expect(
      getAccessView(request({ status: 'denied', nextRequestAt: null, canAskAgain: false }), NOW),
    ).toBe('denied-blocked');
  });

  it('keeps a denied tutee waiting until exactly nextRequestAt', () => {
    const denied = request({ status: 'denied', nextRequestAt: '2026-11-24T12:00:00Z' });
    expect(getAccessView(denied, new Date('2026-11-24T11:59:59Z'))).toBe('denied-waiting');
    expect(getAccessView(denied, NOW)).toBe('denied-can-ask');
  });

  it('lets a denied tutee ask when the wait was cleared', () => {
    expect(getAccessView(request({ status: 'denied', nextRequestAt: null }), NOW)).toBe(
      'denied-can-ask',
    );
  });
});

describe('formatCooldown', () => {
  it('returns null without or after a wait', () => {
    expect(formatCooldown(NOW, null)).toBeNull();
    expect(formatCooldown(NOW, '2026-11-24T12:00:00Z')).toBeNull();
    expect(formatCooldown(NOW, '2026-11-24T11:00:00Z')).toBeNull();
  });

  it('formats hours and minutes in Brussels time', () => {
    expect(formatCooldown(NOW, '2026-11-24T17:12:00Z')).toEqual({
      at: 'Tue 24 Nov, 18:12',
      remaining: '5 hours 12 minutes',
    });
  });

  it('uses singular units and drops zero parts', () => {
    expect(formatCooldown(NOW, '2026-11-24T13:00:00Z')?.remaining).toBe('1 hour');
    expect(formatCooldown(NOW, '2026-11-24T12:01:00Z')?.remaining).toBe('1 minute');
    expect(formatCooldown(NOW, '2026-11-24T12:45:00Z')?.remaining).toBe('45 minutes');
  });

  it('says less than a minute under one minute', () => {
    expect(formatCooldown(NOW, '2026-11-24T12:00:30Z')?.remaining).toBe('less than a minute');
  });
});
