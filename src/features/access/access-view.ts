import type { AccessRequest } from '../../core/domain/access-request';
import { toMs } from '../../core/domain/interval';

/** What the tutee's `/access` page shows for their request. */
export type AccessView = 'form' | 'pending' | 'approved' | 'denied-waiting' | 'denied-can-ask';

/**
 * Chooses the view for a request (`null` = never asked). A denial lets the tutee ask again
 * once `nextRequestAt` has passed (exactly at that instant counts) or when it was cleared.
 */
export function getAccessView(request: AccessRequest | null, now: Date): AccessView {
  if (request === null) return 'form';
  if (request.status === 'pending') return 'pending';
  if (request.status === 'approved') return 'approved';
  const waitsUntil = request.nextRequestAt === null ? null : toMs(request.nextRequestAt);
  return waitsUntil === null || waitsUntil <= now.getTime() ? 'denied-can-ask' : 'denied-waiting';
}
