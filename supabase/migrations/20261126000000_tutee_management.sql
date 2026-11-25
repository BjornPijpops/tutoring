-- Tutee management: lifecycle statuses, audit trail and tutor RPCs. See docs/adr/0012.
--
-- One state machine (private.apply_access_action) serves act_on_tutee and
-- decide_access_request. Lock order everywhere: private.lock_schedule() first, then the
-- access_requests row (for update). request_access and allow_access_request_again only take
-- the row lock. create_session_request re-checks approval after it holds the schedule lock.
--
-- SQLSTATE use: TR003 = stale or invalid transition (nothing is changed), P0001 'access
-- request blocked' = a blocked user asked again, 42501 = not allowed, 22023 = bad input,
-- P0002 = unknown user or session.
--
-- Do not apply before 20261125000400_timeslot_requests.sql (it needs private.lock_schedule()).

-- 1. Status model -----------------------------------------------------------------------
alter table public.access_requests drop constraint if exists access_requests_status;
alter table public.access_requests add constraint access_requests_status
  check (status in ('pending','approved','denied','revoked','blocked'));

-- Tutees read their own state only through get_my_access / get_my_access_request, which
-- project revoked and blocked to denied. A direct table read would reveal both words.
drop policy if exists access_requests_select on public.access_requests;
revoke select on public.access_requests from authenticated;

-- 2. Audit trail (append-only; ids, enums, counts and timestamps only) --------------------
create table public.access_audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid,
  action text not null check (action in ('requested','re_requested','approved','denied',
    'revoked','restored','blocked','unblocked','cooldown_reset')),
  from_status text check (from_status is null
    or from_status in ('pending','approved','denied','revoked','blocked')),
  to_status text check (to_status is null
    or to_status in ('pending','approved','denied','revoked','blocked')),
  sessions_ended integer not null default 0 check (sessions_ended >= 0),
  created_at timestamptz not null default now()
);
create index access_audit_log_user_created on public.access_audit_log (user_id, created_at desc);
alter table public.access_audit_log enable row level security;
-- Supabase default privileges also grant service_role; the Edge Function never reads this table.
revoke all on table public.access_audit_log from public, anon, authenticated, service_role;
revoke all on sequence public.access_audit_log_id_seq from public, anon, authenticated, service_role;

-- 3. Private helpers --------------------------------------------------------------------
-- Same expression as list_access_requests, so list, detail and inbox agree on the name.
create or replace function private.tutee_display_name(p_meta jsonb, p_email text)
returns text language sql immutable set search_path = '' as $$
  select left(btrim(coalesce(p_meta->>'full_name', p_meta->>'name',
    split_part(coalesce(p_email, ''), '@', 1), '')), 100)::text
$$;

create or replace function private.audit_access(
  p_user uuid, p_action text, p_from text, p_to text, p_ended integer default 0)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.access_audit_log (user_id, actor_id, action, from_status, to_status, sessions_ended)
  values (p_user, (select auth.uid()), p_action, p_from, p_to, p_ended)
$$;

-- The single state machine. Rejected transitions raise TR003 and change nothing.
create or replace function private.apply_access_action(p_user_id uuid, p_action text, p_policy text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.access_requests;
  v_new text;
  v_audit text;
  v_pending integer := 0;
  v_accepted integer := 0;
begin
  if p_action is null or p_action not in ('approve','deny','revoke','restore','block','unblock')
     or p_policy is null or p_policy not in ('keep','cancel_all') then
    raise exception using errcode = '22023', message = 'invalid action';
  end if;
  if p_policy = 'cancel_all' and p_action not in ('revoke','block') then
    raise exception using errcode = '22023', message = 'invalid session policy';
  end if;
  if p_user_id is null or p_user_id = (select auth.uid()) then
    raise exception using errcode = '22023', message = 'invalid user';
  end if;
  -- Schedule lock first, always (even for 'keep': pending sessions are declined and a
  -- concurrent create_session_request must see the outcome), then the access row.
  perform private.lock_schedule();
  select * into v_row from public.access_requests where user_id = p_user_id for update;
  if v_row.user_id is null then raise no_data_found using message = 'access request not found'; end if;

  if not (case p_action
            when 'approve' then v_row.status in ('pending','denied')
            when 'deny' then v_row.status = 'pending'
            when 'revoke' then v_row.status = 'approved'
            when 'restore' then v_row.status = 'revoked'
            when 'block' then v_row.status in ('pending','approved','denied','revoked')
            else v_row.status = 'blocked'
          end) then
    raise exception using errcode = 'TR003', message = 'stale access state';
  end if;

  v_new := case p_action when 'approve' then 'approved' when 'restore' then 'approved'
             when 'deny' then 'denied' when 'revoke' then 'revoked'
             when 'block' then 'blocked' else 'denied' end;
  v_audit := case p_action when 'approve' then 'approved' when 'restore' then 'restored'
               when 'deny' then 'denied' when 'revoke' then 'revoked'
               when 'block' then 'blocked' else 'unblocked' end;

  if p_action in ('revoke','block') then
    update public.session_requests set status = 'declined', decided_at = now(), updated_at = now()
      where user_id = p_user_id and status = 'pending';
    get diagnostics v_pending = row_count;
    if p_policy = 'cancel_all' then
      update public.session_requests set status = 'cancelled', cancelled_at = now(), updated_at = now()
        where user_id = p_user_id and status = 'accepted' and starts_at > now();
      get diagnostics v_accepted = row_count;
    end if;
  end if;

  update public.access_requests
    set status = v_new, decided_at = now(),
        next_request_at = case when p_action in ('deny','revoke') then now() + interval '8 hours' end
    where user_id = p_user_id;
  perform private.audit_access(p_user_id, v_audit, v_row.status, v_new, v_pending + v_accepted);
  return jsonb_build_object('status', v_new, 'pending_declined', v_pending,
                            'accepted_cancelled', v_accepted);
end;
$$;

-- 4. Tutor RPCs -------------------------------------------------------------------------
create or replace function public.act_on_tutee(
  p_user_id uuid, p_action text, p_session_policy text default 'keep')
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  return private.apply_access_action(p_user_id, p_action, p_session_policy);
end;
$$;

-- Inbox compatibility: same signature and return type. Approving a revoked tutee restores
-- access; denying an approved tutee revokes it. No-ops are TR003.
create or replace function public.decide_access_request(p_user_id uuid, p_decision text)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_status text;
  v_row public.access_requests;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  if p_decision is null or p_decision not in ('approved','denied') then
    raise exception using errcode = '22023', message = 'invalid decision';
  end if;
  select r.status into v_status from public.access_requests r where r.user_id = p_user_id;
  if v_status is null then raise no_data_found using message = 'access request not found'; end if;
  perform private.apply_access_action(p_user_id,
    case when p_decision = 'approved' and v_status = 'revoked' then 'restore'
         when p_decision = 'approved' then 'approve'
         when v_status = 'approved' then 'revoke'
         else 'deny' end,
    'keep');
  select * into v_row from public.access_requests where user_id = p_user_id;
  return v_row;
end;
$$;

create or replace function public.allow_access_request_again(p_user_id uuid)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.access_requests;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  select * into v_row from public.access_requests
    where user_id = p_user_id and status in ('denied','revoked') for update;
  if v_row.user_id is null then
    raise no_data_found using message = 'denied access request not found';
  end if;
  if v_row.next_request_at is null then
    raise exception using errcode = 'TR003', message = 'nothing to reset';
  end if;
  update public.access_requests set next_request_at = null
    where user_id = p_user_id returning * into v_row;
  perform private.audit_access(p_user_id, 'cooldown_reset', v_row.status, v_row.status, 0);
  return v_row;
end;
$$;

-- Search and filter are server side. jsonb avoids RETURN QUERY type mismatches.
-- Counts follow the search but ignore the status filter, so the chips stay stable.
create or replace function public.list_tutees(
  p_status text default null, p_search text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(p_search), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := coalesce(p_offset, 0);
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  if p_status is not null and p_status not in ('pending','approved','denied','revoked','blocked') then
    raise exception using errcode = '22023', message = 'invalid status';
  end if;
  if char_length(coalesce(v_search, '')) > 100 or v_offset < 0 then
    raise exception using errcode = '22023', message = 'invalid paging or search';
  end if;

  with matched as (
    select r.user_id,
      private.tutee_display_name(u.raw_user_meta_data, u.email) as display_name,
      coalesce(u.email, '')::text as email,
      r.status::text as status,
      r.created_at, r.requested_at, r.decided_at, r.next_request_at,
      r.request_count::integer as request_count,
      (select count(*)::integer from public.session_requests s
        where s.user_id = r.user_id and s.status = 'pending') as pending_sessions,
      (select count(*)::integer from public.session_requests s
        where s.user_id = r.user_id and s.status = 'accepted' and s.starts_at > now())
        as accepted_future_sessions
    from public.access_requests r join auth.users u on u.id = r.user_id
    where v_search is null
       or strpos(lower(private.tutee_display_name(u.raw_user_meta_data, u.email)), lower(v_search)) > 0
       or strpos(lower(coalesce(u.email, '')), lower(v_search)) > 0
  ), filtered as (
    select m.*, row_number() over (
      order by (m.status = 'pending') desc, m.requested_at desc, m.user_id) as rn
    from matched m where p_status is null or m.status = p_status
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(f) - 'rn' order by f.rn) from filtered f
                       where f.rn > v_offset and f.rn <= v_offset + v_limit), '[]'::jsonb),
    'total', (select count(*)::integer from filtered),
    'counts', jsonb_build_object(
      'pending', (select count(*)::integer from matched where status = 'pending'),
      'approved', (select count(*)::integer from matched where status = 'approved'),
      'denied', (select count(*)::integer from matched where status = 'denied'),
      'revoked', (select count(*)::integer from matched where status = 'revoked'),
      'blocked', (select count(*)::integer from matched where status = 'blocked'),
      'all', (select count(*)::integer from matched)))
  into v_result;
  return v_result;
end;
$$;

create or replace function public.get_tutee_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  select jsonb_build_object(
    'tutee', jsonb_build_object(
      'user_id', r.user_id,
      'display_name', private.tutee_display_name(u.raw_user_meta_data, u.email),
      'email', coalesce(u.email, '')::text,
      'status', r.status::text,
      'created_at', r.created_at, 'requested_at', r.requested_at,
      'decided_at', r.decided_at, 'next_request_at', r.next_request_at,
      'request_count', r.request_count::integer,
      'pending_sessions', (select count(*)::integer from public.session_requests s
                           where s.user_id = r.user_id and s.status = 'pending'),
      'accepted_future_sessions', (select count(*)::integer from public.session_requests s
                           where s.user_id = r.user_id and s.status = 'accepted'
                             and s.starts_at > now()),
      'message', r.message::text),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at desc, s.id)
        from (select id, starts_at, ends_at, status, created_at, decided_at, cancelled_at
              from public.session_requests where user_id = r.user_id
              order by starts_at desc, id limit 20) s), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id desc)
        from (select id, action, from_status, to_status, sessions_ended, created_at
              from public.access_audit_log where user_id = r.user_id
              order by created_at desc, id desc limit 50) a), '[]'::jsonb),
    'history_starts_at', (select min(created_at) from public.access_audit_log
                          where user_id = r.user_id))
  into v_result
  from public.access_requests r join auth.users u on u.id = r.user_id
  where r.user_id = p_user_id;
  if v_result is null then raise no_data_found using message = 'access request not found'; end if;
  return v_result;
end;
$$;

create or replace function public.cancel_session_as_tutor(p_request_id uuid)
returns public.session_requests
language plpgsql volatile security definer set search_path = '' as $$
declare v public.session_requests;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  perform private.lock_schedule();
  select * into v from public.session_requests where id = p_request_id for update;
  if v.id is null then raise no_data_found using message = 'session request not found'; end if;
  if not (v.status = 'pending' or (v.status = 'accepted' and v.starts_at > now())) then
    raise exception using errcode = 'TR003', message = 'stale session state';
  end if;
  update public.session_requests set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = v.id returning * into v;
  return v;
end;
$$;

-- Inbox: only the three inbox statuses; revoked and blocked are managed on the Tutees page.
-- Exact column types, as in 20261125000100.
create or replace function public.list_access_requests(p_status text default null)
returns table(user_id uuid, display_name text, email text, message text, status text,
              requested_at timestamptz, decided_at timestamptz, next_request_at timestamptz,
              request_count integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  if p_status is not null and p_status not in ('pending','approved','denied') then
    raise exception using errcode = '22023', message = 'invalid status';
  end if;
  return query
    select r.user_id,
      left(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(coalesce(u.email,''),'@',1), '')), 100)::text,
      coalesce(u.email, '')::text, r.message::text, r.status::text, r.requested_at, r.decided_at, r.next_request_at, r.request_count::integer
    from public.access_requests r join auth.users u on u.id = r.user_id
    where r.status in ('pending','approved','denied') and (p_status is null or r.status = p_status)
    order by (r.status = 'pending') desc, r.requested_at desc limit 200;
end;
$$;

-- 5. Tutee-own functions ----------------------------------------------------------------
create or replace function public.request_access(p_message text)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_message text := btrim(coalesce(p_message, ''));
  v_row public.access_requests;
  v_now timestamptz := now();
begin
  if v_uid is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if public.is_admin() then raise insufficient_privilege using message = 'admins cannot request access'; end if;
  if char_length(v_message) > 500 then raise exception using errcode = '22023', message = 'message too long'; end if;
  if exists (select 1 from public.access_requests where user_id = v_uid and status = 'blocked') then
    raise exception using errcode = 'P0001', message = 'access request blocked';
  end if;
  -- Serialises requests so the pending cap cannot be overshot by concurrent inserts.
  perform pg_advisory_xact_lock(hashtext('access_requests_cap'));
  if (select count(*) from public.access_requests where status = 'pending') >= 50
     and not exists (select 1 from public.access_requests where user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'access requests are temporarily closed';
  end if;
  select * into v_row from public.access_requests where user_id = v_uid for update;
  if v_row.user_id is null then
    insert into public.access_requests(user_id, message) values (v_uid, v_message) returning * into v_row;
    perform private.audit_access(v_uid, 'requested', null, 'pending', 0);
  elsif v_row.status = 'blocked' then
    raise exception using errcode = 'P0001', message = 'access request blocked';
  elsif v_row.status in ('denied','revoked') then
    if v_row.next_request_at is not null and v_row.next_request_at > v_now then
      raise exception using errcode = 'P0001', message = 'access request cooldown active';
    end if;
    perform private.audit_access(v_uid, 're_requested', v_row.status, 'pending', 0);
    update public.access_requests set status = 'pending', message = v_message,
      requested_at = v_now, decided_at = null, next_request_at = null,
      request_count = request_count + 1
      where user_id = v_uid returning * into v_row;
  end if;
  -- pending and approved are idempotent and do not create an event.
  return v_row;
end;
$$;

-- A revoked tutee asking again is a new request event for the tutor, like a denied one.
create or replace function private.queue_access_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  if tg_op = 'INSERT' or (old.status in ('denied','revoked') and new.status = 'pending') then
    insert into public.access_request_notifications(user_id, requested_at)
      values (new.user_id, new.requested_at) returning id into v_event;
    perform private.dispatch_access_notification(v_event, new.user_id);
  end if;
  return new;
exception when others then
  raise warning 'access notification queue failed';
  return new;
end;
$$;

create or replace function public.get_my_access()
returns table(is_admin boolean, status text)
language sql stable security definer set search_path = '' as $$
  select public.is_admin(),
    (case when r.status in ('revoked','blocked') then 'denied' else r.status end)::text
  from (select 1) x
  left join public.access_requests r on r.user_id = (select auth.uid())
$$;

-- The caller's own request. Revoked and blocked look like denied; blocked has no retry date.
create or replace function public.get_my_access_request()
returns table(user_id uuid, status text, message text, created_at timestamptz,
              requested_at timestamptz, decided_at timestamptz, next_request_at timestamptz,
              request_count integer, can_ask_again boolean)
language sql stable security definer set search_path = '' as $$
  select r.user_id,
    (case when r.status in ('revoked','blocked') then 'denied' else r.status end)::text,
    r.message::text, r.created_at, r.requested_at, r.decided_at,
    (case when r.status = 'blocked' then null else r.next_request_at end)::timestamptz,
    r.request_count::integer,
    (r.status <> 'blocked')::boolean
  from public.access_requests r
  where r.user_id = (select auth.uid())
$$;

-- Own-session functions now require approval: a revoked or blocked tutee cannot list or
-- cancel sessions (kept accepted sessions stay tutor-visible only).
create or replace function public.list_my_session_requests(p_from timestamptz, p_to timestamptz)
returns setof public.session_requests
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_approved_tutee() or public.is_admin()) then
    raise insufficient_privilege using message = 'approved account required';
  end if;
  return query
    select * from public.session_requests
    where user_id = (select auth.uid()) and ends_at > p_from and starts_at < p_to
    order by starts_at;
end;
$$;

create or replace function public.cancel_session_request(p_request_id uuid)
returns public.session_requests
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.session_requests;
begin
  if not public.is_approved_tutee() then
    raise insufficient_privilege using message = 'approved account required';
  end if;
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

-- Same body as 20261125000400 plus the approval re-check once the schedule lock is held, so
-- a revoke that committed while this call waited for the lock wins.
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
  if not public.is_approved_tutee() then
    raise insufficient_privilege using message = 'approved account required';
  end if;
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

-- 6. Grants -----------------------------------------------------------------------------
-- create or replace keeps the ACL of existing functions (execute for authenticated only).
-- is_approved_tutee() and get_blocked_intervals() are unchanged: they require 'approved'.
revoke all on function private.tutee_display_name(jsonb, text) from public, anon, authenticated;
revoke all on function private.audit_access(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function private.apply_access_action(uuid, text, text) from public, anon, authenticated;
revoke all on function public.act_on_tutee(uuid, text, text) from public, anon;
revoke all on function public.list_tutees(text, text, integer, integer) from public, anon;
revoke all on function public.get_tutee_detail(uuid) from public, anon;
revoke all on function public.cancel_session_as_tutor(uuid) from public, anon;
revoke all on function public.get_my_access_request() from public, anon;
grant execute on function public.act_on_tutee(uuid, text, text) to authenticated;
grant execute on function public.list_tutees(text, text, integer, integer) to authenticated;
grant execute on function public.get_tutee_detail(uuid) to authenticated;
grant execute on function public.cancel_session_as_tutor(uuid) to authenticated;
grant execute on function public.get_my_access_request() to authenticated;
