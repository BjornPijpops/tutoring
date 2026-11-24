import { describe, expect, it } from 'vitest';
import {
  cellIndexFromPointer,
  localRangeToInterval,
  selectionFromCells,
  snapMinutes,
  touchSelectionFromCell,
  validateSelection,
} from './time-grid-selection';

describe('time grid selection', () => {
  it('snaps and clamps half-hour cells', () => {
    expect(snapMinutes(15)).toBe(30);
    expect(snapMinutes(16)).toBe(30);
    expect(selectionFromCells('2026-11-24', 0)).toEqual({
      date: '2026-11-24',
      startMinutes: 480,
      endMinutes: 510,
    });
  });
  it('normalises drag direction so dragging up equals dragging down', () => {
    const down = selectionFromCells('2026-11-24', 12, 15);
    expect(selectionFromCells('2026-11-24', 15, 12)).toEqual(down);
    expect(down).toMatchObject({ startMinutes: 840, endMinutes: 960 });
  });
  it('maps pointer positions to cells and clamps outside the grid', () => {
    expect(cellIndexFromPointer(100, 100, 2800)).toBe(0);
    expect(cellIndexFromPointer(100 + 149, 100, 2800)).toBe(1);
    expect(cellIndexFromPointer(100 + 2799, 100, 2800)).toBe(27);
    expect(cellIndexFromPointer(-500, 100, 2800)).toBe(0);
    expect(cellIndexFromPointer(99999, 100, 2800)).toBe(27);
    expect(cellIndexFromPointer(5, 0, 0)).toBe(0);
  });
  it('gives touch taps a one-hour default that stops at closing time', () => {
    expect(touchSelectionFromCell('2026-11-24', 12)).toMatchObject({
      startMinutes: 840,
      endMinutes: 900,
    });
    expect(touchSelectionFromCell('2026-11-24', 27)).toMatchObject({
      startMinutes: 1290,
      endMinutes: 1320,
    });
  });
  it('clips ranges to Brussels tutoring hours', () => {
    expect(
      validateSelection({ date: '2026-11-24', startMinutes: 450, endMinutes: 1350 }),
    ).toMatchObject({ clipped: true, range: { startMinutes: 480, endMinutes: 1320 } });
    expect(
      validateSelection({ date: '2026-11-24', startMinutes: 1320, endMinutes: 1380 }).error,
    ).toContain('08:00');
  });
  it('converts wall time through the timezone helper', () => {
    expect(
      localRangeToInterval({ date: '2026-07-14', startMinutes: 600, endMinutes: 630 }).startsAt,
    ).toBe('2026-07-14T08:00:00Z');
  });
});
