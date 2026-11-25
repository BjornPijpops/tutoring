import type { TuteeSession, TuteeSummary } from '../../core/domain/tutee';
import { formatMoment } from '../../shared/dates/brussels';

/** True when the tutee may ask for access right now (no running retry cooldown). */
export function cooldownCleared(tutee: Pick<TuteeSummary, 'nextRequestAt'>, now: Date): boolean {
  return tutee.nextRequestAt === null || Date.parse(tutee.nextRequestAt) <= now.getTime();
}

/** Value of the "Can ask again" fact on the detail page. */
export function canAskAgainText(
  tutee: Pick<TuteeSummary, 'status' | 'nextRequestAt'>,
  now: Date,
): string {
  if (tutee.status === 'blocked') return 'No — blocked until unblocked';
  if (tutee.status !== 'denied' && tutee.status !== 'revoked') return 'Now';
  return cooldownCleared(tutee, now) || tutee.nextRequestAt === null
    ? 'Now'
    : formatMoment(tutee.nextRequestAt);
}

/** "Can ask again after {date}" on a list card; only while a cooldown is running. */
export function cooldownLine(
  tutee: Pick<TuteeSummary, 'status' | 'nextRequestAt'>,
  now: Date,
): string | null {
  if (tutee.status !== 'denied' && tutee.status !== 'revoked') return null;
  if (tutee.nextRequestAt === null || cooldownCleared(tutee, now)) return null;
  return `Can ask again after ${formatMoment(tutee.nextRequestAt)}`;
}

export type SessionLabel = 'Pending' | 'Accepted' | 'Declined' | 'Cancelled' | 'Past';

/** Accepted or pending sessions whose start has passed read as "Past". */
export function sessionLabel(session: TuteeSession, now: Date): SessionLabel {
  if (session.status === 'declined') return 'Declined';
  if (session.status === 'cancelled') return 'Cancelled';
  if (Date.parse(session.startsAt) <= now.getTime()) return 'Past';
  return session.status === 'accepted' ? 'Accepted' : 'Pending';
}

/** Only pending sessions and accepted sessions that have not started can be cancelled. */
export function isCancellable(session: TuteeSession, now: Date): boolean {
  const label = sessionLabel(session, now);
  return label === 'Pending' || label === 'Accepted';
}

export function durationText(session: Pick<TuteeSession, 'startsAt' | 'endsAt'>): string {
  const minutes = Math.round((Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60000);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** Summary line "History" of the detail facts. */
export function historyText(historyStartsAt: string | null, shown: number): string {
  return shown === 0
    ? `History starts ${historyStartsAt ? formatMoment(historyStartsAt) : 'today'}.`
    : `${String(shown)} event${shown === 1 ? '' : 's'} shown`;
}
