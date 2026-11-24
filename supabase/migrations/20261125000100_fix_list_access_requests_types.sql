-- auth.users.email is varchar(255); RETURN QUERY requires the exact declared type (text),
-- so the previous version failed at runtime even for an empty result.
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
    where p_status is null or r.status = p_status
    order by (r.status = 'pending') desc, r.requested_at desc limit 200;
end;
$$;
