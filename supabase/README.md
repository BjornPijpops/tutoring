# Supabase

Backend for the tutoring site (see [ADR 0001](../docs/adr/0001-backend-supabase-resend.md)): authentication (Google, Microsoft), Postgres with row-level security, and edge functions for tutor notifications.

## Status

Schema: `20261123000000_keepalive.sql` (keep-alive function) and `20261124000000_calendar.sql` (admins, `calendar_events`, `is_admin()`, the `is_approved_tutee()` stub and the `get_blocked_intervals` RPC; see [ADR 0004](../docs/adr/0004-availability-calendar.md) and [ADR 0005](../docs/adr/0005-admin-identity-and-calendar-access.md)). The migration is covered by `src/infrastructure/supabase/calendar-migration.test.ts`, which runs it in an in-process Postgres (PGlite) against a stub of Supabase auth.

`20261125000000_access_requests.sql` adds `access_requests`, the `access_request_notifications` outbox, the RPCs `request_access`, `decide_access_request`, `allow_access_request_again`, `get_my_access` and `list_access_requests`, the real `is_approved_tutee()`, and the notification trigger and retry job (see [ADR 0006](../docs/adr/0006-access-requests-and-approval.md) and [ADR 0007](../docs/adr/0007-access-request-email-notification.md)). It is covered by `src/infrastructure/supabase/access-requests-migration.test.ts` (PGlite). This migration is already applied to production.

The tutor is whoever is listed in `public.admins`. Seed it once, by hand, in the SQL Editor (see [external setup, Part 7](../docs/setup/external-setup.md)); never commit the address.

## Migrations

SQL migrations (including RLS policies) live in `migrations/`, named `<timestamp>_<description>.sql`, and are applied with the Supabase CLI, which is a dev dependency: `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npx supabase db push --remote` (the CLI defaults to a local Docker database otherwise).

## Secrets

Never commit secrets. The service-role key, Resend API key and the tutor's email address live only in Supabase secrets. The web app only ever receives the public project URL and anon key.

## Auth redirect URLs

Add these to the Supabase allowed redirect URLs (and to the Google and Microsoft Entra apps):

- `https://<GITHUB_USERNAME>.github.io/tutoring/` (the app sends `origin + base path` as `redirectTo`, so add `https://<GITHUB_USERNAME>.github.io/tutoring/**`)
- `http://localhost:5173/` (and `http://localhost:5173/**` for the dev base path `/tutoring/`)

## Keep-alive

Free-tier projects pause after a week without activity. `.github/workflows/supabase-keepalive.yml` calls the `public.keepalive()` database function (migration `20261123000000_keepalive.sql`) via `<SUPABASE_URL>/rest/v1/rpc/keepalive` twice a week. It needs two repository **secrets**, `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and does nothing (and succeeds) while they are unset. The migration must be applied first (Supabase CLI `npx supabase db push --remote`, or paste the SQL into the SQL Editor), otherwise the call returns 404.

Caveats:

- GitHub disables scheduled workflows after 60 days without repository activity.
- The anon key is rejected on the `/rest/v1/` root of newer projects, which is why a function is called instead.

## Edge Function: notify-access-request

`functions/notify-access-request/` e-mails the tutor when a request is made. The database calls it through pg_net with the header `x-webhook-secret`; `verify_jwt = false` in `config.toml` because the shared secret is the credential. `logic.ts` holds the testable code (`logic.test.ts`); `index.ts` is the Deno entry point.

Secrets (set by the owner, never committed): `RESEND_API_KEY`, `TUTOR_EMAIL` (the Resend account's own address), `WEBHOOK_SECRET`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.

Owner runbook, with placeholders:

1. `npx supabase secrets set RESEND_API_KEY=<key> TUTOR_EMAIL=<resend-account-email> WEBHOOK_SECRET=<random-hex>` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
2. `npx supabase functions deploy notify-access-request --use-api` (no Docker needed).
3. In the SQL Editor, store the same secret and the function URL in Vault:

   ```sql
   select vault.create_secret('<WEBHOOK_SECRET>', 'access_webhook_secret');
   select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/notify-access-request', 'access_webhook_url');
   ```

4. If a migration complains about extensions, enable pg_net and pg_cron under Database, Extensions.

Until step 3 is done the trigger quietly does nothing: requests still work, only the e-mail is missing. A cron job retries unsent events every 10 minutes (at most 5 attempts, within 24 hours).
