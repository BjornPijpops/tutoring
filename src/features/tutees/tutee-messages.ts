import type { Status } from '../../shared/ui';
import type {
  SessionPolicy,
  TuteeAction,
  TuteeActionResult,
  TuteeAuditAction,
  TuteeStatus,
} from '../../core/domain/tutee';

/** Every user-facing string of the tutee pages, so tests and screens share one source. */

export const STATUS_LABEL: Record<TuteeStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  revoked: 'Revoked',
  blocked: 'Blocked',
};

export function badgeStatus(status: TuteeStatus): Status | 'neutral' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending':
      return 'info';
    case 'denied':
      return 'warning';
    case 'revoked':
      return 'warning';
    case 'blocked':
      return 'error';
  }
}

export const FILTERS: readonly { value: TuteeStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'blocked', label: 'Blocked' },
];

export const LIST_MESSAGES = {
  lead: 'People who have asked to see your availability.',
  loading: 'Loading tutees…',
  emptyTitle: 'No tutees yet',
  emptyBody: 'People appear here after they ask to see your availability.',
  filteredTitle: 'No tutees match these filters.',
  filteredHint: 'Try another filter.',
  loadError: "We couldn't load tutees. Check your connection and try again.",
  loadMoreError: "We couldn't load more tutees. Try again.",
  searchError: "We couldn't search tutees. The previous results are still shown.",
  stale: 'The tutee list changed. It has been refreshed.',
} as const;

export const noMatchForSearch = (query: string) => `No tutees match “${query}”.`;
export const listProgress = (shown: number, total: number) =>
  `Showing ${String(shown)} of ${String(total)} tutees.`;
export const accessRequestCount = (n: number) => `${String(n)} access request${n === 1 ? '' : 's'}`;
export const sessionSummary = (pending: number, accepted: number) =>
  `${String(pending)} pending session requests · ${String(accepted)} accepted future sessions`;
export const detailSessionSummary = (pending: number, accepted: number) =>
  `${String(pending)} pending requests · ${String(accepted)} accepted future sessions`;

export const DETAIL_MESSAGES = {
  loading: 'Loading tutee…',
  loadError: "We couldn't load this tutee. Check your connection and try again.",
  notFound: 'This tutee was not found. They may have deleted their account.',
  updateError: "We couldn't update access. Try again.",
  stale: 'This tutee changed elsewhere. The page has been refreshed.',
  canAskAgainNow: 'Can ask again now',
  cancelSessionError: "We couldn't cancel this session. Try again.",
  sessionStale: 'This session changed elsewhere. The page has been refreshed.',
  sessionCancelled: 'The session was cancelled and the time is available again.',
} as const;

export const ACTION_LABEL: Record<TuteeAction | 'allow-again', string> = {
  approve: 'Approve',
  deny: 'Deny',
  revoke: 'Revoke access',
  restore: 'Restore access',
  block: 'Block',
  unblock: 'Unblock',
  'allow-again': 'Allow to ask again now',
};

export const BUSY_LABEL: Record<TuteeAction | 'allow-again', string> = {
  approve: 'Approving…',
  deny: 'Denying…',
  revoke: 'Revoking…',
  restore: 'Restoring…',
  block: 'Blocking…',
  unblock: 'Unblocking…',
  'allow-again': 'Saving…',
};

export const EVENT_LABEL: Record<TuteeAuditAction, string> = {
  requested: 'Requested',
  re_requested: 'Asked again',
  approved: 'Approved',
  denied: 'Denied',
  revoked: 'Access revoked',
  restored: 'Restored',
  blocked: 'Blocked',
  unblocked: 'Unblocked',
  cooldown_reset: 'Cooldown reset',
};

export const sessionsEnded = (n: number) =>
  `${String(n)} session request${n === 1 ? '' : 's'} ended`;

export const SESSION_CANCEL_DIALOG = {
  title: 'Cancel this session?',
  body: 'This session will be cancelled and the time will become available again.',
  confirm: 'Cancel session',
  cancel: 'Keep session',
} as const;

export const CANCEL_ACCEPTED_LABEL = 'Also cancel accepted future sessions';

export const revokeDialog = (name: string) => ({
  title: `Revoke access for ${name}?`,
  body: `${name} will no longer see your availability or request new sessions. Pending session requests will be declined. Accepted future sessions will stay in place unless you choose to cancel them below.`,
  help: `This cancels all of ${name}'s accepted sessions after now and releases those times. Past sessions are unchanged.`,
  confirm: 'Revoke access',
  cancel: 'Keep access',
  error: "We couldn't revoke access. Try again.",
});

export const blockDialog = (name: string) => ({
  title: `Block ${name}?`,
  body: `${name} will lose access. Pending session requests will be declined, accepted future sessions will stay in place unless cancelled below, and they will not be able to ask for access again until you unblock them.`,
  help: 'This cancels all accepted sessions after now. Past sessions are unchanged.',
  confirm: 'Block tutee',
  cancel: 'Keep access',
  error: `We couldn't block ${name}. Try again.`,
});

function cancelledSentence(policy: SessionPolicy, result: TuteeActionResult): string {
  if (policy !== 'cancel_all') return '';
  return result.acceptedCancelled > 0
    ? ` ${String(result.acceptedCancelled)} accepted future sessions were cancelled.`
    : ' No accepted future sessions were cancelled.';
}

export function revokeSuccess(
  name: string,
  policy: SessionPolicy,
  result: TuteeActionResult,
): string {
  return `Access for ${name} was revoked. Pending session requests were declined.${cancelledSentence(policy, result)}`;
}

export function blockSuccess(
  name: string,
  policy: SessionPolicy,
  result: TuteeActionResult,
): string {
  return `${name} was blocked. They cannot ask for access again until you unblock them.${cancelledSentence(policy, result)}`;
}

/** Announcement after an immediate action (no dialog). */
export function immediateSuccess(name: string, action: TuteeAction | 'allow-again'): string {
  switch (action) {
    case 'approve':
      return `${name} was approved.`;
    case 'deny':
      return `${name} was denied.`;
    case 'restore':
      return `Access for ${name} was restored.`;
    case 'unblock':
      return `${name} was unblocked. They can ask for access again.`;
    case 'allow-again':
      return `${name} can ask for access again now. Access is not granted.`;
    case 'revoke':
      return `Access for ${name} was revoked.`;
    case 'block':
      return `${name} was blocked.`;
  }
}
