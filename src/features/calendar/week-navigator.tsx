import { addDays, type IsoDate } from '../../core/domain/local-time';
import { Button } from '../../shared/ui';
import { formatWeekRange } from '../../shared/dates/brussels';
import styles from './calendar.module.css';

/** Props of {@link WeekNavigator}. */
export interface WeekNavigatorProps {
  weekStart: IsoDate;
  currentWeekStart: IsoDate;
  onChange: (weekStart: IsoDate) => void;
}

/** Previous / Today / Next controls with a polite live range label. */
export function WeekNavigator({ weekStart, currentWeekStart, onChange }: WeekNavigatorProps) {
  return (
    <div className={styles['navigator']}>
      <div role="group" aria-label="Week navigation" className={styles['navButtons']}>
        <Button
          variant="secondary"
          onClick={() => {
            onChange(addDays(weekStart, -7));
          }}
        >
          Previous week
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onChange(currentWeekStart);
          }}
        >
          Today
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onChange(addDays(weekStart, 7));
          }}
        >
          Next week
        </Button>
      </div>
      <p id="week-range" className={styles['range']} aria-live="polite" aria-atomic="true">
        {formatWeekRange(weekStart)}
      </p>
    </div>
  );
}
