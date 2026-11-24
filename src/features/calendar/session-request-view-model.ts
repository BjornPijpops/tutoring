import type { Interval } from '../../core/domain/interval';
import type { SessionRequest } from '../../core/domain/session-request';
import type { GridBlock } from './time-grid-model';

/** Projects only anonymous availability and the current user's own generic blocks. */
export function sessionBlocks(
  blocked: readonly Interval[],
  own: readonly SessionRequest[],
): readonly GridBlock[] {
  return [
    ...blocked.map((value, index) => ({
      ...value,
      key: `blocked-${String(index)}`,
      label: 'Not available',
      kind: 'blocked' as const,
      readOnly: true,
    })),
    ...own
      .filter((request) => request.status === 'pending' || request.status === 'accepted')
      .map((request) => ({
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        key: `own-${request.id}`,
        label: request.status === 'pending' ? 'Pending' : 'Accepted',
        kind: 'busy' as const,
        readOnly: false,
      })),
  ];
}
