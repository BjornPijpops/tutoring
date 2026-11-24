import type { CalendarEvent } from '../../core/domain/calendar-event';
import type { TutorSessionRequest } from '../../core/domain/session-request';
import type { GridBlock } from './time-grid-model';

/** Accepted session as a read-only, non-striped block on the tutor calendar (no delete). */
export function toSessionBlock(session: TutorSessionRequest): GridBlock {
  return {
    key: `session-${session.id}`,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    label: `Accepted: ${session.requesterName}`,
    kind: 'busy',
    readOnly: true,
  };
}

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
