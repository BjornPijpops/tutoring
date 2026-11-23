# Supabase

Backend for the tutoring site (see [ADR 0001](../docs/adr/0001-backend-supabase-resend.md)): authentication (Google, Microsoft), Postgres with row-level security, and edge functions for tutor notifications.

## Status

Placeholder only. There is no schema yet; the first backend feature adds the Supabase client, the adapters in `src/infrastructure/supabase/` and the migrations.

## Migrations

SQL migrations (including RLS policies) live in `migrations/`, named `<timestamp>_<description>.sql`, and are applied with the Supabase CLI.

## Secrets

Never commit secrets. The service-role key, Resend API key and the tutor's email address live only in Supabase secrets. The web app only ever receives the public project URL and anon key.

## Auth redirect URLs

Add these to the Supabase allowed redirect URLs (and to the Google and Microsoft Entra apps):

- `https://bjornpijpops.github.io/tutoring/`
- `http://localhost:5173/`

## Keep-alive

Free-tier projects pause after a week without activity. `.github/workflows/supabase-keepalive.yml` sends a request to `<SUPABASE_URL>/rest/v1/` twice a week. It needs two repository **secrets**, `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and does nothing (and succeeds) while they are unset.

Caveats:

- GitHub disables scheduled workflows after 60 days without repository activity.
- Newer projects may reject the anon key on `/rest/v1/`. If the job fails with 401 or 404, change the request to a trivial table or RPC query (add a `keepalive` migration with the first backend work).
