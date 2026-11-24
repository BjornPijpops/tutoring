# Supabase

Backend for the tutoring site (see [ADR 0001](../docs/adr/0001-backend-supabase-resend.md)): authentication (Google, Microsoft), Postgres with row-level security, and edge functions for tutor notifications.

## Status

Placeholder only. There is no schema yet; the first backend feature adds the Supabase client, the adapters in `src/infrastructure/supabase/` and the migrations.

## Migrations

SQL migrations (including RLS policies) live in `migrations/`, named `<timestamp>_<description>.sql`, and are applied with the Supabase CLI, which is a dev dependency: `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npx supabase db push --remote` (the CLI defaults to a local Docker database otherwise).

## Secrets

Never commit secrets. The service-role key, Resend API key and the tutor's email address live only in Supabase secrets. The web app only ever receives the public project URL and anon key.

## Auth redirect URLs

Add these to the Supabase allowed redirect URLs (and to the Google and Microsoft Entra apps):

- `https://bjornpijpops.github.io/tutoring/`
- `http://localhost:5173/`

## Keep-alive

Free-tier projects pause after a week without activity. `.github/workflows/supabase-keepalive.yml` calls the `public.keepalive()` database function (migration `20261123000000_keepalive.sql`) via `<SUPABASE_URL>/rest/v1/rpc/keepalive` twice a week. It needs two repository **secrets**, `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and does nothing (and succeeds) while they are unset. The migration must be applied first (Supabase CLI `npx supabase db push --remote`, or paste the SQL into the SQL Editor), otherwise the call returns 404.

Caveats:

- GitHub disables scheduled workflows after 60 days without repository activity.
- The anon key is rejected on the `/rest/v1/` root of newer projects, which is why a function is called instead.
