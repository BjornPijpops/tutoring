import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import type { RecurrenceRule } from '../../core/domain/recurrence';
import { SupabaseCalendarEventRepository } from './calendar-event-repository';

const asClient = (fake: unknown) => fake as SupabaseClient;

const rule: RecurrenceRule = {
  startDate: '2027-03-02',
  intervalWeeks: 1,
  weekdays: [2],
  startMinutes: 600,
  endMinutes: 660,
  end: { kind: 'count', count: 4 },
};

// 10:00-11:00 Brussels on 2 Mar 2027 (CET).
const event: CalendarEvent = {
  id: 'e1',
  title: 'Dentist',
  source: 'manual',
  startsAt: '2027-03-02T09:00:00Z',
  endsAt: '2027-03-02T10:00:00Z',
  updatedAt: '2027-03-01T08:00:00.123Z',
  seriesId: 's1',
};

function repoWith(response: unknown) {
  const rpc = vi.fn().mockResolvedValue(response);
  const from = vi.fn();
  return { rpc, from, repo: new SupabaseCalendarEventRepository(asClient({ rpc, from })) };
}

describe('SupabaseCalendarEventRepository series', () => {
  it('creates a series through the RPC and maps the counts', async () => {
    const { repo, rpc } = repoWith({
      data: [{ series_id: 's1', occurrence_count: 2 }],
      error: null,
    });
    const occurrences = [
      { startsAt: '2027-03-02T09:00:00Z', endsAt: '2027-03-02T10:00:00Z', title: 'ignored' },
      { startsAt: '2027-03-09T09:00:00Z', endsAt: '2027-03-09T10:00:00Z' },
    ];
    const result = await repo.addSeries({ rule, title: 'Dentist', occurrences });
    expect(result).toEqual({ ok: true, value: { seriesId: 's1', occurrenceCount: 2 } });
    expect(rpc).toHaveBeenCalledWith('create_calendar_series', {
      p_rule: rule,
      p_title: 'Dentist',
      p_occurrences: [
        { startsAt: '2027-03-02T09:00:00Z', endsAt: '2027-03-02T10:00:00Z' },
        { startsAt: '2027-03-09T09:00:00Z', endsAt: '2027-03-09T10:00:00Z' },
      ],
    });
  });

  it('maps RPC failures and malformed rows', async () => {
    const series = { rule, title: 'x', occurrences: [] };
    const denied = repoWith({ data: null, error: { code: '42501', message: 'no' } });
    expect(await denied.repo.addSeries(series)).toMatchObject({ error: { kind: 'forbidden' } });
    const invalid = repoWith({ data: null, error: { code: '22023', message: 'outside_horizon' } });
    expect(await invalid.repo.addSeries(series)).toMatchObject({ error: { kind: 'validation' } });
    const empty = repoWith({ data: [], error: null });
    expect(await empty.repo.addSeries(series)).toMatchObject({ error: { kind: 'unavailable' } });
    const wrong = repoWith({ data: [{ series_id: 's1', occurrence_count: 'many' }], error: null });
    expect(await wrong.repo.addSeries(series)).toMatchObject({ error: { kind: 'unavailable' } });
    const offline = repoWith(null);
    offline.rpc.mockRejectedValue(new Error('offline'));
    expect(await offline.repo.addSeries(series)).toMatchObject({ error: { kind: 'unavailable' } });
  });

  it('updates with scope and changes derived from the event in Brussels time', async () => {
    const { repo, rpc } = repoWith({
      data: [{ affected_count: 3, series_id: 's2' }],
      error: null,
    });
    const result = await repo.updateEvent(event, event.updatedAt ?? '', 'this');
    expect(result).toEqual({ ok: true, value: { event, affectedCount: 3, seriesId: 's2' } });
    expect(rpc).toHaveBeenCalledWith('update_calendar_event', {
      p_event_id: 'e1',
      p_expected_updated_at: '2027-03-01T08:00:00.123Z',
      p_scope: 'this',
      p_changes: { title: 'Dentist', date: '2027-03-02', startMinutes: 600, endMinutes: 660 },
    });
  });

  it('omits the date for series scopes and passes explicit changes unchanged', async () => {
    const { repo, rpc } = repoWith({ data: [{ affected_count: 4, series_id: null }], error: null });
    const result = await repo.updateEvent(event, 'v', 'all');
    expect(result).toEqual({ ok: true, value: { event, affectedCount: 4 } });
    expect(rpc).toHaveBeenLastCalledWith('update_calendar_event', {
      p_event_id: 'e1',
      p_expected_updated_at: 'v',
      p_scope: 'all',
      p_changes: { title: 'Dentist', startMinutes: 600, endMinutes: 660 },
    });
    await repo.updateEvent(event, 'v', 'following', { title: 'Renamed' });
    expect(rpc).toHaveBeenLastCalledWith('update_calendar_event', {
      p_event_id: 'e1',
      p_expected_updated_at: 'v',
      p_scope: 'following',
      p_changes: { title: 'Renamed' },
    });
  });

  it('maps stale, missing and invalid updates and refuses imported events', async () => {
    const stale = repoWith({ data: null, error: { code: '40001', message: 'x' } });
    expect(await stale.repo.updateEvent(event, 'v')).toMatchObject({ error: { kind: 'conflict' } });
    const gone = repoWith({ data: null, error: { code: 'P0002', message: 'x' } });
    expect(await gone.repo.updateEvent(event, 'v')).toMatchObject({ error: { kind: 'not-found' } });
    const bad = repoWith({ data: [{}], error: null });
    expect(await bad.repo.updateEvent(event, 'v')).toMatchObject({
      error: { kind: 'unavailable' },
    });
    const imported = repoWith({ data: [], error: null });
    const ics = { ...event, source: 'ics' as const, externalId: 'u#1' };
    expect(await imported.repo.updateEvent(ics, 'v')).toMatchObject({
      error: { kind: 'validation' },
    });
    expect(imported.rpc).not.toHaveBeenCalled();
    const offline = repoWith(null);
    offline.rpc.mockRejectedValue(new Error('offline'));
    expect(await offline.repo.updateEvent(event, 'v')).toMatchObject({
      error: { kind: 'unavailable' },
    });
  });

  it('removes with scope and maps the count', async () => {
    const { repo, rpc } = repoWith({ data: [{ affected_count: 5 }], error: null });
    expect(await repo.removeEvent('e1', 'following')).toEqual({
      ok: true,
      value: { affectedCount: 5 },
    });
    expect(rpc).toHaveBeenCalledWith('delete_calendar_event', {
      p_event_id: 'e1',
      p_scope: 'following',
    });
    await repo.removeEvent('e1');
    expect(rpc).toHaveBeenLastCalledWith('delete_calendar_event', {
      p_event_id: 'e1',
      p_scope: 'this',
    });
  });

  it('maps removal errors', async () => {
    const gone = repoWith({ data: null, error: { code: 'P0002', message: 'x' } });
    expect(await gone.repo.removeEvent('x')).toMatchObject({ error: { kind: 'not-found' } });
    const malformed = repoWith({ data: [], error: null });
    expect(await malformed.repo.removeEvent('x')).toMatchObject({ error: { kind: 'unavailable' } });
    const offline = repoWith(null);
    offline.rpc.mockRejectedValue(new Error('offline'));
    expect(await offline.repo.removeEvent('x')).toMatchObject({ error: { kind: 'unavailable' } });
  });

  it('reads the series rule from the series table', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [{ rule }], error: null });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repo = new SupabaseCalendarEventRepository(asClient({ from }));
    expect(await repo.getSeries('s1')).toEqual({ ok: true, value: rule });
    expect(from).toHaveBeenCalledWith('calendar_event_series');
    expect(select).toHaveBeenCalledWith('rule');
    expect(eq).toHaveBeenCalledWith('id', 's1');
  });

  it('maps a missing, malformed, denied or unreachable series', async () => {
    const reply = (value: unknown) => ({
      from: () => ({ select: () => ({ eq: () => value }) }),
    });
    const missing = new SupabaseCalendarEventRepository(
      asClient(reply(Promise.resolve({ data: [], error: null }))),
    );
    expect(await missing.getSeries('s')).toMatchObject({ error: { kind: 'not-found' } });
    const malformed = new SupabaseCalendarEventRepository(
      asClient(reply(Promise.resolve({ data: [{ rule: { startDate: 'x' } }], error: null }))),
    );
    expect(await malformed.getSeries('s')).toMatchObject({ error: { kind: 'unavailable' } });
    const denied = new SupabaseCalendarEventRepository(
      asClient(reply(Promise.resolve({ data: null, error: { code: '42501', message: 'x' } }))),
    );
    expect(await denied.getSeries('s')).toMatchObject({ error: { kind: 'forbidden' } });
    const offline = new SupabaseCalendarEventRepository(
      asClient(reply(Promise.reject(new Error('offline')))),
    );
    expect(await offline.getSeries('s')).toMatchObject({ error: { kind: 'unavailable' } });
  });
});
