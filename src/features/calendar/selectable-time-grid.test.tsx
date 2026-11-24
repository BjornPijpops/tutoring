import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { mergeIntervals } from '../../core/domain/blocked-intervals';
import { expectNoViolations } from '../../test/axe';
import { buildWeekModel, weekRange } from './calendar-view-model';
import { SelectableTimeGrid } from './selectable-time-grid';
import { toGridBlock } from './tutor-grid-blocks';

const WEEK = '2026-11-23';
const TUESDAY = '2026-11-24';

function event(id: string, from: string, to: string, source: 'manual' | 'ics' = 'manual') {
  return {
    id,
    title: id,
    startsAt: `${TUESDAY}T${from}:00Z`,
    endsAt: `${TUESDAY}T${to}:00Z`,
    source,
  } satisfies CalendarEvent;
}

function setup(events: readonly CalendarEvent[] = []) {
  const props = {
    days: buildWeekModel({
      weekStart: WEEK,
      today: TUESDAY,
      blocked: mergeIntervals(events, weekRange(WEEK)),
      events,
    }),
    blocks: events.map(toGridBlock),
    busy: false,
    labelId: 'grid-heading',
    onSelect: vi.fn(),
    onActivateBlock: vi.fn(),
    onDeleteBlock: vi.fn(),
    onShiftWeek: vi.fn(),
  };
  const view = render(
    <>
      <h2 id="grid-heading">Week view</h2>
      <SelectableTimeGrid {...props} />
    </>,
  );
  return { ...props, ...view };
}

/** Cell of the Tuesday column; row `index` is 08:00 + index * 30 minutes. */
function cell(index: number, day = 1): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-day="${String(day)}"][data-index="${String(index)}"]`,
  );
  if (!found) throw new Error(`no cell ${String(index)}`);
  return found;
}

/** Makes every grid row 100px tall so pointer positions map to cells. */
function mockGeometry() {
  const body = screen.getAllByRole('rowgroup')[0] as HTMLElement;
  body.getBoundingClientRect = () => ({ top: 0, height: 2800 }) as DOMRect;
  return body;
}
const y = (index: number) => index * 100 + 50;

function pointer(
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
  target: Element,
  clientY: number,
  extra: PointerEventInit = {},
) {
  fireEvent[type](target, { pointerId: 1, pointerType: 'mouse', button: 0, clientY, ...extra });
}

const captured = new Set<number>();

beforeEach(() => {
  captured.clear();
  Element.prototype.setPointerCapture = (id: number) => {
    captured.add(id);
  };
  Element.prototype.hasPointerCapture = (id: number) => captured.has(id);
  Element.prototype.releasePointerCapture = (id: number) => {
    captured.delete(id);
  };
});
afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('SelectableTimeGrid pointer selection', () => {
  it('drag selects a snapped same-day range and only emits on release', () => {
    const { onSelect } = setup();
    const grid = screen.getByRole('grid');
    mockGeometry();
    pointer('pointerDown', cell(12), y(12));
    pointer('pointerMove', cell(15), y(15));
    expect(captured.has(1)).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('Selected: Tue 24 Nov 14:00-16:00')).toBeInTheDocument();
    expect(cell(13)).toHaveAttribute('aria-selected', 'true');
    pointer('pointerUp', grid, y(15));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ date: TUESDAY, startMinutes: 840, endMinutes: 960 });
    expect(captured.size).toBe(0);
    expect(cell(13)).not.toHaveAttribute('aria-selected');
  });

  it('drag up gives the same range as drag down', () => {
    const { onSelect } = setup();
    mockGeometry();
    pointer('pointerDown', cell(15), y(15));
    pointer('pointerMove', cell(12), y(12));
    pointer('pointerUp', screen.getByRole('grid'), y(12));
    expect(onSelect).toHaveBeenCalledWith({ date: TUESDAY, startMinutes: 840, endMinutes: 960 });
  });

  it('clamps to the grid when the pointer leaves it and stays on one day', () => {
    const { onSelect } = setup();
    mockGeometry();
    pointer('pointerDown', cell(3), y(3));
    pointer('pointerMove', screen.getByRole('grid'), 99_999);
    pointer('pointerUp', screen.getByRole('grid'), 99_999);
    expect(onSelect).toHaveBeenLastCalledWith({
      date: TUESDAY,
      startMinutes: 570,
      endMinutes: 1320,
    });
    pointer('pointerDown', cell(3), y(3));
    pointer('pointerMove', screen.getByRole('grid'), -400);
    pointer('pointerUp', screen.getByRole('grid'), -400);
    expect(onSelect).toHaveBeenLastCalledWith({
      date: TUESDAY,
      startMinutes: 480,
      endMinutes: 600,
    });
  });

  it('cancels a drag on pointercancel', () => {
    const { onSelect } = setup();
    mockGeometry();
    pointer('pointerDown', cell(12), y(12));
    pointer('pointerMove', cell(14), y(14));
    pointer('pointerCancel', screen.getByRole('grid'), y(14));
    pointer('pointerUp', screen.getByRole('grid'), y(14));
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-selected="true"]')).toBeNull();
  });

  it('keeps a plain click a 30-minute selection', async () => {
    const { onSelect } = setup();
    await userEvent.click(cell(4));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ date: TUESDAY, startMinutes: 600, endMinutes: 630 });
  });

  it('does not hijack touch: no drag, a tap selects one hour', () => {
    const { onSelect } = setup();
    mockGeometry();
    pointer('pointerDown', cell(4), y(4), { pointerType: 'touch' });
    pointer('pointerMove', cell(8), y(8), { pointerType: 'touch' });
    expect(captured.size).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(cell(4));
    expect(onSelect).toHaveBeenCalledWith({ date: TUESDAY, startMinutes: 600, endMinutes: 660 });
  });

  it('ignores blocked cells for selection', async () => {
    const { onSelect } = setup([event('busy', '09:00', '10:00')]);
    const blocked = screen.getAllByRole('gridcell', { name: /Blocked/ })[0] as HTMLElement;
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(blocked);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('SelectableTimeGrid native keyboard semantics', () => {
  it('keeps free cells labelled by day and time without a Free state label', () => {
    setup();
    expect(screen.getAllByRole('gridcell')).toHaveLength(196);
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });
});

describe('SelectableTimeGrid on a narrow screen', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('shows one day as a list instead of hiding days', async () => {
    setup([event('busy', '09:00', '10:00')]);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getByText(/Tue 24 Nov \(today\), week of 23 - 29 November 2026/)).toBeVisible();
    expect(screen.getAllByRole('button', { name: /08:00/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByText(/Wed 25 Nov, week of/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^busy/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByRole('button', { name: /^busy/ })).toBeInTheDocument();
  });

  it('uses full-width tap targets that select one hour', async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getAllByRole('button')[6] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith({ date: TUESDAY, startMinutes: 600, endMinutes: 660 });
  });

  it('preserves Sunday when Previous day crosses from Monday into the prior week', async () => {
    const { rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    rerender(
      <>
        <h2 id="grid-heading">Week view</h2>
        <SelectableTimeGrid
          days={buildWeekModel({
            weekStart: '2026-11-16',
            today: TUESDAY,
            blocked: [],
            events: [],
          })}
          blocks={[]}
          busy={false}
          labelId="grid-heading"
          onSelect={vi.fn()}
          onActivateBlock={vi.fn()}
          onDeleteBlock={vi.fn()}
          onShiftWeek={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText(/Sun 22 Nov, week of/)).toBeInTheDocument();
  });

  it('moves to Monday when Next day crosses into the following week', async () => {
    const { rerender } = setup();
    for (let step = 0; step < 5; step += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    }
    expect(screen.getByText(/Sun 29 Nov, week of/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    rerender(
      <SelectableTimeGrid
        days={buildWeekModel({
          weekStart: '2026-11-30',
          today: TUESDAY,
          blocked: [],
          events: [],
        })}
        blocks={[]}
        busy={false}
        labelId="grid-heading"
        onSelect={vi.fn()}
        onActivateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onShiftWeek={vi.fn()}
      />,
    );
    expect(screen.getByText(/Mon 30 Nov, week of/)).toBeInTheDocument();
  });

  it('moves to the neighbouring week at the week edge and with Page keys', async () => {
    const { onShiftWeek } = setup();
    for (let step = 0; step < 5; step += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    }
    expect(screen.getByText(/Sun 29 Nov, week of/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(onShiftWeek).toHaveBeenLastCalledWith(1);
  });

  it('shows overlapping events with an Overlap cue', () => {
    setup([event('first', '09:00', '11:00'), event('second', '10:00', '12:00')]);
    const list = screen.getByRole('list');
    expect(within(list).getAllByText('Overlap')).toHaveLength(2);
  });

  it('has no axe violations', async () => {
    const { container } = setup([
      event('first', '09:00', '11:00'),
      event('second', '10:00', '12:00'),
    ]);
    await expectNoViolations(container);
  });
});

describe('SelectableTimeGrid accessibility', () => {
  it('has no axe violations with events, overlap and a selection', async () => {
    const { container } = setup([
      event('first', '09:00', '11:00'),
      event('second', '10:00', '12:00'),
      event('imported', '15:00', '16:00', 'ics'),
    ]);
    cell(20).focus();
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await expectNoViolations(container);
  });
});
