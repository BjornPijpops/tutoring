import { formatDayLabel, formatEventWhen, formatTimeRange } from '../../shared/dates/brussels';
import type { DayModel, OpenCell } from './calendar-view-model';
import type { GridBlock, LocalTimeRange } from './time-grid-model';

/**
 * Props shared by the desktop week grid and the mobile day list. Only public view models go
 * in and only narrow intents come out; the container owns data, dialogs and mutations.
 */
export interface TimeGridViewProps {
  readonly days: readonly DayModel[];
  readonly blocks: readonly GridBlock[];
  readonly busy: boolean;
  /** Id of the heading that names the grid. */
  readonly labelId: string;
  /** Emits a snapped, same-day selection; the parent decides what to do (never saves). */
  readonly onSelect: (range: LocalTimeRange) => void;
  /** A block was clicked or activated; carries only its opaque key. */
  readonly onActivateBlock: (key: string) => void;
  /** Delete was pressed on a block that is not read-only; the parent confirms and mutates. */
  readonly onDeleteBlock: (key: string) => void;
  /** Moves a page: a week on desktop, a day on mobile when crossing the week edge. */
  readonly onShiftWeek: (delta: -1 | 1) => void;
  /** Read-only presentation mode used for anonymous tutee availability. */
  readonly readOnly?: boolean;
}

const STATE_WORD: Record<OpenCell['state'], string> = {
  free: '',
  partial: 'Partly blocked',
  blocked: 'Blocked',
};

/** Accessible name of a cell: day, time range and state. */
export function cellName(day: DayModel, cell: OpenCell): string {
  const state = STATE_WORD[cell.state];
  return `${formatDayLabel(day.date)}, ${formatTimeRange(cell.startsAt, cell.endsAt)}${state ? `, ${state}` : ''}`;
}

/** "Tue 24 Nov 14:00-16:00" for an inclusive cell range of `day`. */
export function selectionText(day: DayModel, first: number, last: number): string {
  const start = day.openCells[first];
  const end = day.openCells[last];
  if (!start || !end) return '';
  return `${formatDayLabel(day.date)} ${formatTimeRange(start.startsAt, end.endsAt)}`;
}

/** Whether a cell can start a selection. */
export function isSelectable(cell: OpenCell): boolean {
  return cell.state !== 'blocked';
}

/** Screen-reader detail for a block button: time, kind and overlap. */
export function blockDetail(block: GridBlock, clusterSize: number): string {
  const parts = [formatEventWhen(block.startsAt, block.endsAt)];
  if (block.kind === 'imported') parts.push('imported from calendar file');
  if (block.kind === 'blocked') parts.push('Not available');
  if (clusterSize > 1) parts.push(`${String(clusterSize)} events overlap`);
  return parts.join(', ');
}
