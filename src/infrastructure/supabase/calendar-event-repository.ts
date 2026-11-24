import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateNewEvent,
  type CalendarEvent,
  type NewCalendarEvent,
} from '../../core/domain/calendar-event';
import type { TimeRange } from '../../core/domain/interval';
import { err, ok } from '../../core/domain/result';
import type { CalendarEventRepository, PortError, PortResult } from '../../core/ports';
import { mapEventRows, mapSupabaseError } from './rows';

const TABLE = 'calendar_events';
const COLUMNS = 'id, starts_at, ends_at, title, source, external_id, updated_at';
const BATCH_SIZE = 500;

const UNAVAILABLE: PortError = {
  kind: 'unavailable',
  message: 'The calendar service is not available.',
};

function toRow(event: NewCalendarEvent) {
  return {
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    title: event.title,
    source: event.source,
    external_id: event.externalId ?? null,
  };
}

/** {@link CalendarEventRepository} on the `calendar_events` table; RLS limits it to the admin. */
export class SupabaseCalendarEventRepository implements CalendarEventRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listEvents(range: TimeRange): PortResult<readonly CalendarEvent[]> {
    try {
      const { data, error } = await this.client
        .from(TABLE)
        .select(COLUMNS)
        .lt('starts_at', range.to)
        .gt('ends_at', range.from)
        .order('starts_at', { ascending: true });
      return error ? err(mapSupabaseError(error)) : mapEventRows(data);
    } catch {
      return err(UNAVAILABLE);
    }
  }

  async addEvents(events: readonly NewCalendarEvent[]): PortResult<readonly CalendarEvent[]> {
    for (const event of events) {
      const problem = validateNewEvent(event);
      if (problem) return err({ kind: 'validation', message: problem });
    }
    const added: CalendarEvent[] = [];
    try {
      for (let index = 0; index < events.length; index += BATCH_SIZE) {
        const batch = events.slice(index, index + BATCH_SIZE).map(toRow);
        // Duplicates of an imported (source, external_id) are ignored, so re-imports are idempotent.
        const { data, error } = await this.client
          .from(TABLE)
          .upsert(batch, { onConflict: 'source,external_id', ignoreDuplicates: true })
          .select(COLUMNS);
        if (error) return err(mapSupabaseError(error));
        const mapped = mapEventRows(data);
        if (!mapped.ok) return mapped;
        added.push(...mapped.value);
      }
    } catch {
      return err(UNAVAILABLE);
    }
    return ok(added);
  }

  async updateEvent(event: CalendarEvent, expectedUpdatedAt: string): PortResult<CalendarEvent> {
    if (event.source !== 'manual')
      return err({ kind: 'validation', message: 'Imported events cannot be edited.' });
    const problem = validateNewEvent(event);
    if (problem) return err({ kind: 'validation', message: problem });
    try {
      const { data, error } = await this.client
        .from(TABLE)
        .update({ starts_at: event.startsAt, ends_at: event.endsAt, title: event.title })
        .eq('id', event.id)
        .eq('updated_at', expectedUpdatedAt)
        .select(COLUMNS);
      if (error) return err(mapSupabaseError(error));
      const mapped = mapEventRows(data);
      if (!mapped.ok) return mapped;
      const updated = mapped.value[0];
      return updated
        ? ok(updated)
        : err({ kind: 'conflict', message: 'This event changed. Review the times and try again.' });
    } catch {
      return err(UNAVAILABLE);
    }
  }

  async removeEvent(id: string): PortResult<void> {
    try {
      const { data, error } = await this.client.from(TABLE).delete().eq('id', id).select('id');
      if (error) return err(mapSupabaseError(error));
      // Row level security hides rows the caller may not touch, so "no row" covers both cases.
      return Array.isArray(data) && data.length > 0
        ? ok(undefined)
        : err({ kind: 'not-found', message: 'The event was not found.' });
    } catch {
      return err(UNAVAILABLE);
    }
  }

  async removeImportedEvents(): PortResult<void> {
    try {
      const { error } = await this.client.from(TABLE).delete().eq('source', 'ics');
      return error ? err(mapSupabaseError(error)) : ok(undefined);
    } catch {
      return err(UNAVAILABLE);
    }
  }
}
