-- The notify-access-request Edge Function reads requests and marks events as sent
-- using the service role, which has no default privileges on these tables.
grant select on table public.access_requests to service_role;
grant select, update on table public.access_request_notifications to service_role;
