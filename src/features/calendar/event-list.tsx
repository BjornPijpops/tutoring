import type { CalendarEvent } from '../../core/domain/calendar-event';
import { formatEventWhen } from '../../shared/dates/brussels';
import { Button, StatusMessage } from '../../shared/ui';
import styles from './calendar.module.css';

/** Props of {@link EventList}. */
export interface EventListProps {
  events: readonly CalendarEvent[];
  /** Called with the event and the Delete button that was pressed. */
  onDelete: (event: CalendarEvent, opener: HTMLElement) => void;
}

/** Accessible name for an event's Delete button; starts with its visible text. */
export function deleteLabel(event: CalendarEvent): string {
  return `Delete ${event.title || 'untitled event'}, ${formatEventWhen(event.startsAt, event.endsAt)}`;
}

/** Events of the displayed week, with a delete action each. */
export function EventList({ events, onDelete }: EventListProps) {
  if (events.length === 0)
    return <StatusMessage status="info">No blocked events this week.</StatusMessage>;
  return (
    <ul className={styles['events']}>
      {events.map((event) => (
        <li key={event.id} className={styles['eventItem']}>
          <div>
            <p className={styles['eventTitle']}>
              {event.title || <span className={styles['muted']}>No title</span>}
            </p>
            <p className={styles['eventMeta']}>
              {formatEventWhen(event.startsAt, event.endsAt)} ·{' '}
              {event.source === 'manual' ? 'Added manually' : 'Imported from calendar file'}
            </p>
          </div>
          <Button
            variant="secondary"
            aria-label={deleteLabel(event)}
            onClick={(click) => {
              onDelete(event, click.currentTarget);
            }}
          >
            Delete
          </Button>
        </li>
      ))}
    </ul>
  );
}
