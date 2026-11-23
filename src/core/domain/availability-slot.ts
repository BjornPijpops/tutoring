import type { IsoDateTime } from './user';

/** A timeslot the tutor offers. */
export interface AvailabilitySlot {
  readonly id: string;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly status: 'open' | 'booked';
}

/** Data needed to create or change a slot; `id` present means update. */
export type NewAvailabilitySlot = Pick<AvailabilitySlot, 'startsAt' | 'endsAt'> & {
  readonly id?: string;
};

/** Time range used to query slots. */
export interface TimeRange {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
}
