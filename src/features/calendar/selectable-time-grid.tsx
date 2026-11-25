import { useMediaQuery } from '../../shared/hooks/use-media-query';
import { DayTimeList } from './day-time-list';
import type { TimeGridViewProps } from './time-grid-labels';
import { WeekTimeGrid } from './week-time-grid';

export type SelectableTimeGridProps = TimeGridViewProps;

/**
 * Generic time grid: a week grid from 40rem up, a one-day list below. It consumes only public
 * view models (`DayModel`, `GridBlock`) and emits narrow intents (select a range, activate a
 * block by key); it never persists anything or sees private event data.
 *
 * Plugging in a mode: the tutor container (`CalendarManager`) maps `CalendarEvent` to
 * `GridBlock` with `toGridBlock` and owns the dialog and mutations. A future tutee-request
 * container passes anonymous `busy`/`available` blocks (`readOnly: true`, generic labels)
 * and turns `onSelect`/`onActivateBlock` into a request flow
 * (ADR 0008/0009 mode/strategy boundary).
 */
export function SelectableTimeGrid(props: SelectableTimeGridProps) {
  const desktop = useMediaQuery('(min-width: 40rem)', true);
  return desktop ? <WeekTimeGrid {...props} /> : <DayTimeList {...props} />;
}
