import type { User } from '../core/domain/user';

/** One header navigation entry. */
export interface NavItem {
  readonly to: string;
  readonly label: string;
  /** Pending requests waiting for the tutor; shown as a badge next to the label. */
  readonly pendingCount?: number;
}

const HOME: NavItem = { to: '/', label: 'Home' };

/**
 * Navigation entries for the visitor. "Sign in" and "Sign out" live in the header's auth
 * controls, not here. This only chooses what to show; the backend enforces access.
 */
export function getNavItems(
  user: User | null,
  pendingCount = 0,
  sessionPendingCount = 0,
): readonly NavItem[] {
  if (user === null) return [HOME];
  if (user.role === 'tutor') {
    return [
      HOME,
      { to: '/calendar', label: 'Calendar' },
      sessionPendingCount > 0
        ? { to: '/session-requests', label: 'Requests', pendingCount: sessionPendingCount }
        : { to: '/session-requests', label: 'Requests' },
      pendingCount > 0
        ? { to: '/access-requests', label: 'Access requests', pendingCount }
        : { to: '/access-requests', label: 'Access requests' },
    ];
  }
  switch (user.accessState) {
    case 'none':
      return [HOME, { to: '/access', label: 'Request access' }];
    case 'pending':
    case 'denied':
      return [HOME, { to: '/access', label: 'Request status' }];
    case 'approved':
      return [
        HOME,
        { to: '/availability', label: 'Availability' },
        { to: '/my-sessions', label: 'My sessions' },
      ];
  }
}

/** Where a signed-in user's main page is. */
export function homeTarget(user: User): string {
  if (user.role === 'tutor') return '/calendar';
  return user.accessState === 'approved' ? '/availability' : '/access';
}
