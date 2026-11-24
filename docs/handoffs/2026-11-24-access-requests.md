# 2026-11-24 Access requests and approval

## architect – PASS
- **Summary**: ADR 0006 (requests, approval, guard) and ADR 0007 (email) written.
  - **Schema**: `access_requests`, PK `user_id` → `auth.users` (cascade = deletion path); status pending/approved/denied; message ≤ 500; `decided_at` consistent with status; no name/email copy (read live from `auth.users`).
  - **Writes only via RPC**: `request_access(message)`, `decide_access_request(user, decision)`, and tutor-only `allow_access_request_again(user)`; no insert/update grants. Reads: RLS own-row or admin; tutor list via `list_access_requests` (joins `auth.users`); session bootstrap via `get_my_access()` (replaces `is_admin` call).
  - **State machine**: revoke = approved -> denied; denied -> approved by tutor; denied -> pending by user after an 8-hour server-enforced cooldown; tutor action "Allow to ask again now" clears it; no attempt cap; pending cap 50 (flood guard).
  - **`is_approved_tutee()`**: `create or replace` in new migration `20261125000000_access_requests.sql`; reusable for timeslot RLS; `get_blocked_intervals` untouched.
  - **Client**: `User.accessState: 'none'|'pending'|'approved'|'denied'`; ports renamed (`requestAccess`, `listRequests`, `decide(userId)`, `allowRequestAgain(userId)`); routes `/access`, `/availability` (`RequireAccess`: tutor or approved), `/access-requests` (tutor); `TUTEE_CALENDAR_ENABLED` removed; refetch on focus + "Check again"; 42501 from RPC → refresh state.
  - **Email**: one outbox row per initial request/re-request -> trigger -> `pg_net` -> Edge Function `notify-access-request` (`verify_jwt=false`, shared-secret header, constant recipient `TUTOR_EMAIL`, event/user ids only, no PII in logs, HTML-escaped, event-scoped Resend idempotency key); secret + URL in Vault; insert never blocked; `pg_cron` retry every 10 min (<= 5 attempts, 24 h).
- **Artifacts**: `docs/adr/0006-access-requests-and-approval.md`, `docs/adr/0007-access-request-email-notification.md`, status note in ADR 0005.
- **Constraints / risks for next agent**:
  - ui-ux-designer: request form with privacy notice and counter, status screens (pending/denied with retry date/access ended), tutor list with approve/deny/revoke and pending badge, no raw errors; "Check again" instead of polling.
  - Developer/tech-lead: never put real emails in repo (use `admin@example.test`); function code split into a pure module for Vitest and excluded from app tsc/ESLint; PGlite tests need stub `net`/`vault`/`cron`; verify CLI v3 flags; `config.toml` function entry; no raw SQL errors in UI.
  - QA via REST with anon key and non-admin user: cannot insert/update/select others, cannot call `decide`/`list`, status cannot be forged, revoked user loses RPC access immediately; function returns 401 without secret; email failure still saves request.
  - Risk: Resend shared sender only delivers to the Resend account email, so `TUTOR_EMAIL` must match it. Extensions may need enabling in the dashboard.
- **Owner actions** (nothing committed; in this order, at the verification gate):
  1. `npx supabase login` once (browser) if not already logged in.
  2. Confirm `npx supabase secrets list` shows `RESEND_API_KEY` and `TUTOR_EMAIL`, and that `TUTOR_EMAIL` is the same address as the Resend account.
  3. Generate a random value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, then `npx supabase secrets set WEBHOOK_SECRET=<that value>`.
  4. The migration is already applied to production; the owner deploys the function.
  5. In Supabase SQL Editor (same value, plus your project ref): `select vault.create_secret('<that value>', 'access_webhook_secret'); select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/notify-access-request', 'access_webhook_url');`
  6. If needed: Database -> Extensions -> enable `pg_net` and `pg_cron`.
  7. Smoke test with a second Google account: request → email arrives → approve → calendar visible → revoke → calendar gone.
- **Owner decisions applied**: denied users may re-request after 8 hours, with no attempt cap; the tutor can clear the cooldown with "Allow to ask again now"; every new request, including each re-request, creates its own notification outbox event and email attempt.

## ui-ux-designer – PASS
- **Summary**: Spec in `docs/design/access-requests.md`, deliberately simple (single column, tokens only, no new tokens) so it is easy to restyle.
  - **Tutee `/access`**: views for loading, none (form with read-only Google name/email, optional message with counter ≤ 500, privacy notice), pending (+ "Check again"), approved, denied with cooldown text "ask again after HH:MM" or a new form when allowed, access-ended, load/submit errors, requests-paused.
  - **Tutor `/access-requests`**: `FilterTabs` Pending / Approved / Declined with counts; `RequestCard` list; Approve/Deny immediate, Revoke via `ConfirmDialog`, "Allow to ask again now"; loading/error/empty/cap states; focus moves to the next card heading after an action.
  - **Nav and home by role** (`getNavItems` pure function), tutor link shows pending count; `/availability` confirmed titles-free (DOM test).
  - **New components**: `TextArea`, `CharacterCounter`, `StatusBadge`, `StatusAnnouncer`, `FilterTabs`, `EmptyState`, `DefinitionList`, plus `features/access` `AccessRequestForm`, `AccessStatusView`, `RequestCard`, `RequestList`, utils `formatCooldown`, `getAccessView`.
- **Artifacts**: `docs/design/access-requests.md`.
- **Constraints / risks for next agent**: no live cooldown ticking (static text, recalculated on focus/Check again); tutor needs `next_request_at` in the summary DTO to show cooldown and the allow-again button; the nav pending count needs a cheap count (derive from `listRequests`, or add a count to the DTO); revoked-while-open flow uses router state `accessEnded`; `/login` must redirect signed-in users and honour a return path to `/access`; remove the interim line "To book a time, ask the tutor directly" when timeslot requests ship.
- **Open questions**: none blocking (decided: approve/deny need no confirm; tutee is not emailed on decisions).

## tech-lead – PASS
- **Summary**: Produced the ordered BIG-change implementation plan with Given/When/Then criteria, exact target tree, core/port changes, pure helpers, SQL/RLS/outbox contract, Edge Function design, adapters/DI/routes, layered QA, reviewer security focus, owner-only deployment and smoke-test gate, Conventional Commit and local squash-merge plan.
- **Artifacts**: `docs/design/access-requests-plan.md`; appended this section only to the handoff.
- **Constraints / risks for next agent**: Branch verified as the access-requests feature branch from current `main`/`origin/main` tip `4564ed3`; no branch switch or commit. Keep all personal email addresses and secrets out of the repo. BIG change must stop after reviewer approval for owner local verification. Supabase Free supports the proposed low-volume path only after extension/function/Vault availability is verified; email remains best effort and request writes must never depend on delivery.
- **Open questions**: Owner must verify hosted `pg_net`, `pg_cron`, Vault interface and CLI v3 flags in the linked project; if cron is unavailable, use trigger plus manual retry until enabled. No other design blockers.


## developer – DONE (pending owner steps)
- **Summary**: Implemented the whole plan on feature/access-requests (not pushed or merged).
  - **DB**: `supabase/migrations/20261125000000_access_requests.sql` (tables, RLS, RPCs, real `is_approved_tutee()`, outbox trigger, cron retry), tested in PGlite.
  - **Core and adapters**: types, port, in-memory and Supabase repositories, `get_my_access` in the auth provider, DI wiring.
  - **UI**: `/access`, `/access-requests`, role-based nav and home, `RequireAccess`, shared components, redirects; axe tests added.
  - **Edge Function**: `supabase/functions/notify-access-request` (`logic.ts` plus tests, `index.ts`), `verify_jwt = false`. Not deployed.
- **Verification**: eslint, `prettier --end-of-line auto --check .`, `tsc -b`, vitest (40 files, 418 tests) and build all pass; `repository-wide private-identifier check` finds nothing.
- **Deviations**: no shared memory-vs-PGlite contract suite; `pg_advisory_xact_lock` in `request_access`; `create schema if not exists private`; `getIdentity()` added to the `AuthProvider` port (the form shows name and email); signed-out nav is Home only (Sign in is in the header controls); the redirect of an approved tutee from `/access` uses the server request, not the possibly stale session.
- **Owner actions (in order)**: see `docs/setup/external-setup.md` Part 8. The access-requests migration is already applied to production.
  1. Set `RESEND_API_KEY`, `TUTOR_EMAIL`, and `WEBHOOK_SECRET` in Supabase secrets.
  2. Deploy with `npx supabase functions deploy notify-access-request --use-api`.
  3. Run the Vault SQL for the webhook secret and function URL.
  4. Enable `pg_net` and `pg_cron` if the dashboard says they are off.
  5. Smoke test with a second Google account: request, e-mail arrives, approve, availability visible, revoke, gone.
- **Open risks**: e-mail is best effort and silent until the Vault secrets exist; `TUTOR_EMAIL` must equal the Resend account address.
## qa – PASS (with accepted risks)
- **Summary**: all gates green: `npm ci` (0 vulnerabilities), lint, `prettier --end-of-line auto --check .`, `tsc -b`, vitest (40 files, 423 tests after additions), build. the repository-wide check for private address fragments finds no matches; dist has no `service_role`, webhook, Resend URL, owner or other e-mail addresses.
  - **SQL/RLS (PASS)**: anon has no execute/table access; no client write grants or policies, outbox and `private` closed; RLS on both tables (remote confirmed); every definer function has `search_path=''`; tutor RPCs (`decide`, `allow_again`, `list`) refuse non-admins; users read only their own row; admins cannot request; status cannot be forged. Cooldown: blocked 1 s before, allowed at the exact boundary and via allow-now (existing PGlite tests); cap 50 still serves existing users; 500-char limit; approved/pending are idempotent with one outbox event per request; revoke removes `is_approved_tutee` and `get_blocked_intervals` access; trigger/HTTP/Vault failure never blocks the insert; retry only unsent, <5 attempts, <24 h.
  - **Concurrency (PASS by review, not executable)**: `pg_advisory_xact_lock` plus `for update` serialises double submit and the cap; PGlite is single connection so it cannot be run in a test.
  - **Edge Function (PASS)**: constant-time secret compare, empty secret refused, UUID and event/user binding, HTML escaping, CR/LF kept out of subject and first line, constant recipient, idempotency key per event, 502 on Resend or mark failure (retry), no PII/secrets in logs. Added 5 tests (`test: harden notify-access-request coverage`).
  - **UI/a11y/guards (PASS)**: existing component/page tests with axe cover form, pending, denied/cooldown, error retry, approve focus move, revoke dialog, text-only messages, empty state, live regions, `RequireAccess` and role redirects. Manual keyboard/320px/200% zoom pass was not run here.
  - **Remote read-only check**: migration objects ARE already deployed (2 tables with RLS, functions with correct grants, cron job `access-request-notification-retry` exists). Function `notify-access-request` is NOT deployed (functions list empty).
- **Defects**: none blocking. Low: (1) the migration was applied to production before QA/reviewer sign-off (process deviation; schema verified safe, UI not yet deployed). (2) Until the function and Vault secrets exist, requests save but no email is sent (documented, best effort). (3) Name is not length-capped in the Edge Function email (Auth metadata only, not user-controlled beyond Google profile). (4) `/availability` guard relies on server RPC denial for stale sessions; fine.
- **Accepted risks / pending owner gate**: deploy function and set secrets/Vault; second-account smoke test (request, email, approve, revoke); manual a11y pass.

## developer - rework

- Repaired the corrupted Supabase and external setup Markdown, including proper SQL fences and trailing newlines.
- Clarified that migration `20261125000000_access_requests.sql` is already applied to production; the owner only needs to set secrets, deploy the function, run the Vault SQL, and smoke-test.
- Verified `npx supabase functions deploy --help` exposes `--use-api`; local lint, typecheck, tests, build, and Prettier checks are run for this rework.

## reviewer – APPROVED
- **Summary**: After rework (docs repaired, deployment state clarified) the reviewer found RLS, grants, cooldown, revocation path and Edge Function auth/escaping sound; 423 tests, lint, typecheck and build pass. The only remaining finding (garbled arrows in README.md) was fixed afterwards.
- **Process note**: the migration was applied to production before QA/review (owner had pre-authorised migration pushes); the Edge Function is not deployed yet.
- **Gate**: BIG change; the owner must complete the setup steps and verify locally before merge.
