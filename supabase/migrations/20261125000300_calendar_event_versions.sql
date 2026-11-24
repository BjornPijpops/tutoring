-- Adds optimistic concurrency for tutor event edits. Apply only after review.
alter table public.calendar_events add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_calendar_event_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calendar_events_updated_at on public.calendar_events;
create trigger calendar_events_updated_at
before update on public.calendar_events
for each row execute function public.touch_calendar_event_updated_at();
