import { describe, expect, it } from 'vitest';
import type { AccessState, User } from '../core/domain/user';
import { getNavItems, homeTarget } from './nav';

const tutee = (accessState: AccessState): User => ({ id: 'u', role: 'tutee', accessState });
const tutor: User = { id: 't', role: 'tutor', accessState: 'none' };
const labels = (user: User | null, pending?: number) =>
  getNavItems(user, pending).map((item) => item.label);

describe('getNavItems', () => {
  it('shows only Home when signed out', () => {
    expect(labels(null)).toEqual(['Home']);
  });

  it('follows the tutee access state', () => {
    expect(labels(tutee('none'))).toEqual(['Home', 'Request access']);
    expect(labels(tutee('pending'))).toEqual(['Home', 'Request status']);
    expect(labels(tutee('denied'))).toEqual(['Home', 'Request status']);
    expect(labels(tutee('approved'))).toEqual(['Home', 'Availability', 'My sessions']);
  });

  it('gives the tutor the calendar and requests, with a count only when pending', () => {
    expect(labels(tutor)).toEqual(['Home', 'Calendar', 'Tutees', 'Requests', 'Access requests']);
    expect(getNavItems(tutor, 3)[4]).toEqual({
      to: '/access-requests',
      label: 'Access requests',
      pendingCount: 3,
    });
    expect(getNavItems(tutor, 0)[3]).not.toHaveProperty('pendingCount');
  });

  it('shows the pending session-request count on Requests only, independent of access requests', () => {
    expect(getNavItems(tutor, 0, 2)[3]).toEqual({
      to: '/session-requests',
      label: 'Requests',
      pendingCount: 2,
    });
    expect(getNavItems(tutor, 0, 2)[4]).not.toHaveProperty('pendingCount');
    expect(getNavItems(tutor, 5, 0)[3]).not.toHaveProperty('pendingCount');
    expect(getNavItems(tutee('approved'), 0, 4).some((item) => 'pendingCount' in item)).toBe(false);
  });
});

describe('homeTarget', () => {
  it('points each user to their main page', () => {
    expect(homeTarget(tutor)).toBe('/calendar');
    expect(homeTarget(tutee('approved'))).toBe('/availability');
    expect(homeTarget(tutee('none'))).toBe('/access');
    expect(homeTarget(tutee('denied'))).toBe('/access');
  });
});
