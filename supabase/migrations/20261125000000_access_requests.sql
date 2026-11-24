-- Access requests and approval, plus the e-mail notification outbox.
-- See docs/adr/0006 (requests, approval) and docs/adr/0007 (e-mail notification).
-- Writes happen only through the security-definer functions below: clients get no
-- insert/update/delete grants. Every definer function pins search_path to ''.

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending'
    constraint access_requests_status check (status in ('pending','approved','denied')),
  message text not null default ''
    constraint access_requests_message_length check (char_length(message) <= 500),
  created_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  request_count integer not null default 1
    constraint access_requests_request_count check (request_count >= 1),
  next_request_at timestamptz,
  constraint access_requests_decision_consistency
    check ((status = 'pending') = (decided_at is null))
);
create index access_requests_status_requested_idx
  on public.access_requests (status, requested_at desc);

-- One row per request event (initial request or re-request). Holds ids only, never PII.
create table public.access_request_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.access_requests(user_id) on delete cascade,
  requested_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0
    constraint access_request_notifications_attempts check (attempts >= 0)
);
create index access_request_notifications_retry_idx
  on public.access_request_notifications (sent_at, attempts, created_at);

alter table public.access_requests enable row level security;
alter table public.access_request_notifications enable row level security;
revoke all on table public.access_requests from public, anon, authenticated;
revoke all on table public.access_request_notifications from public, anon, authenticated;
grant select on public.access_requests to authenticated;
create policy access_requests_select on public.access_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
-- There are deliberately no client insert/update/delete policies or grants, and no
-- policy at all on the outbox: it is only reachable by the definer functions and the
-- service role used by the Edge Function.

-- Replaces the stub from the calendar migration.
create or replace function public.is_approved_tutee() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_requests r
    where r.user_id = (select auth.uid()) and r.status = 'approved'
  )
$$;
revoke all on function public.is_approved_tutee() from public, anon;
grant execute on function public.is_approved_tutee() to authenticated;

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
  -- Serialises requests so the pending cap cannot be overshot by concurrent inserts.
  perform pg_advisory_xact_lock(hashtext('access_requests_cap'));
  if (select count(*) from public.access_requests where status = 'pending') >= 50
     and not exists (select 1 from public.access_requests where user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'access requests are temporarily closed';
  end if;
  select * into v_row from public.access_requests where user_id = v_uid for update;
  if v_row.user_id is null then
    insert into public.access_requests(user_id, message) values (v_uid, v_message) returning * into v_row;
  elsif v_row.status = 'denied' then
    if v_row.next_request_at is not null and v_row.next_request_at > v_now then
      raise exception using errcode = 'P0001', message = 'access request cooldown active';
    end if;
    update public.access_requests set status = 'pending', message = v_message,
      requested_at = v_now, decided_at = null, next_request_at = null,
      request_count = request_count + 1
      where user_id = v_uid returning * into v_row;
  else
    -- pending and approved are idempotent and do not create an event.
    return v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.decide_access_request(p_user_id uuid, p_decision text)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.access_requests; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  if p_decision not in ('approved','denied') then raise exception using errcode = '22023', message = 'invalid decision'; end if;
  select * into v_row from public.access_requests where user_id = p_user_id for update;
  if v_row.user_id is null then raise no_data_found using message = 'access request not found'; end if;
  if p_decision = 'approved' then
    update public.access_requests set status = 'approved', decided_at = now(), next_request_at = null
      where user_id = p_user_id returning * into v_row;
  else
    update public.access_requests set status = 'denied', decided_at = now(),
      next_request_at = now() + interval '8 hours'
      where user_id = p_user_id returning * into v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.allow_access_request_again(p_user_id uuid)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.access_requests; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  update public.access_requests set next_request_at = null
    where user_id = p_user_id and status = 'denied' returning * into v_row;
  if v_row.user_id is null then raise no_data_found using message = 'denied access request not found'; end if;
  return v_row;
end;
$$;

-- Session bootstrap: the role (admin) and the caller's own request status in one call.
create or replace function public.get_my_access()
returns table(is_admin boolean, status text)
language sql stable security definer set search_path = '' as $$
  select public.is_admin(), r.status from (select 1) x
  left join public.access_requests r on r.user_id = (select auth.uid())
$$;

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
      left(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(coalesce(u.email,''),'@',1), '')), 100),
      u.email, r.message, r.status, r.requested_at, r.decided_at, r.next_request_at, r.request_count
    from public.access_requests r join auth.users u on u.id = r.user_id
    where p_status is null or r.status = p_status
    order by (r.status = 'pending') desc, r.requested_at desc limit 200;
end;
$$;

revoke all on function public.request_access(text) from public, anon;
revoke all on function public.decide_access_request(uuid,text) from public, anon;
revoke all on function public.allow_access_request_again(uuid) from public, anon;
revoke all on function public.get_my_access() from public, anon;
revoke all on function public.list_access_requests(text) from public, anon;
grant execute on function public.request_access(text) to authenticated;
grant execute on function public.decide_access_request(uuid,text) to authenticated;
grant execute on function public.allow_access_request_again(uuid) to authenticated;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.list_access_requests(text) to authenticated;

-- Notification outbox. The secret and URL live in Vault (names below), never in this file.
-- Vault is read through the documented vault.decrypted_secrets view.
create or replace function private.dispatch_access_notification(p_event_id uuid, p_user_id uuid)
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
  update public.access_request_notifications set attempts = attempts + 1
    where id = p_event_id;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type','application/json', 'x-webhook-secret',v_secret),
    body := jsonb_build_object('event_id',p_event_id, 'user_id',p_user_id)
  ) into v_request_id;
exception when others then
  raise warning 'access notification dispatch failed';
end;
$$;

create or replace function private.queue_access_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  if tg_op = 'INSERT' or (old.status = 'denied' and new.status = 'pending') then
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

create trigger access_request_notification_trigger
  after insert or update of status on public.access_requests
  for each row execute function private.queue_access_notification();

-- Re-posts unsent events: at most 5 attempts, within 24 hours of the event.
create or replace function private.retry_access_notifications()
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  for v in select id, user_id from public.access_request_notifications
    where sent_at is null and attempts < 5
      and created_at > now() - interval '24 hours'
    order by created_at
  loop
    perform private.dispatch_access_notification(v.id, v.user_id);
  end loop;
exception when others then
  raise warning 'access notification retry failed';
end;
$$;

revoke all on function private.dispatch_access_notification(uuid,uuid) from public, anon, authenticated;
revoke all on function private.queue_access_notification() from public, anon, authenticated;
revoke all on function private.retry_access_notifications() from public, anon, authenticated;

-- cron.schedule upserts by job name, so re-running this migration stays repeatable.
select cron.schedule('access-request-notification-retry', '*/10 * * * *',
  $$select private.retry_access_notifications()$$);
