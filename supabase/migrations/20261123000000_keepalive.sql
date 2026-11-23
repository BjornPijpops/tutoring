-- Trivial database round trip used by .github/workflows/supabase-keepalive.yml.
-- Free-tier projects pause after a week without activity; calling this keeps the project awake.
create or replace function public.keepalive()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
