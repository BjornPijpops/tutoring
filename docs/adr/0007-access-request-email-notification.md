# 0007 – Emailing the tutor about new access requests (DB trigger → Edge Function → Resend)

**Status**: Accepted (2026-11-24). Implements the email path promised in ADR 0001; data model in ADR 0006.

## Context
The tutor must get an email per new access request. Constraints: Supabase Free, GitHub Pages client (no trusted server code), Resend free tier (100 emails/day) with the shared sender `onboarding@resend.dev` (delivers only to the Resend account owner's address, so **`TUTOR_EMAIL` must equal the Resend account email**), repo is public, saving the request must never depend on email delivery. Owner already set Supabase secrets `RESEND_API_KEY` and `TUTOR_EMAIL`. Emails go only to the tutor.

## Options
| Option | Verdict |
|---|---|
| Client calls the Edge Function after saving | Tab can close before the call; the anon-key holder could call it to spam the tutor. Rejected. |
| Dashboard "Database Webhook" | Created by hand in the UI (not in git); the secret header is typed into the UI. Same mechanism as below but unversioned. Rejected for reproducibility. |
| **Trigger in a migration → `pg_net` async HTTP → Edge Function**, secret and URL in **Vault** | Versioned, async (does not block or fail the insert), no secret in the repo. **Chosen.** |
| Polling job only (`pg_cron` → function) | Delay up to the interval; kept only as the **retry** path. |

## Decisions

### 1. Flow
1. `request_access` inserts the row or transitions a denied row to pending (ADR 0006) -> an `after insert or update` trigger creates one outbox row per new request event in `access_request_notifications`. It fires on insert and on every denied -> pending re-request, never on an unchanged pending/approved call.
2. Trigger function `private.notify_access_request()` (security definer, schema `private`, not exposed by the API) reads Vault and calls `net.http_post` with the outbox `event_id` and `user_id` (no PII) plus the shared-secret header. It increments that outbox row's `attempts`. Every event has its own delivery state, so a re-request is not suppressed by an earlier notification.
3. The Edge Function `notify-access-request` verifies the secret, loads the outbox event and current request with the service role, sends the email via Resend, and sets that event's `sent_at = now()`.
4. **Failure handling**: the trigger function wraps the call in `exception when others then raise warning 'access notification not queued'` (no row data), and does nothing if Vault entries are missing. The insert therefore **always commits**. A `pg_cron` job (every 10 minutes) calls `private.retry_access_notifications()`, which re-posts unsent outbox events with `attempts < 5 and created_at > now() - interval '24 hours'`. After 5 attempts it gives up; the request is still in the tutor's list in the app, and the dashboard shows unsent events. The function returns 2xx for "already sent / not found" (idempotent), 401 for a bad secret, 502 when Resend fails (retry picks it up). A sent event is never sent again, while a later re-request has a different event id.
5. Duplicate protection: Resend `Idempotency-Key: access-request-<event_id>` makes a retry after a lost response harmless without collapsing distinct re-request events.

### 2. Edge Function (`supabase/functions/notify-access-request/index.ts`, Deno)
- `config.toml`: `[functions.notify-access-request] verify_jwt = false` – the caller is Postgres, not a user; authentication is the shared secret instead.
- Auth: `POST` only; header `x-webhook-secret` compared to env `WEBHOOK_SECRET` with a **constant-time** comparison; missing/invalid → 401 without detail. Input validated (`event_id` and `user_id` must be UUIDs).
- Reads: `access_request_notifications` event and its `access_requests` row via the service-role client (env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase – never in the repo), and name/email via `auth.admin.getUserById`.
- Email: `POST https://api.resend.com/emails`, `Authorization: Bearer ${RESEND_API_KEY}`; `from: "Tutoring <onboarding@resend.dev>"`, `to: [TUTOR_EMAIL]` (never any other recipient, never user-controlled), **constant subject** ("New access request"), plain-text body plus an HTML body where name, email and message are **HTML-escaped**; includes the link `https://bjornpijpops.github.io/tutoring/#/access-requests`. A `reply-to` of the requester is **not** set (the tutor contacts people outside the app on purpose; avoids relaying arbitrary mail).
- Logging: only the request id and HTTP status codes (`access-request notify failed id=… status=…`). Never name, email, message, secrets or the Resend response body.
- Pure logic (secret comparison, email building/escaping, input validation) lives in a separate module without Deno globals so Vitest can test it; the Deno entry file is a thin shell. `supabase/functions/**` is excluded from the app's `tsc`/ESLint/Vite config (own Deno types) and checked in CI with the existing steps only.

### 3. Secrets – where they live
| Name | Where | Value |
|---|---|---|
| `RESEND_API_KEY`, `TUTOR_EMAIL` | Supabase function secrets (already set) | owner's |
| `WEBHOOK_SECRET` | Supabase function secrets | random 32-byte hex, generated by owner |
| `access_webhook_secret` | Supabase **Vault** (same random value) | identical to `WEBHOOK_SECRET` |
| `access_webhook_url` | Supabase **Vault** | `https://<project-ref>.supabase.co/functions/v1/notify-access-request` |
Nothing is committed; migrations only reference the Vault *names*. The anon key can neither read Vault nor call `private.*`. Rotating the shared secret = repeat the two `set` steps.

### 4. Deployment
- Functions are **not** deployed by GitHub Actions or `db push`; the developer runs from the repo (CLI already linked to the project):
  `npx supabase functions deploy notify-access-request --use-api`
  `--use-api` bundles and uploads through the Management API, so **Docker is not needed** (the default path needs Docker Desktop). `verify_jwt` is read from `config.toml`.
- Extra needs vs. `db push`: the CLI must be **logged in with an access token** (`npx supabase login`, or the `SUPABASE_ACCESS_TOKEN` environment variable) – `db push` only needed the database password. The linked project is already known (`supabase/.temp`, not committed). Tech-lead verifies the exact CLI v3 flags (`--remote` may be required like for `db push`) and records them in `supabase/README.md`.
- Extensions: the migration runs `create extension if not exists pg_net` and `pg_cron` (and uses the built-in Vault). If the hosted project refuses it, the owner enables **Database → Extensions → pg_net, pg_cron** in the dashboard and re-runs `db push`.
- **Order**: (1) set `WEBHOOK_SECRET`, (2) deploy the function, (3) `db push` the migration, (4) create the two Vault secrets, (5) smoke test. Between (3) and (4) requests are saved and the retry job delivers the email once Vault is filled (within 24 h window).
- Local/test: PGlite tests stub `net`, `vault` and `cron` schemas to test trigger conditions and the "never blocks the insert" rule; the Edge Function is unit-tested via its pure module; the full path is verified once manually (owner gate).

### 5. Limits and privacy
- Resend free: 100/day, 3000/month; volume is bounded by ADR 0006 §4. Failures at the limit degrade to "no email, still in the list".
- The notification contains the requester's name, email and message → Resend is a processor (disclosed in the form notice, ADR 0006 §5). Shared sender means mail may look like onboarding/test mail; tutor should add it to contacts/safe senders.
- Email is **not** sent for approve/deny (tutees are never emailed, ADR 0001); the tutee sees the result in the app.

## Consequences
- Request creation is independent from email; every request event gets its own at-least-once notification with idempotency and bounded retries.
- No secrets in the repo or the browser; the only network-reachable endpoint is the function, protected by a shared secret and constant recipient.
- Added moving parts: `pg_net`, `pg_cron`, Vault, one Deno function, and a manual deploy step. The function is small; the retry job can be dropped later if deemed unnecessary.
- Switching email provider only touches the Edge Function.
