import { addDays, localDateOf, localTimeOf } from './local-time';
import type { Interval } from './interval';
import { fromMs, toMs } from './interval';
import { TUTOR_TIME_ZONE } from './tutoring-hours';

export const SESSION_REQUEST_RULES = {
  timeZone: TUTOR_TIME_ZONE,
  stepMinutes: 30,
  minimumMinutes: 30,
  maximumMinutes: 120,
  minimumNoticeHours: 24,
  maximumDaysAhead: 30,
  openHour: 8,
  closeHour: 22,
  pendingLimit: 3,
} as const;
export type SessionRequestValidationCode =
  | 'invalid-range'
  | 'ambiguous-local-time'
  | 'duration-too-short'
  | 'duration-too-long'
  | 'not-aligned'
  | 'outside-hours'
  | 'too-soon'
  | 'too-far';
export function validateSessionRequestRange(
  range: Interval,
  now: Date = new Date(),
): SessionRequestValidationCode | null {
  const start = toMs(range.startsAt),
    end = toMs(range.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'invalid-range';
  const st = localTimeOf(range.startsAt, TUTOR_TIME_ZONE),
    et = localTimeOf(range.endsAt, TUTOR_TIME_ZONE);
  const startDate = localDateOf(range.startsAt, TUTOR_TIME_ZONE);
  const endDate = localDateOf(range.endsAt, TUTOR_TIME_ZONE);
  const sm = st.hour * 60 + st.minute,
    em = et.hour * 60 + et.minute;
  // Wall-clock minutes since an arbitrary epoch: duration and grid are judged on local time.
  const localMinutes = (date: string, minutes: number) =>
    Date.parse(`${date}T00:00:00Z`) / 60000 + minutes;
  const duration = localMinutes(endDate, em) - localMinutes(startDate, sm);
  // A clock change makes local times nonexistent or ambiguous: reject instead of guessing.
  if (duration !== (end - start) / 60000) return 'ambiguous-local-time';
  if (duration < 30) return 'duration-too-short';
  if (duration > 120) return 'duration-too-long';
  if (
    startDate !== endDate ||
    sm % 30 !== 0 ||
    em % 30 !== 0 ||
    start % 60000 !== 0 ||
    end % 60000 !== 0
  )
    return 'not-aligned';
  if (sm < 480 || em > 1320) return 'outside-hours';
  if (start < now.getTime() + 24 * 60 * 60 * 1000) return 'too-soon';
  if (startDate > addDays(localDateOf(fromMs(now.getTime()), TUTOR_TIME_ZONE), 30))
    return 'too-far';
  return null;
}

export const SESSION_VALIDATION_MESSAGES: Readonly<Record<SessionRequestValidationCode, string>> = {
  'invalid-range': 'Choose a valid time range.',
  'ambiguous-local-time': 'This time range spans a clock change. Choose a different time.',
  'duration-too-short': 'Choose a session of at least 30 minutes.',
  'duration-too-long': 'Choose a session of no more than 2 hours.',
  'not-aligned': 'Choose a start and end time on the 30-minute grid.',
  'outside-hours': 'Choose a time on one day between 08:00 and 22:00.',
  'too-soon': 'Requests must be made at least 24 hours in advance.',
  'too-far': 'Requests can be made up to 30 days ahead.',
};

/** "30 minutes", "1 hour", "1 hour 30 minutes", "2 hours". */
export function formatSessionDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 0 ? '' : `${String(hours)} hour${hours === 1 ? '' : 's'}`;
  const m = rest === 0 ? '' : `${String(rest)} minutes`;
  return [h, m].filter(Boolean).join(' ');
}
