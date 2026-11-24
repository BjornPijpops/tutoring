import { describe, expect, it } from 'vitest';
import { placeDayBlocks } from './time-grid-layout';
import type { GridBlock } from './time-grid-model';

// 2026-11-24 is winter time (UTC+1): 08:00 Brussels is 07:00Z.
const DAY = '2026-11-24';
function event(id: string, from: string, to: string): GridBlock {
  return {
    key: id,
    label: id,
    startsAt: `${DAY}T${from}:00Z`,
    endsAt: `${DAY}T${to}:00Z`,
    kind: 'blocked',
    readOnly: false,
  };
}

describe('placeDayBlocks', () => {
  it('places an event on its 30-minute rows', () => {
    const [placed] = placeDayBlocks(DAY, [event('a', '09:00', '10:30')]);
    expect(placed).toMatchObject({ startRow: 4, endRow: 7, lane: 0, lanes: 1, clusterSize: 1 });
  });

  it('puts overlapping events into separate lanes of one cluster', () => {
    const placed = placeDayBlocks(DAY, [
      event('a', '09:00', '11:00'),
      event('b', '10:00', '12:00'),
      event('c', '10:30', '11:30'),
    ]);
    expect(placed.map((p) => [p.block.key, p.lane, p.lanes, p.clusterSize])).toEqual([
      ['a', 0, 3, 3],
      ['b', 1, 3, 3],
      ['c', 2, 3, 3],
    ]);
  });

  it('reuses lanes and starts a new cluster when events no longer overlap', () => {
    const placed = placeDayBlocks(DAY, [
      event('a', '09:00', '10:00'),
      event('b', '10:00', '11:00'),
      event('c', '13:00', '14:00'),
    ]);
    expect(placed.map((p) => [p.lanes, p.clusterSize])).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
  });

  it('clips events to open hours and drops events outside them', () => {
    const placed = placeDayBlocks(DAY, [
      event('early', '03:00', '07:00'),
      event('long', '04:00', '23:59'),
      event('late', '21:00', '23:00'),
    ]);
    expect(placed.map((p) => p.block.key)).toEqual(['long']);
    expect(placed[0]).toMatchObject({ startRow: 0, endRow: 28 });
  });
});
