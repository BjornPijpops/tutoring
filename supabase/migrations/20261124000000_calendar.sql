-- Availability calendar: admin identity, calendar events and a privacy-preserving
-- blocked-interval RPC. See docs/adr/0004 and docs/adr/0005.

-- Who is the tutor. Seeded once by the owner in the SQL Editor; never through the API.
create table public.admins (
  email text primary key,
  constraint admins_email_lower check (email = lower(email))
);
alter table public.admins enable row level security;
revoke all on table public.admins from public, anon, authenticated;
-- Row level security is on and there are deliberately no policies: the table is
-- unreachable through the Data API and only read by is_admin() (security definer).

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null default '',
  source text not null check (source in ('manual', 'ics')),
  external_id text null,
  created_at timestamptz not null default now(),
  constraint calendar_events_order check (ends_at > starts_at),
  constraint calendar_events_max_length check (ends_at <= starts_at + interval '31 days'),
  constraint calendar_events_title_length check (char_length(title) <= 200),
  constraint calendar_events_source_external_unique unique (source, external_id)
);
create index calendar_events_time_idx on public.calendar_events (starts_at, ends_at);

-- Confirmed e-mail of the signed-in user must be listed in admins.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.calendar_events enable row level security;
revoke all on table public.calendar_events from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_events to authenticated;
create policy calendar_events_admin_all on public.calendar_events
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Stub: approved tutees do not exist yet. A later migration replaces it (create or replace).
create or replace function public.is_approved_tutee() returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
revoke all on function public.is_approved_tutee() from public, anon;
grant execute on function public.is_approved_tutee() to authenticated;

-- Merged busy intervals only: no titles, ids or counts reach the caller.
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
revoke all on function public.get_blocked_intervals(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_blocked_intervals(timestamptz, timestamptz) to authenticated;
