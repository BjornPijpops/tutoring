import type { IsoDate } from '../../core/domain/local-time';
import { Button, StatusMessage } from '../../shared/ui';
import { formatWeekRange, timeZoneNote, TUTORING_HOURS_NOTE } from '../../shared/dates/brussels';
import type { DayModel } from './calendar-view-model';
import { DayList } from './day-list';
import { WeekNavigator } from './week-navigator';
import { WeekTable } from './week-table';
import styles from './calendar.module.css';

/** Load state of the displayed week. */
export type WeekLoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** Props of {@link WeekView}. */
export interface WeekViewProps {
  weekStart: IsoDate;
  currentWeekStart: IsoDate;
  days: readonly DayModel[] | null;
  state: WeekLoadState;
  /** True while a new week loads and the previous one is still shown. */
  busy: boolean;
  showTitles: boolean;
  /** True when nothing but closed hours is blocked. */
  empty: boolean;
  onWeekChange: (weekStart: IsoDate) => void;
  onRetry: () => void;
  onSignOut: () => void;
}

const NOTE_ID = 'week-tz-note';

function Legend() {
  return (
    <ul className={styles['legend']} aria-label="Legend">
      <li>
        <span aria-hidden="true">✕ </span>Blocked
      </li>
      <li>
        <span aria-hidden="true">— </span>Closed (hatched)
      </li>
    </ul>
  );
}

function Body({
  days,
  state,
  busy,
  showTitles,
  weekStart,
  empty,
  onRetry,
  onSignOut,
}: WeekViewProps) {
  if (state === 'error') {
    return (
      <>
        <StatusMessage status="error">
          We couldn't load the calendar. Check your connection and try again.
        </StatusMessage>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </>
    );
  }
  if (state === 'forbidden') {
    return (
      <>
        <StatusMessage status="warning">
          You no longer have access to this calendar. Sign in again with the right account.
        </StatusMessage>
        <Button onClick={onSignOut}>Sign out</Button>
      </>
    );
  }
  if (!days) return <StatusMessage status="info">Loading the calendar...</StatusMessage>;

  return (
    <div className={busy ? styles['busy'] : undefined}>
      <Legend />
      {empty && !busy ? (
        <StatusMessage status="info">
          Nothing is blocked this week except closed hours.
        </StatusMessage>
      ) : null}
      <div className={styles['tableView']}>
        <WeekTable
          days={days}
          showTitles={showTitles}
          busy={busy}
          describedBy={NOTE_ID}
          caption={`Availability for the week of ${formatWeekRange(weekStart)}, Brussels time`}
        />
      </div>
      <div className={styles['listView']}>
        <DayList days={days} showTitles={showTitles} busy={busy} />
      </div>
    </div>
  );
}

/** Week navigation, time zone note, legend and the week as a table or a day list. */
export function WeekView(props: WeekViewProps) {
  const { weekStart, currentWeekStart, onWeekChange } = props;
  return (
    <section aria-labelledby="week-view-heading" className={styles['section']}>
      <h2 id="week-view-heading">Week view</h2>
      <p id={NOTE_ID} className={styles['note']}>
        {timeZoneNote(weekStart, Intl.DateTimeFormat().resolvedOptions().timeZone)}
        <br />
        {TUTORING_HOURS_NOTE}
      </p>
      <WeekNavigator
        weekStart={weekStart}
        currentWeekStart={currentWeekStart}
        onChange={onWeekChange}
      />
      <Body {...props} />
    </section>
  );
}
