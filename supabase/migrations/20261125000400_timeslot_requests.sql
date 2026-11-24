-- Timeslot requests: range-based session requests, schedule integrity and tutor notification.
-- See docs/adr/0010 and docs/adr/0011. Writes happen only through the security-definer
-- functions below; every one pins search_path to '' and is revoked from public/anon.
--
-- Custom SQLSTATEs (five characters, mapped by the Supabase adapter):
--   TR001 pending limit reached, TR002 schedule conflict, TR003 stale request state.

create table public.session_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending'
    constraint session_requests_status check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  cancelled_at timestamptz,
  constraint session_requests_order check (ends_at > starts_at),
  constraint session_requests_max_range check (ends_at <= starts_at + interval '2 hours')
);
create index session_requests_owner_status_time on public.session_requests (user_id, status, starts_at);
create index session_requests_pending_time on public.session_requests (status, starts_at);
-- Accepted sessions can never overlap, even if a code path forgets the explicit check.
alter table public.session_requests add constraint session_requests_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'accepted');

alter table public.session_requests enable row level security;
revoke all on table public.session_requests from public, anon, authenticated;
-- No policies and no grants: the table is only reachable through the definer functions
-- and the service role used by the Edge Function.

-- One notification event per request (the event id is the request id), ids only, never PII.
create table public.tutor_notification_outbox (
  id uuid primary key references public.session_requests(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0
    constraint tutor_notification_outbox_attempts check (attempts >= 0)
);
create index tutor_notification_outbox_retry_idx
  on public.tutor_notification_outbox (sent_at, attempts, created_at);
alter table public.tutor_notification_outbox enable row level security;
revoke all on table public.tutor_notification_outbox from public, anon, authenticated;

-- Same grants as 20261125000200 for the access-request outbox.
grant select on table public.session_requests to service_role;
grant select, update on table public.tutor_notification_outbox to service_role;

-- Every transaction that can create an accepted session or a blocked event takes this lock
-- first, so the cross-table overlap checks cannot pass each other.
create or replace function private.lock_schedule() returns void
language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('tutoring.schedule', 0))
$$;

-- Product rules in Brussels wall-clock time; p_now is injectable for tests only.
-- Duration and the 30-minute grid are both judged on local wall-clock values. A range whose
-- elapsed duration differs from its local wall-clock duration straddles (or sits inside) a
-- clock change; its local times may be nonexistent or ambiguous, so it is rejected with
-- ambiguous_local_time rather than guessed at.
create or replace function private.validate_session_range(
  p_starts_at timestamptz, p_ends_at timestamptz, p_now timestamptz default now())
returns void language plpgsql stable set search_path = '' as $$
declare
  v_tz constant text := 'Europe/Brussels';
  v_start timestamp;
  v_end timestamp;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception using errcode = '22023', message = 'invalid_range';
  end if;
  v_start := p_starts_at at time zone v_tz;
  v_end := p_ends_at at time zone v_tz;
  if v_end - v_start <> p_ends_at - p_starts_at then
    raise exception using errcode = '22023', message = 'ambiguous_local_time';
  end if;
  if v_end - v_start < interval '30 minutes' then
    raise exception using errcode = '22023', message = 'duration_too_short';
  end if;
  if v_end - v_start > interval '2 hours' then
    raise exception using errcode = '22023', message = 'duration_too_long';
  end if;
  if v_start::date <> v_end::date
     or extract(minute from v_start)::int % 30 <> 0 or extract(second from v_start) <> 0
     or extract(minute from v_end)::int % 30 <> 0 or extract(second from v_end) <> 0 then
    raise exception using errcode = '22023', message = 'not_aligned';
  end if;
  if v_start::time < time '08:00' or v_end::time > time '22:00' or v_end::time = time '00:00' then
    raise exception using errcode = '22023', message = 'outside_hours';
  end if;
  if p_starts_at < p_now + interval '24 hours' then
    raise exception using errcode = '22023', message = 'too_soon';
  end if;
  -- Calendar-date horizon: the local start date may be at most 30 local days after today.
  if v_start::date > (p_now at time zone v_tz)::date + 30 then
    raise exception using errcode = '22023', message = 'too_far';
  end if;
end;
$$;

create or replace function public.create_session_request(p_starts_at timestamptz, p_ends_at timestamptz)
returns public.session_requests
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v public.session_requests;
begin
  if v_uid is null or not public.is_approved_tutee() then
    raise insufficient_privilege using message = 'approved account required';
  end if;
  perform private.validate_session_range(p_starts_at, p_ends_at);
  perform private.lock_schedule();
  if (select count(*) from public.session_requests where user_id = v_uid and status = 'pending') >= 3 then
    raise exception using errcode = 'TR001', message = 'pending limit reached';
  end if;
  if exists (select 1 from public.calendar_events e where e.starts_at < p_ends_at and e.ends_at > p_starts_at)
     or exists (select 1 from public.session_requests r
                where r.status = 'accepted' and r.starts_at < p_ends_at and r.ends_at > p_starts_at) then
    raise exception using errcode = 'TR002', message = 'schedule conflict';
  end if;
  insert into public.session_requests (user_id, starts_at, ends_at)
    values (v_uid, p_starts_at, p_ends_at) returning * into v;
  return v;
end;
$$;

create or replace function public.list_my_session_requests(p_from timestamptz, p_to timestamptz)
returns setof public.session_requests
language sql stable security definer set search_path = '' as $$
  select * from public.session_requests
  where user_id = (select auth.uid()) and ends_at > p_from and starts_at < p_to
  order by starts_at
$$;

create or replace function public.list_session_requests_for_tutor()
returns table(id uuid, user_id uuid, starts_at timestamptz, ends_at timestamptz, status text,
              created_at timestamptz, updated_at timestamptz, decided_at timestamptz,
              cancelled_at timestamptz, requester_name text, requester_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise insufficient_privilege using message = 'admin required';
  end if;
  return query
    select r.id, r.user_id, r.starts_at, r.ends_at, r.status::text, r.created_at, r.updated_at,
           r.decided_at, r.cancelled_at,
           left(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Tutee')), 100)::text,
           coalesce(u.email, '')::text
    from public.session_requests r join auth.users u on u.id = r.user_id
    where r.status = 'pending'
    order by r.starts_at limit 200;
end;
$$;

create or replace function public.decide_session_request(p_request_id uuid, p_decision text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.session_requests;
  n integer := 0;
begin
  if not public.is_admin() then
    raise insufficient_privilege using message = 'admin required';
  end if;
  if p_decision is null or p_decision not in ('accepted','declined') then
    raise exception using errcode = '22023', message = 'invalid decision';
  end if;
  perform private.lock_schedule();
  select * into v from public.session_requests where id = p_request_id for update;
  if v.id is null or v.status <> 'pending' then
    raise exception using errcode = 'TR003', message = 'request is no longer pending';
  end if;
  if p_decision = 'accepted' then
    if exists (select 1 from public.calendar_events e where e.starts_at < v.ends_at and e.ends_at > v.starts_at)
       or exists (select 1 from public.session_requests r
                  where r.status = 'accepted' and r.id <> v.id
                    and r.starts_at < v.ends_at and r.ends_at > v.starts_at) then
      raise exception using errcode = 'TR002', message = 'schedule conflict';
    end if;
    update public.session_requests set status = 'declined', decided_at = now(), updated_at = now()
      where status = 'pending' and id <> v.id and starts_at < v.ends_at and ends_at > v.starts_at;
    get diagnostics n = row_count;
  end if;
  update public.session_requests set status = p_decision, decided_at = now(), updated_at = now()
    where id = v.id returning * into v;
  return jsonb_build_object('request', to_jsonb(v), 'overlap_declined_count', n);
end;
$$;

create or replace function public.cancel_session_request(p_request_id uuid)
returns public.session_requests
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.session_requests;
begin
  update public.session_requests
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = p_request_id and user_id = (select auth.uid()) and status in ('pending','accepted')
    returning * into v;
  if v.id is null then
    raise insufficient_privilege using message = 'request cannot be cancelled';
  end if;
  return v;
end;
$$;

-- Owner decision (ADR 0010): there is deliberately NO trigger on calendar_events. The tutor can
-- always add manual events and import ICS files, even over an accepted session. The overlap
-- checks live on the request side only: create_session_request and decide_session_request
-- reject or re-check against blocked events and accepted sessions under the schedule lock.

-- Accepted sessions in a range for the tutor's own calendar (read-only; identity is tutor-only).
create or replace function public.list_accepted_sessions_for_tutor(p_from timestamptz, p_to timestamptz)
returns table(id uuid, starts_at timestamptz, ends_at timestamptz, requester_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise insufficient_privilege using message = 'admin required';
  end if;
  return query
    select r.id, r.starts_at, r.ends_at,
           left(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Tutee')), 100)::text
    from public.session_requests r join auth.users u on u.id = r.user_id
    where r.status = 'accepted' and r.ends_at > p_from and r.starts_at < p_to
    order by r.starts_at limit 500;
end;
$$;

-- Anonymous merged intervals: tutor blocks plus other tutees' accepted sessions. The caller's
-- own sessions are excluded here; they come from list_my_session_requests.
create or replace function public.get_blocked_intervals(p_from timestamptz, p_to timestamptz)
returns table(starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or public.is_approved_tutee()) then
    raise exception using errcode = '42501', message = 'calendar access denied';
  end if;
  if p_from is null or p_to is null or p_to <= p_from
     or p_to > p_from + interval '100 days' then
    raise exception using errcode = '22023', message = 'invalid calendar range';
  end if;
  return query
    with ordered as (
      select greatest(e.starts_at, p_from) as starts_at,
             least(e.ends_at, p_to) as ends_at
      from public.calendar_events e
      where e.starts_at < p_to and e.ends_at > p_from
      union all
      select greatest(s.starts_at, p_from), least(s.ends_at, p_to)
      from public.session_requests s
      where s.status = 'accepted' and s.starts_at < p_to and s.ends_at > p_from
        and s.user_id is distinct from (select auth.uid())
    ), numbered as (
      select o.starts_at, o.ends_at,
             max(o.ends_at) over (
               order by o.starts_at, o.ends_at
               rows between unbounded preceding and 1 preceding
             ) as prior_end
      from ordered o
      where o.ends_at > o.starts_at
    ), islands as (
      select n.starts_at, n.ends_at,
             sum(case when n.prior_end is null or n.starts_at > n.prior_end then 1 else 0 end)
               over (order by n.starts_at, n.ends_at rows between unbounded preceding and current row)
               as island
      from numbered n
    )
    select min(i.starts_at), max(i.ends_at)
    from islands i
    group by i.island
    order by min(i.starts_at);
end;
$$;

-- Tutor notification: same Vault/pg_net/pg_cron path as access requests. A failure here
-- never rolls back the request.
create or replace function private.dispatch_session_notification(p_event_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'access_webhook_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'access_webhook_url' limit 1;
  if v_url is null or v_secret is null then return; end if;
  update public.tutor_notification_outbox set attempts = attempts + 1 where id = p_event_id;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type','application/json', 'x-webhook-secret',v_secret),
    body := jsonb_build_object('event_id',p_event_id, 'user_id',p_user_id, 'event_type','session-requested')
  ) into v_request_id;
exception when others then
  raise warning 'session notification dispatch failed';
end;
$$;

create or replace function private.queue_session_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tutor_notification_outbox (id, user_id) values (new.id, new.user_id);
  perform private.dispatch_session_notification(new.id, new.user_id);
  return new;
exception when others then
  raise warning 'session notification queue failed';
  return new;
end;
$$;
create trigger session_request_notification_trigger
  after insert on public.session_requests
  for each row execute function private.queue_session_notification();

create or replace function private.retry_session_notifications() returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  for v in select id, user_id from public.tutor_notification_outbox
    where sent_at is null and attempts < 5 and created_at > now() - interval '24 hours'
    order by created_at
  loop
    perform private.dispatch_session_notification(v.id, v.user_id);
  end loop;
exception when others then
  raise warning 'session notification retry failed';
end;
$$;

revoke all on function private.lock_schedule() from public, anon, authenticated;
revoke all on function private.validate_session_range(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.dispatch_session_notification(uuid, uuid) from public, anon, authenticated;
revoke all on function private.queue_session_notification() from public, anon, authenticated;
revoke all on function private.retry_session_notifications() from public, anon, authenticated;
revoke all on function public.create_session_request(timestamptz, timestamptz) from public, anon;
revoke all on function public.list_my_session_requests(timestamptz, timestamptz) from public, anon;
revoke all on function public.list_session_requests_for_tutor() from public, anon;
revoke all on function public.decide_session_request(uuid, text) from public, anon;
revoke all on function public.cancel_session_request(uuid) from public, anon;
revoke all on function public.list_accepted_sessions_for_tutor(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_accepted_sessions_for_tutor(timestamptz, timestamptz) to authenticated;
grant execute on function public.create_session_request(timestamptz, timestamptz) to authenticated;
grant execute on function public.list_my_session_requests(timestamptz, timestamptz) to authenticated;
grant execute on function public.list_session_requests_for_tutor() to authenticated;
grant execute on function public.decide_session_request(uuid, text) to authenticated;
grant execute on function public.cancel_session_request(uuid) to authenticated;

select cron.schedule('session-request-notification-retry', '*/10 * * * *',
  $$select private.retry_session_notifications()$$);
