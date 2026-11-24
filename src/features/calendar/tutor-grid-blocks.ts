import type { CalendarEvent } from '../../core/domain/calendar-event';
import type { GridBlock } from './time-grid-model';

/** Maps a private tutor event to the grid's public view model (the only place titles and ids cross). */
export function toGridBlock(event: CalendarEvent): GridBlock {
  return {
    key: event.id,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    label: event.title || 'Blocked time',
    kind: event.source === 'ics' ? 'imported' : 'blocked',
    readOnly: false,
  };
}
