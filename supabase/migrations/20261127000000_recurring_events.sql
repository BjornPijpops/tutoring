-- Recurring manual calendar events (ADR 0013). Apply only after review.
--
-- Occurrences stay ordinary calendar_events rows; calendar_event_series only groups them and keeps
-- the display-only rule. The client expands the rule (src/core/domain/recurrence.ts); the server
-- enforces invariants instead of re-expanding. get_blocked_intervals, the tutee projection, ICS
-- rows and every session-request RPC are untouched. Events are never overlap-checked against
-- accepted sessions or other events: the schedule lock is taken so that cross-table checks in the
-- session-request RPCs cannot pass a half-written series.
--
-- Do not apply before 20261125000400_timeslot_requests.sql (private.lock_schedule()).

create table if not exists public.calendar_event_series (
  id uuid primary key default gen_random_uuid(),
  rule jsonb not null,
  created_at timestamptz not null default now(),
  constraint calendar_event_series_rule_object check (jsonb_typeof(rule) = 'object')
);

-- series_index is the stable occurrence order within a series: 0..n-1 by original start at
-- creation, kept when an occurrence is moved and when a series is split. "This and following"
-- follows it instead of starts_at, so a moved occurrence keeps its place in the series.
alter table public.calendar_events
  add column if not exists series_id uuid references public.calendar_event_series (id) on delete cascade,
  add column if not exists series_index integer;
alter table public.calendar_events
  drop constraint if exists calendar_events_series_index_check;
alter table public.calendar_events
  add constraint calendar_events_series_index_check
  check ((series_id is null) = (series_index is null) and (series_index is null or series_index >= 0));
create index if not exists calendar_events_series_start_idx
  on public.calendar_events (series_id, starts_at);
alter table public.calendar_events
  drop constraint if exists calendar_events_series_index_key;
alter table public.calendar_events
  add constraint calendar_events_series_index_key unique (series_id, series_index)
  deferrable initially deferred;

-- Admin may read series (for the "Repeats ..." summary); writes only through the RPCs below.
alter table public.calendar_event_series enable row level security;
revoke all on table public.calendar_event_series from public, anon, authenticated;
grant select on table public.calendar_event_series to authenticated;
drop policy if exists calendar_event_series_admin_read on public.calendar_event_series;
create policy calendar_event_series_admin_read on public.calendar_event_series
  for select to authenticated
  using ((select public.is_admin()));

-- Helpers (private schema: not reachable through the Data API).

create or replace function private.json_int(p_value jsonb) returns integer
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_value) = 'number'
      and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and abs((p_value #>> '{}')::numeric) < 1000000
    then (p_value #>> '{}')::integer
  end
$$;

create or replace function private.json_date(p_value jsonb) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return (p_value #>> '{}')::date;
exception when others then
  return null;
end;
$$;

-- Minutes after local Brussels midnight.
create or replace function private.local_minutes(p_instant timestamptz) returns integer
language sql immutable set search_path = '' as $$
  select (extract(hour from p_instant at time zone 'Europe/Brussels') * 60
        + extract(minute from p_instant at time zone 'Europe/Brussels'))::integer
$$;

-- Minutes of a local start or end time must sit on the 30-minute grid between 08:00 and 22:00.
create or replace function private.assert_grid_minutes(p_minutes integer) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_minutes is null then
    raise exception using errcode = '22023', message = 'invalid_time';
  end if;
  if p_minutes % 30 <> 0 then
    raise exception using errcode = '22023', message = 'not_aligned';
  end if;
  if p_minutes < 8 * 60 or p_minutes > 22 * 60 then
    raise exception using errcode = '22023', message = 'outside_hours';
  end if;
end;
$$;

-- Shape of the display-only rule stored with a series.
create or replace function private.assert_series_rule(p_rule jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_weekdays jsonb;
  v_interval integer;
  v_start integer;
  v_end integer;
  v_kind text;
  v_count integer;
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_rule';
  end if;
  v_interval := private.json_int(p_rule -> 'intervalWeeks');
  v_start := private.json_int(p_rule -> 'startMinutes');
  v_end := private.json_int(p_rule -> 'endMinutes');
  v_weekdays := p_rule -> 'weekdays';
  if private.json_date(p_rule -> 'startDate') is null
     or v_interval is null or v_interval not between 1 and 12
     or jsonb_typeof(v_weekdays) is distinct from 'array'
     or jsonb_typeof(p_rule -> 'end') is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid_rule';
  end if;
  if jsonb_array_length(v_weekdays) not between 1 and 7
     or (select count(*) from jsonb_array_elements(v_weekdays) w
         where private.json_int(w.value) between 1 and 7) <> jsonb_array_length(v_weekdays) then
    raise exception using errcode = '22023', message = 'invalid_rule';
  end if;
  perform private.assert_grid_minutes(v_start);
  perform private.assert_grid_minutes(v_end);
  if v_end <= v_start then
    raise exception using errcode = '22023', message = 'invalid_range';
  end if;
  v_kind := p_rule -> 'end' ->> 'kind';
  v_count := private.json_int(p_rule -> 'end' -> 'count');
  if not coalesce((v_kind = 'until' and private.json_date(p_rule -> 'end' -> 'date') is not null)
       or (v_kind = 'count' and v_count between 2 and 400), false) then
    raise exception using errcode = '22023', message = 'invalid_rule';
  end if;
end;
$$;

revoke all on function private.json_int(jsonb) from public, anon, authenticated;
revoke all on function private.json_date(jsonb) from public, anon, authenticated;
revoke all on function private.local_minutes(timestamptz) from public, anon, authenticated;
revoke all on function private.assert_grid_minutes(integer) from public, anon, authenticated;
revoke all on function private.assert_series_rule(jsonb) from public, anon, authenticated;

-- The rule must agree with the occurrences and the allowed range: startDate from today until the
-- horizon and not after the first occurrence; an end date on or after the last occurrence, not
-- before startDate and not past the horizon; an after-N end equal to the number of occurrences.
create or replace function private.assert_series_rule_matches(
  p_rule jsonb, p_today date, p_horizon date, p_count integer, p_first date, p_last date)
returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_start date := private.json_date(p_rule -> 'startDate');
  v_until date := private.json_date(p_rule -> 'end' -> 'date');
begin
  if v_start < p_today or v_start > p_horizon or v_start > p_first then
    raise exception using errcode = '22023', message = 'invalid_rule';
  end if;
  if p_rule -> 'end' ->> 'kind' = 'until'
     and (v_until < v_start or v_until > p_horizon or v_until < p_last) then
    raise exception using errcode = '22023', message = 'invalid_rule';
  end if;
  if p_rule -> 'end' ->> 'kind' = 'count'
     and private.json_int(p_rule -> 'end' -> 'count') <> p_count then
    raise exception using errcode = '22023', message = 'invalid_rule';
  end if;
end;
$$;

revoke all on function private.assert_series_rule_matches(jsonb, date, date, integer, date, date)
  from public, anon, authenticated;

-- The series now ends on its last remaining occurrence (used after a split or a "following" delete).
create or replace function private.end_series_at_last_event(p_series uuid) returns void
language sql volatile set search_path = '' as $$
  update public.calendar_event_series s
  set rule = jsonb_set(s.rule, '{end}', jsonb_build_object('kind', 'until', 'date', to_char(
    (select max((e.starts_at at time zone 'Europe/Brussels')::date)
     from public.calendar_events e where e.series_id = p_series), 'YYYY-MM-DD')))
  where s.id = p_series
    and exists (select 1 from public.calendar_events e where e.series_id = p_series)
$$;
revoke all on function private.end_series_at_last_event(uuid) from public, anon, authenticated;
-- Creates a series and all its occurrences atomically; returns the new series id and the count.
-- Occurrence invariants (Brussels wall clock): one local date, 30-minute grid, 08:00-22:00,
-- starting from today until today + 12 months; 2 to 400 occurrences; the rule matches them.
create or replace function public.create_calendar_series(
  p_rule jsonb, p_title text, p_occurrences jsonb)
returns table(series_id uuid, occurrence_count integer)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tz constant text := 'Europe/Brussels';
  v_today date := (now() at time zone 'Europe/Brussels')::date;
  v_last date := ((now() at time zone 'Europe/Brussels')::date + interval '12 months')::date;
  v_series uuid;
  v_count integer;
  v_item jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_first date;
  v_final date;
  v_position integer := 0;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'calendar access denied';
  end if;
  perform private.lock_schedule();
  if p_title is null or char_length(p_title) > 200 then
    raise exception using errcode = '22023', message = 'invalid_title';
  end if;
  perform private.assert_series_rule(p_rule);
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_occurrences';
  end if;
  v_count := jsonb_array_length(p_occurrences);
  if v_count < 2 or v_count > 400 then
    raise exception using errcode = '22023', message = 'invalid_count';
  end if;

  insert into public.calendar_event_series (rule) values (p_rule) returning id into v_series;
  for v_item in select o.value from jsonb_array_elements(p_occurrences) o loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'startsAt') is distinct from 'string'
       or jsonb_typeof(v_item -> 'endsAt') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'invalid_occurrences';
    end if;
    begin
      v_starts := (v_item ->> 'startsAt')::timestamptz;
      v_ends := (v_item ->> 'endsAt')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid_occurrences';
    end;
    v_local_start := v_starts at time zone v_tz;
    v_local_end := v_ends at time zone v_tz;
    if v_ends <= v_starts
       or v_local_start::date <> v_local_end::date
       or v_local_end - v_local_start <> v_ends - v_starts then
      raise exception using errcode = '22023', message = 'invalid_range';
    end if;
    if extract(second from v_local_start) <> 0 or extract(second from v_local_end) <> 0 then
      raise exception using errcode = '22023', message = 'not_aligned';
    end if;
    perform private.assert_grid_minutes(private.local_minutes(v_starts));
    perform private.assert_grid_minutes(private.local_minutes(v_ends));
    if v_local_start::date < v_today or v_local_start::date > v_last then
      raise exception using errcode = '22023', message = 'outside_horizon';
    end if;
    v_first := least(v_first, v_local_start::date);
    v_final := greatest(v_final, v_local_start::date);
    insert into public.calendar_events (starts_at, ends_at, title, source, series_id, series_index)
    values (v_starts, v_ends, p_title, 'manual', v_series, v_position);
    v_position := v_position + 1;
  end loop;
  perform private.assert_series_rule_matches(p_rule, v_today, v_last, v_count, v_first, v_final);
  -- Placeholder indexes follow the array order; the stored order is chronological.
  update public.calendar_events e set series_index = r.position - 1
  from (select x.id, row_number() over (order by x.starts_at, x.id) as position
        from public.calendar_events x where x.series_id = v_series) r
  where e.id = r.id;
  return query select v_series, v_count;
end;
$$;

-- Edits one event, this and following events, or all events of a series.
-- p_changes: any of title, date (this event only), startMinutes, endMinutes (Brussels minutes).
-- Only the clicked row's version (updated_at, compared to the millisecond the client sees) is
-- checked; the other rows in scope are last-writer-wins. "following" splits the series at the
-- clicked occurrence (the returned series_id is then the new one). Non-series events accept only
-- scope 'this'. Imported events cannot be edited.
create or replace function public.update_calendar_event(
  p_event_id uuid, p_expected_updated_at timestamptz, p_scope text, p_changes jsonb)
returns table(affected_count integer, series_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tz constant text := 'Europe/Brussels';
  v_today date := (now() at time zone 'Europe/Brussels')::date;
  v_last date := ((now() at time zone 'Europe/Brussels')::date + interval '12 months')::date;
  v_target public.calendar_events;
  v_title text;
  v_date date;
  v_start_min integer;
  v_end_min integer;
  v_series uuid;
  v_new_series uuid;
  v_rule jsonb;
  v_clicked_date date;
  v_before integer;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'calendar access denied';
  end if;
  if p_scope is null or p_scope not in ('this', 'following', 'all') then
    raise exception using errcode = '22023', message = 'invalid_scope';
  end if;
  perform private.lock_schedule();
  select * into v_target from public.calendar_events e where e.id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'event not found';
  end if;
  if v_target.source <> 'manual' then
    raise exception using errcode = '22023', message = 'imported_event';
  end if;
  if p_expected_updated_at is null
     or date_trunc('milliseconds', v_target.updated_at)
        <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception using errcode = '40001', message = 'event changed';
  end if;
  if p_scope <> 'this' and v_target.series_id is null then
    raise exception using errcode = '22023', message = 'not_in_series';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_changes) k
                where k not in ('title', 'date', 'startMinutes', 'endMinutes')) then
    raise exception using errcode = '22023', message = 'invalid_changes';
  end if;
  v_clicked_date := (v_target.starts_at at time zone v_tz)::date;
  if p_changes -> 'title' is not null then
    if jsonb_typeof(p_changes -> 'title') <> 'string' or char_length(p_changes ->> 'title') > 200 then
      raise exception using errcode = '22023', message = 'invalid_title';
    end if;
    v_title := p_changes ->> 'title';
  end if;
  if p_changes -> 'date' is not null then
    if p_scope <> 'this' then
      raise exception using errcode = '22023', message = 'date_requires_this_event';
    end if;
    v_date := private.json_date(p_changes -> 'date');
    if v_date is null then
      raise exception using errcode = '22023', message = 'invalid_date';
    end if;
    if v_date <> v_clicked_date and (v_date < v_today or v_date > v_last) then
      raise exception using errcode = '22023', message = 'outside_horizon';
    end if;
  end if;
  if p_changes -> 'startMinutes' is not null then
    v_start_min := private.json_int(p_changes -> 'startMinutes');
    perform private.assert_grid_minutes(v_start_min);
  end if;
  if p_changes -> 'endMinutes' is not null then
    v_end_min := private.json_int(p_changes -> 'endMinutes');
    perform private.assert_grid_minutes(v_end_min);
  end if;

  v_series := v_target.series_id;
  if p_scope = 'following' then
    select count(*) into v_before from public.calendar_events e
    where e.series_id = v_series and e.series_index < v_target.series_index;
    if v_before > 0 then
      select s.rule into v_rule from public.calendar_event_series s where s.id = v_series;
      insert into public.calendar_event_series (rule)
      select jsonb_set(
               jsonb_set(v_rule, '{startDate}', to_jsonb(to_char(min(m.local_date), 'YYYY-MM-DD'))),
               '{end}',
               jsonb_build_object('kind', 'until', 'date', to_char(max(m.local_date), 'YYYY-MM-DD')))
      from (select (e.starts_at at time zone v_tz)::date as local_date
            from public.calendar_events e
            where e.series_id = v_series and e.series_index >= v_target.series_index) m
      returning id into v_new_series;
      update public.calendar_events e set series_id = v_new_series
      where e.series_id = v_series and e.series_index >= v_target.series_index;
      perform private.end_series_at_last_event(v_series);
      v_series := v_new_series;
    end if;
  end if;

  -- Every row in scope must keep end after start once only one of the two times changes.
  if (v_start_min is not null or v_end_min is not null) and exists (
    select 1 from public.calendar_events e
    where (p_scope = 'this' and e.id = v_target.id or p_scope <> 'this' and e.series_id = v_series)
      and coalesce(v_end_min, private.local_minutes(e.ends_at))
        <= coalesce(v_start_min, private.local_minutes(e.starts_at))
      and (e.starts_at at time zone v_tz)::date = (e.ends_at at time zone v_tz)::date) then
    raise exception using errcode = '22023', message = 'invalid_range';
  end if;

  -- Each row keeps its own local date unless this event is moved; times are rebuilt from wall clock
  -- so rows on either side of a clock change keep their Brussels time.
  update public.calendar_events e set
    title = coalesce(v_title, e.title),
    starts_at = case when v_date is null and v_start_min is null then e.starts_at
      else (coalesce(v_date, (e.starts_at at time zone v_tz)::date)::timestamp
            + make_interval(mins => coalesce(v_start_min, private.local_minutes(e.starts_at))))
           at time zone v_tz end,
    ends_at = case when v_date is null and v_end_min is null then e.ends_at
      else ((coalesce(v_date, (e.starts_at at time zone v_tz)::date)
             + ((e.ends_at at time zone v_tz)::date - (e.starts_at at time zone v_tz)::date))::timestamp
            + make_interval(mins => coalesce(v_end_min, private.local_minutes(e.ends_at))))
           at time zone v_tz end
  where case when p_scope = 'this' then e.id = v_target.id else e.series_id = v_series end;
  get diagnostics v_count = row_count;

  if p_scope <> 'this' and (v_start_min is not null or v_end_min is not null) then
    update public.calendar_event_series s
    set rule = jsonb_set(jsonb_set(s.rule, '{startMinutes}',
        to_jsonb(coalesce(v_start_min, private.json_int(s.rule -> 'startMinutes')))),
        '{endMinutes}', to_jsonb(coalesce(v_end_min, private.json_int(s.rule -> 'endMinutes'))))
    where s.id = v_series;
  end if;
  return query select v_count, v_series;
end;
$$;

-- Deletes one event, this and following events, or all events of a series; an emptied series is
-- removed. Non-series and imported events accept only scope 'this'.
create or replace function public.delete_calendar_event(p_event_id uuid, p_scope text)
returns table(affected_count integer)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_target public.calendar_events;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'calendar access denied';
  end if;
  if p_scope is null or p_scope not in ('this', 'following', 'all') then
    raise exception using errcode = '22023', message = 'invalid_scope';
  end if;
  perform private.lock_schedule();
  select * into v_target from public.calendar_events e where e.id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'event not found';
  end if;
  if p_scope <> 'this' and v_target.series_id is null then
    raise exception using errcode = '22023', message = 'not_in_series';
  end if;

  delete from public.calendar_events e
  where case p_scope
    when 'this' then e.id = v_target.id
    when 'all' then e.series_id = v_target.series_id
    else e.series_id = v_target.series_id and e.series_index >= v_target.series_index end;
  get diagnostics v_count = row_count;

  if v_target.series_id is not null then
    delete from public.calendar_event_series s
    where s.id = v_target.series_id
      and not exists (select 1 from public.calendar_events e where e.series_id = s.id);
    if p_scope = 'following' then
      perform private.end_series_at_last_event(v_target.series_id);
    end if;
  end if;
  return query select v_count;
end;
$$;

revoke all on function public.create_calendar_series(jsonb, text, jsonb) from public, anon;
revoke all on function public.update_calendar_event(uuid, timestamptz, text, jsonb) from public, anon;
revoke all on function public.delete_calendar_event(uuid, text) from public, anon;
grant execute on function public.create_calendar_series(jsonb, text, jsonb) to authenticated;
grant execute on function public.update_calendar_event(uuid, timestamptz, text, jsonb) to authenticated;
grant execute on function public.delete_calendar_event(uuid, text) to authenticated;
