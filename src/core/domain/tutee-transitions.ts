import type { TuteeAction, TuteeAuditAction, TuteeStatus } from './tutee';
import { err, ok, type Result } from './result';

export interface Transition {
  readonly status: TuteeStatus;
  readonly decidedAt: string;
  readonly nextRequestAt: string | null;
  readonly auditAction: TuteeAuditAction;
}

/** Cooldown applied after a deny or a revoke (not after an unblock). */
export const COOLDOWN_MS = 8 * 60 * 60 * 1000;

/** Executable spec of the access state machine; the SQL function must agree with it. */
export const ALLOWED_FROM: Readonly<Record<TuteeAction, readonly TuteeStatus[]>> = {
  approve: ['pending', 'denied'],
  deny: ['pending'],
  revoke: ['approved'],
  restore: ['revoked'],
  block: ['pending', 'approved', 'denied', 'revoked'],
  unblock: ['blocked'],
};

const RESULT: Readonly<Record<TuteeAction, { status: TuteeStatus; audit: TuteeAuditAction }>> = {
  approve: { status: 'approved', audit: 'approved' },
  restore: { status: 'approved', audit: 'restored' },
  deny: { status: 'denied', audit: 'denied' },
  revoke: { status: 'revoked', audit: 'revoked' },
  block: { status: 'blocked', audit: 'blocked' },
  unblock: { status: 'denied', audit: 'unblocked' },
};

/** Applies an action. A no-op or stale action is rejected with `stale`, never silently accepted. */
export function nextAccessState(
  current: TuteeStatus,
  action: TuteeAction,
  now: string,
): Result<Transition, 'stale'> {
  if (!ALLOWED_FROM[action].includes(current)) return err('stale');
  const { status, audit } = RESULT[action];
  const cooldown = action === 'deny' || action === 'revoke';
  return ok({
    status,
    decidedAt: now,
    nextRequestAt: cooldown ? new Date(Date.parse(now) + COOLDOWN_MS).toISOString() : null,
    auditAction: audit,
  });
}

/** Actions offered for a status. "Allow to ask again" only exists while a cooldown is running. */
export function allowedActions(
  status: TuteeStatus,
  cooldownCleared: boolean,
): readonly (TuteeAction | 'allow-again')[] {
  const base: Record<TuteeStatus, readonly (TuteeAction | 'allow-again')[]> = {
    pending: ['approve', 'deny', 'block'],
    approved: ['revoke', 'block'],
    denied: cooldownCleared ? ['approve', 'block'] : ['approve', 'allow-again', 'block'],
    revoked: cooldownCleared ? ['restore', 'block'] : ['restore', 'allow-again', 'block'],
    blocked: ['unblock'],
  };
  return base[status];
}

/** What the tutee sees: revoked and blocked are never disclosed. */
export function projectForTutee(status: TuteeStatus): 'pending' | 'approved' | 'denied' {
  return status === 'revoked' || status === 'blocked' ? 'denied' : status;
}
