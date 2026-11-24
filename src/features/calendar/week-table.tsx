import { formatDayLabel, formatTimeRange } from '../../shared/dates/brussels';
import type { DayModel, OpenCell } from './calendar-view-model';
import styles from './calendar.module.css';

/** Props of {@link WeekTable}. */
export interface WeekTableProps {
  days: readonly DayModel[];
  /** Event titles are only shown to the tutor. */
  showTitles: boolean;
  caption: string;
  describedBy: string;
  busy: boolean;
}

function cellWords(cell: OpenCell, showTitles: boolean): { visible: string; hidden: string } {
  const range = formatTimeRange(cell.startsAt, cell.endsAt);
  if (cell.state === 'free') return { visible: '', hidden: `Free ${range}` };
  if (cell.state === 'partial') return { visible: 'Part', hidden: `Partly blocked ${range}` };
  if (showTitles && cell.title) {
    const more = cell.moreCount > 0 ? ` and ${String(cell.moreCount)} more` : '';
    return { visible: cell.title, hidden: `Blocked ${range}: ${cell.title}${more}` };
  }
  return { visible: 'Blocked', hidden: `Blocked ${range}` };
}

function ClosedRow({
  label,
  days,
  pick,
}: {
  label: string;
  days: readonly DayModel[];
  pick: (day: DayModel) => string;
}) {
  return (
    <tr>
      <th scope="row" className={styles['rowHead']}>
        {label}
      </th>
      {days.map((day) => (
        <td key={day.date} className={`${styles['cell']} ${styles['closed']}`}>
          <span aria-hidden="true">— </span>
          Closed
          <span className="visually-hidden"> {pick(day)}</span>
        </td>
      ))}
    </tr>
  );
}

/** Week as a native table: one column per day, a row per half hour, closed hours as rows. */
export function WeekTable({ days, showTitles, caption, describedBy, busy }: WeekTableProps) {
  const rows = days[0]?.openCells ?? [];
  return (
    <table className={styles['table']} aria-describedby={describedBy} aria-busy={busy}>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <td />
          {days.map((day) => (
            <th
              key={day.date}
              scope="col"
              aria-current={day.isToday ? 'date' : undefined}
              className={day.isToday ? styles['today'] : undefined}
            >
              {formatDayLabel(day.date)}
              {day.isToday ? <span className={styles['todayWord']}> Today</span> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <ClosedRow
          label="Before 08:00"
          days={days}
          pick={(day) => formatTimeRange(day.closedBefore.startsAt, day.closedBefore.endsAt)}
        />
        {rows.map((row, index) => (
          <tr key={row.label}>
            <th scope="row" className={styles['rowHead']}>
              {row.label}
            </th>
            {days.map((day) => {
              const cell = day.openCells[index];
              if (!cell) return null;
              const words = cellWords(cell, showTitles);
              return (
                <td key={day.date} className={`${styles['cell']} ${styles[cell.state]}`}>
                  {cell.state === 'blocked' ? <span aria-hidden="true">✕ </span> : null}
                  {cell.state === 'partial' ? <span aria-hidden="true">◐ </span> : null}
                  {words.visible ? (
                    <span className={styles['cellText']}>{words.visible}</span>
                  ) : null}
                  <span className="visually-hidden">
                    {words.visible ? ` (${words.hidden})` : words.hidden}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
        <ClosedRow
          label="After 22:00"
          days={days}
          pick={(day) => formatTimeRange(day.closedAfter.startsAt, day.closedAfter.endsAt)}
        />
      </tbody>
    </table>
  );
}
