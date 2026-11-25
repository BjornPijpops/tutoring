import type { IsoDate } from '../../core/domain/local-time';
import type { IsoDateTime, Interval } from '../../core/domain/interval';

/**
 * What a block means to the viewer: `busy` (anonymous), `blocked` (tutor-owned), `imported`
 * (from a calendar file) or `available` (offered slot, e.g. in a future tutee-request mode).
 */
export type GridBlockKind = 'busy' | 'blocked' | 'imported' | 'available';

/**
 * Public view model of one block in the reusable grid. Containers map their private data to
 * this; the grid never sees titles, ids or rows of the underlying records.
 */
export interface GridBlock extends Interval {
  /** Opaque key, unique per block; echoed back in activate/delete intents. */
  readonly key: string;
  /** Text shown and announced; the container decides how much to reveal. */
  readonly label: string;
  readonly kind: GridBlockKind;
  /** When true the grid does not activate the block. */
  readonly readOnly: boolean;
  /** True when the block belongs to a repeating series. */
  readonly repeats?: boolean;
}

/** A local-day selection before it is converted to persistence. */
export interface LocalTimeRange {
  readonly date: IsoDate;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** A projected day and its 30-minute cells. */
export interface GridDay {
  readonly date: IsoDate;
  readonly cells: readonly GridCell[];
}

export interface GridCell {
  readonly date: IsoDate;
  readonly index: number;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly state: 'free' | 'blocked' | 'closed';
  readonly label: string;
}
