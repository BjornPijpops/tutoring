import type { IsoDateTime } from '../../core/domain/interval';
import { toMs } from '../../core/domain/interval';
import { formatMoment } from '../../shared/dates/brussels';

const MINUTE_MS = 60_000;

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * When a denied tutee can ask again: `at` is a date and time in Brussels time, `remaining`
 * reads after "in" (e.g. "5 hours 12 minutes"). `null` once the time has passed or when
 * there is no waiting time.
 */
export function formatCooldown(
  now: Date,
  nextRequestAt: IsoDateTime | null,
): { at: string; remaining: string } | null {
  if (nextRequestAt === null) return null;
  const leftMs = toMs(nextRequestAt) - now.getTime();
  if (leftMs <= 0) return null;
  // Round up so the text never promises less waiting than there is.
  const totalMinutes = Math.ceil(leftMs / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    hours > 0 ? plural(hours, 'hour') : '',
    minutes > 0 ? plural(minutes, 'minute') : '',
  ];
  const remaining = leftMs < MINUTE_MS ? 'less than a minute' : parts.filter(Boolean).join(' ');
  return { at: formatMoment(nextRequestAt), remaining };
}
