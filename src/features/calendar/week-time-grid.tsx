import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatDayLabel } from '../../shared/dates/brussels';
import { GridEventButton } from './grid-event-button';
import { cellName, isSelectable, selectionText, type TimeGridViewProps } from './time-grid-labels';
import { placeDayBlocks } from './time-grid-layout';
import {
  CELLS_PER_DAY,
  cellIndexFromPointer,
  selectionFromCells,
  touchSelectionFromCell,
} from './time-grid-selection';
import styles from './calendar.module.css';

interface PointerDrag {
  readonly id: number;
  readonly day: number;
  readonly anchor: number;
  captured: boolean;
  current: number;
}
interface VisualSelection {
  readonly day: number;
  readonly first: number;
  readonly last: number;
}
const DEFAULT_HINT = 'Select a time range.';
function cellOf(target: EventTarget): { day: number; index: number } | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-cell]') : null;
  return element
    ? { day: Number(element.dataset['day']), index: Number(element.dataset['index']) }
    : null;
}

/** Week grid (desktop): native buttons with pointer drag and overlap-aware events. */
export function WeekTimeGrid({
  days,
  blocks,
  busy,
  labelId,
  onSelect,
  onActivateBlock,
  readOnly = false,
}: TimeGridViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<PointerDrag | null>(null);
  const lastPointerType = useRef('mouse');
  const [drag, setDrag] = useState<VisualSelection | null>(null);
  const [hover, setHover] = useState<{ day: number; index: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const placed = useMemo(() => days.map((day) => placeDayBlocks(day.date, blocks)), [days, blocks]);
  const cancelPointer = (announceIt: boolean) => {
    const active = pointer.current;
    if (!active) return;
    pointer.current = null;
    if (active.captured && gridRef.current?.hasPointerCapture(active.id))
      gridRef.current.releasePointerCapture(active.id);
    setDrag(null);
    if (announceIt) setAnnounce('Selection cancelled.');
  };
  const emit = (day: number, first: number, last: number) => {
    const model = days[day];
    if (model && !readOnly) onSelect(selectionFromCells(model.date, first, last));
  };
  const onPointerDown = (event: PointerEvent) => {
    const hit = cellOf(event.target);
    lastPointerType.current = event.pointerType;
    const cell = hit ? days[hit.day]?.openCells[hit.index] : undefined;
    if (
      readOnly ||
      !hit ||
      !cell ||
      event.pointerType === 'touch' ||
      event.button !== 0 ||
      !isSelectable(cell)
    )
      return;
    pointer.current = {
      id: event.pointerId,
      day: hit.day,
      anchor: hit.index,
      captured: false,
      current: hit.index,
    };
  };
  const onPointerMove = (event: PointerEvent) => {
    const active = pointer.current;
    const body = bodyRef.current;
    if (!active || !body || event.pointerId !== active.id) return;
    const index = cellIndexFromPointer(
      event.clientY,
      body.getBoundingClientRect().top,
      body.getBoundingClientRect().height,
    );
    if (!active.captured && index === active.anchor) return;
    if (!active.captured) {
      active.captured = true;
      gridRef.current?.setPointerCapture(active.id);
    }
    active.current = index;
    setDrag({
      day: active.day,
      first: Math.min(active.anchor, index),
      last: Math.max(active.anchor, index),
    });
  };
  const onPointerUp = (event: PointerEvent) => {
    const active = pointer.current;
    if (!active || event.pointerId !== active.id) return;
    pointer.current = null;
    if (!active.captured) return;
    if (gridRef.current?.hasPointerCapture(active.id))
      gridRef.current.releasePointerCapture(active.id);
    setDrag(null);
    emit(
      active.day,
      Math.min(active.anchor, active.current),
      Math.max(active.anchor, active.current),
    );
  };
  const onCellClick = (day: number, index: number) => {
    const model = days[day];
    const cell = model?.openCells[index];
    if (readOnly || !model || !cell || !isSelectable(cell)) return;
    onSelect(
      lastPointerType.current === 'touch'
        ? touchSelectionFromCell(
            model.date,
            index,
            index + 1 >= model.openCells.length || model.openCells[index + 1]?.state === 'free',
          )
        : selectionFromCells(model.date, index),
    );
    lastPointerType.current = 'mouse';
  };
  const hintDay = drag ? days[drag.day] : hover ? days[hover.day] : undefined;
  const hint =
    drag && hintDay
      ? `Selected: ${selectionText(hintDay, drag.first, drag.last)}`
      : hover && hintDay
        ? `Create blocked time at ${selectionText(hintDay, hover.index, hover.index)}`
        : DEFAULT_HINT;
  return (
    <div className={styles['gridScroll']}>
      {readOnly ? null : (
        <p id={`${labelId}-hint`} className={styles['gridHint']}>
          {hint}
        </p>
      )}
      <div className={styles['gridFrame']}>
        <div
          ref={gridRef}
          role="grid"
          aria-labelledby={labelId}
          aria-describedby={readOnly ? undefined : `${labelId}-hint`}
          aria-busy={busy}
          className={styles['selectableGrid']}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            cancelPointer(true);
          }}
          onPointerOver={(event) => {
            setHover(cellOf(event.target));
          }}
          onPointerLeave={() => {
            setHover(null);
          }}
        >
          <div role="row" className={styles['gridHeader']}>
            <span role="columnheader">
              <span className="visually-hidden">Time</span>
            </span>
            {days.map((day) => (
              <span
                role="columnheader"
                key={day.date}
                {...(day.isToday ? { 'aria-current': 'date' as const } : {})}
              >
                {formatDayLabel(day.date)}
                {day.isToday ? <span className={styles['todayWord']}> Today</span> : null}
              </span>
            ))}
          </div>
          <div ref={bodyRef} role="rowgroup">
            {Array.from({ length: CELLS_PER_DAY }, (_, index) => (
              <div role="row" key={index} className={styles['gridRow']}>
                <span role="rowheader" className={styles['rowHead']}>
                  {days[0]?.openCells[index]?.label}
                </span>
                {days.map((day, dayIndex) => {
                  const cell = day.openCells[index];
                  if (!cell) return null;
                  const selected =
                    drag?.day === dayIndex && index >= drag.first && index <= drag.last;
                  return (
                    <button
                      key={dayIndex}
                      type="button"
                      role="gridcell"
                      data-cell=""
                      data-day={dayIndex}
                      data-index={index}
                      className={`${styles['cell']} ${styles[cell.state]} ${selected ? styles['selected'] : ''}`}
                      aria-label={cellName(day, cell)}
                      aria-selected={selected || undefined}
                      aria-disabled={readOnly || !isSelectable(cell) ? true : undefined}
                      onClick={() => {
                        onCellClick(dayIndex, index);
                      }}
                    >
                      {selected ? <span className="visually-hidden"> selected</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div role="group" aria-label="Events" className={styles['eventLayer']}>
          {placed.flatMap((dayEvents, dayIndex) =>
            dayEvents.map((item) => (
              <GridEventButton
                key={`${item.block.key}-${String(dayIndex)}`}
                block={item.block}
                clusterSize={item.clusterSize}
                className={styles['gridEvent'] ?? ''}
                style={{
                  gridColumn: dayIndex + 1,
                  gridRow: `${String(item.startRow + 1)} / ${String(item.endRow + 1)}`,
                  marginLeft: `${String((item.lane / item.lanes) * 100)}%`,
                  width: `${String(100 / item.lanes)}%`,
                }}
                onActivate={onActivateBlock}
              />
            )),
          )}
        </div>
      </div>
      <p role="status" className="visually-hidden">
        {announce}
      </p>
    </div>
  );
}
