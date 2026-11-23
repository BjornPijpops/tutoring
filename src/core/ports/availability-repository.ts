import type { AvailabilitySlot, NewAvailabilitySlot, TimeRange } from '../domain/availability-slot';
import type { PortResult } from './port-error';

/** Storage of the tutor's availability. */
export interface AvailabilityRepository {
  /** Slots starting within the range. */
  listSlots(range: TimeRange): PortResult<readonly AvailabilitySlot[]>;
  /** Creates or updates a slot (tutor only). */
  upsertSlot(slot: NewAvailabilitySlot): PortResult<AvailabilitySlot>;
  /** Removes a slot (tutor only). */
  removeSlot(id: string): PortResult<void>;
}
