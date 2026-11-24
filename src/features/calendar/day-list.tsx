import { formatDayLabel, formatTime } from '../../shared/dates/brussels';
import type { DayModel, Segment } from './calendar-view-model';
import styles from './calendar.module.css';

/** Props of {@link DayList}. */
export interface DayListProps {
  days: readonly DayModel[];
  showTitles: boolean;
  busy: boolean;
}

const GLYPHS: Record<Segment['kind'], string> = {
  free: '\u25A2',
  blocked: '\u2715',
  closed: '\u2014',
};
const WORDS: Record<Segment['kind'], string> = {
  free: '',
  blocked: 'Blocked',
  closed: 'Closed',
};

/** End time label; midnight at the end of the day reads "24:00". */
function endLabel(segment: Segment, day: DayModel): string {
  return segment.endsAt === day.closedAfter.endsAt ? '24:00' : formatTime(segment.endsAt);
}

/** Week as a list of days with consecutive free/blocked/closed stretches (narrow screens). */
export function DayList({ days, showTitles, busy }: DayListProps) {
  return (
    <div aria-busy={busy}>
      {days.map((day) => {
        const headingId = `day-${day.date}`;
        return (
          <section key={day.date} aria-labelledby={headingId} className={styles['daySection']}>
            <h3
              id={headingId}
              aria-current={day.isToday ? 'date' : undefined}
              className={styles['dayHeading']}
            >
              {formatDayLabel(day.date)}
              {day.isToday ? <span className={styles['todayWord']}> Today</span> : null}
            </h3>
            <ul className={styles['segments']}>
              {day.segments.map((segment) => (
                <li
                  key={segment.startsAt}
                  className={`${styles['segment']} ${styles[`segment-${segment.kind}`]}`}
                >
                  <span aria-hidden="true">{GLYPHS[segment.kind]}</span>{' '}
                  {WORDS[segment.kind] ? <strong>{WORDS[segment.kind]}</strong> : null}{' '}
                  {formatTime(segment.startsAt)}-{endLabel(segment, day)}
                  {showTitles && segment.title ? (
                    <span className={styles['segmentTitle']}> {segment.title}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
