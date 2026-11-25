import { useState, type KeyboardEvent } from 'react';
import { addDays } from '../../core/domain/local-time';
import { formatDayLabel, formatWeekRange } from '../../shared/dates/brussels';
import { Button } from '../../shared/ui';
import { GridEventButton } from './grid-event-button';
import { cellName, type TimeGridViewProps } from './time-grid-labels';
import { placeDayBlocks } from './time-grid-layout';
import { touchSelectionFromCell } from './time-grid-selection';
import styles from './calendar.module.css';

function initialDay(days: TimeGridViewProps['days']): number {
  return Math.max(
    0,
    days.findIndex((day) => day.isToday),
  );
}

/** Mobile layout: one day at a time as a chronological list of full-width actions. */
export function DayTimeList({
  days,
  blocks,
  busy,
  labelId,
  onSelect,
  onActivateBlock,
  onShiftWeek,
  readOnly = false,
}: TimeGridViewProps) {
  const weekStart = days[0]?.date ?? '';
  const [selectedDate, setSelectedDate] = useState(() => days[initialDay(days)]?.date ?? weekStart);
  // Keep the requested edge date while the parent loads the neighbouring week.
  const dayIndex = days.findIndex((candidate) => candidate.date === selectedDate);
  const day = days[dayIndex >= 0 ? dayIndex : initialDay(days)];
  if (!day) return null;

  const go = (delta: -1 | 1) => {
    const next = dayIndex + delta;
    if (next >= 0 && next < days.length) {
      setSelectedDate(days[next]?.date ?? day.date);
      return;
    }
    setSelectedDate(addDays(day.date, delta));
    onShiftWeek(delta);
  };
  const placed = placeDayBlocks(day.date, blocks);
  const onKeyDown = (keyboard: KeyboardEvent) => {
    if (keyboard.key !== 'PageUp' && keyboard.key !== 'PageDown') return;
    keyboard.preventDefault();
    go(keyboard.key === 'PageDown' ? 1 : -1);
  };

  return (
    // Key events bubble from the native buttons inside; the wrapper only adds Page Up/Down.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div aria-busy={busy} className={styles['dayTimeList']} onKeyDown={onKeyDown}>
      <div role="group" aria-label="Day navigation" className={styles['navButtons']}>
        <Button
          variant="secondary"
          onClick={() => {
            go(-1);
          }}
        >
          Previous day
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            go(1);
          }}
        >
          Next day
        </Button>
      </div>
      <p className={styles['range']} aria-live="polite" aria-atomic="true">
        {formatDayLabel(day.date)}
        {day.isToday ? ' (today)' : ''}, week of {formatWeekRange(weekStart)}
      </p>
      <ul aria-labelledby={labelId} className={styles['segments']}>
        {day.openCells.map((cell, index) => {
          const starting = placed.filter((item) => item.startRow === index);
          return (
            <li key={index} className={styles['listItems']}>
              {starting.map((item) => (
                <GridEventButton
                  key={item.block.key}
                  block={item.block}
                  clusterSize={item.clusterSize}
                  className={styles['listEvent'] ?? ''}
                  onActivate={onActivateBlock}
                  showRepeatsText
                />
              ))}
              {cell.state === 'blocked' ? null : (
                <button
                  type="button"
                  className={styles['listCell']}
                  aria-label={cellName(day, cell)}
                  aria-disabled={readOnly ? true : undefined}
                  onClick={() => {
                    if (!readOnly)
                      onSelect(
                        touchSelectionFromCell(
                          day.date,
                          index,
                          index + 1 >= day.openCells.length ||
                            day.openCells[index + 1]?.state === 'free',
                        ),
                      );
                  }}
                >
                  {cell.label} {cell.state === 'partial' ? 'Partly blocked' : ''}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
