import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateNewEvent,
  type CalendarEvent,
  type NewCalendarEvent,
} from '../../core/domain/calendar-event';
import { eventChangesOf, type EventChanges } from '../../core/domain/event-changes';
import type { TimeRange } from '../../core/domain/interval';
import type { RecurrenceRule, RecurrenceScope } from '../../core/domain/recurrence';
import { err, ok } from '../../core/domain/result';
import type {
  AddedSeries,
  CalendarEventRepository,
  NewCalendarSeries,
  PortError,
  PortResult,
  RemovedEvents,
  UpdatedEvent,
} from '../../core/ports';
import {
  mapAddedSeries,
  mapEventRows,
  mapRemovedRow,
  mapSeriesRule,
  mapSupabaseError,
  mapUpdatedRow,
} from './rows';

const TABLE = 'calendar_events';
const SERIES_TABLE = 'calendar_event_series';
const COLUMNS =
  'id, starts_at, ends_at, title, source, external_id, updated_at, series_id, series_index';
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

/**
 * {@link CalendarEventRepository} on the `calendar_events` table; RLS limits it to the admin.
 * Series writes go through admin-only RPCs that validate and lock in the database.
 */
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

  async addSeries({ rule, title, occurrences }: NewCalendarSeries): PortResult<AddedSeries> {
    try {
      const response = await this.client.rpc('create_calendar_series', {
        p_rule: rule,
        p_title: title,
        p_occurrences: occurrences.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
      });
      return response.error ? err(mapSupabaseError(response.error)) : mapAddedSeries(response.data);
    } catch {
      return err(UNAVAILABLE);
    }
  }

  async getSeries(seriesId: string): PortResult<RecurrenceRule> {
    try {
      const { data, error } = await this.client
        .from(SERIES_TABLE)
        .select('rule')
        .eq('id', seriesId);
      if (error) return err(mapSupabaseError(error));
      if (Array.isArray(data) && data.length === 0) {
        return err({ kind: 'not-found', message: 'That series no longer exists.' });
      }
      return mapSeriesRule(data);
    } catch {
      return err(UNAVAILABLE);
    }
  }

  async updateEvent(
    event: CalendarEvent,
    expectedUpdatedAt: string,
    scope: RecurrenceScope = 'this',
    changes?: EventChanges,
  ): PortResult<UpdatedEvent> {
    if (event.source !== 'manual') {
      return err({ kind: 'validation', message: 'Imported events cannot be edited.' });
    }
    try {
      const response = await this.client.rpc('update_calendar_event', {
        p_event_id: event.id,
        p_expected_updated_at: expectedUpdatedAt,
        p_scope: scope,
        p_changes: changes ?? eventChangesOf(event, scope),
      });
      if (response.error) return err(mapSupabaseError(response.error));
      const mapped = mapUpdatedRow(response.data);
      return mapped.ok ? ok({ event, ...mapped.value }) : mapped;
    } catch {
      return err(UNAVAILABLE);
    }
  }

  async removeEvent(id: string, scope: RecurrenceScope = 'this'): PortResult<RemovedEvents> {
    try {
      const response = await this.client.rpc('delete_calendar_event', {
        p_event_id: id,
        p_scope: scope,
      });
      return response.error ? err(mapSupabaseError(response.error)) : mapRemovedRow(response.data);
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
