# Access requests implementation plan

**Status: BIG change — implementation plan for developer, QA and reviewer**  
**Branch gate:** verified without changing branches: current branch is `feature/access-requests`; `main`, `origin/main`, and `HEAD` resolve to `4564ed32ea8daedcb5f6c283afa704bd3209f56b`; `main` is an ancestor of `HEAD`. No commits are to be made directly on `main`. The local squash merge and deployment happen only after reviewer approval and the owner gate below.

This plan implements ADR 0006/0007 and `docs/design/access-requests.md`. It is deliberately ordered: database authorization first, then ports/adapters, then UI and wiring, then notification deployment. Do not edit an applied migration; add `supabase/migrations/20261125000000_access_requests.sql`.

## 1. Exact target tree

```text
src/
  app/
    layout.tsx                         # data-driven role/state nav and pending badge
    nav.ts                              # NavItem, getNavItems (pure)
    nav.test.ts
    routes.tsx                          # /access, /availability, /access-requests guards
  core/
    domain/
      access-request.ts                # expanded request, summary, decision/state types
      user.ts                           # AccessState and Session changes
    ports/
      access-request-repository.ts     # request/list/decide/allow-again contract
      auth-provider.ts                  # unchanged shape, Session carries accessState
  features/access/
    access-request-form.tsx(.module.css)
    access-status-view.tsx
    access-requests-page.tsx(.module.css)
    request-card.tsx(.module.css)
    request-list.tsx
    access-view.ts                     # getAccessView (pure)
    format-cooldown.ts                 # formatCooldown (pure)
    *.test.ts(x)
  features/auth/
    require-access.tsx                 # tutor or approved tutee UX guard
    auth-provider.tsx / session hooks  # refresh on focus/visibility as needed
  features/calendar/
    feature-flags.ts                   # deleted; remove TUTEE_CALENDAR_ENABLED
    availability-page.tsx              # tutee mode remains title-free
  infrastructure/
    memory/in-memory-access-request-repository.ts(.test.ts)
    supabase/access-request-repository.ts(.test.ts)
    supabase/auth-provider.ts(.test.ts) # get_my_access mapping
    container.ts(.test.ts)              # DI selection
  shared/ui/
    text-area.tsx, character-counter.tsx, status-badge.tsx,
    status-announcer.tsx, filter-tabs.tsx, empty-state.tsx,
    definition-list.tsx and tests
supabase/
  config.toml                           # notify function verify_jwt=false
  functions/notify-access-request/
    index.ts
    logic.ts                             # Deno-free pure handler helpers
    logic.test.ts                         # Vitest mocked fetch tests
    deno.json                            # function-local Deno config if required
  migrations/20261125000000_access_requests.sql
  README.md                              # owner deployment runbook and free-tier caveat
docs/design/access-requests-plan.md      # this file
```

The exact filenames may use the existing repository's naming convention, but no feature imports Supabase or infrastructure directly. `features → core/ports`; adapters implement ports; `app`/container is the composition root.

## 2. Ordered implementation tasks

### Task 1 — Core model and port contract

**Files:** `src/core/domain/user.ts`, `src/core/domain/access-request.ts`, `src/core/ports/access-request-repository.ts`, exports in `src/core/ports/index.ts`.

- Add `AccessState = AccessStatus | 'none'` and `User.accessState`; preserve `Role = 'tutor' | 'tutee'`.
- Expand `AccessRequest` with `message`, `requestedAt`, `decidedAt`, `nextRequestAt`, and `requestCount`; retain `id = userId` for the one-row-per-user model.
- Add tutor-only `AccessRequestSummary` (`displayName`, `email`, all decision/cooldown fields) and `AccessRequestFilter`.
- Rename `request()` to `requestAccess(message)`, retain `getMine()`, replace `listPending()` with `listRequests(status?)`, add `allowRequestAgain(userId)`, and keep `decide(userId, decision)`.
- Add typed conflict codes for `access_requests_closed`, `cooldown_active`, and state conflict; adapters must not expose raw SQL text.

**Given/When/Then acceptance criteria**
- **Given** a session DTO with no row, **when** it is mapped, **then** `accessState` is `none`.
- **Given** any `AccessRequest`, **when** TypeScript compiles in strict mode, **then** nullability of `decidedAt`/`nextRequestAt` is explicit and no email is present on the tutee domain entity.
- **Given** an implementation of the port, **when** it omits `allowRequestAgain` or uses `listPending`, **then** typecheck fails.

### Task 2 — Pure client helpers and reusable UI primitives

**Files:** `src/app/nav.ts`, `src/features/access/access-view.ts`, `src/features/access/format-cooldown.ts`, shared UI files from the tree.

- `getNavItems(user, pendingCount = 0)` is pure: signed-out Home/Sign in; tutee Home plus Request access/status/Availability by state; tutor Home/Calendar/Access requests and a non-negative pending badge with accessible count text.
- `getAccessView(request, now)` is pure and covers loading/none/pending/approved/denied; denied is ask-again only when `nextRequestAt === null || nextRequestAt <= now`.
- `formatCooldown(now, nextRequestAt)` returns `{ at, remaining } | null`, uses the shared Brussels/date formatting conventions, and says “in less than a minute” below one minute. It must not tick or use wall-clock globals.
- Build the specified `TextArea`, `CharacterCounter`, `StatusBadge`, `StatusAnnouncer`, `FilterTabs`, `EmptyState`, and `DefinitionList` with typed props, tokens only, visible labels, keyboard focus, and no unsafe HTML.

**Given/When/Then acceptance criteria**
- **Given** each role/state and pending count 0/3, **when** `getNavItems` runs, **then** exact destinations and accessible pending wording are returned.
- **Given** `nextRequestAt` exactly equals `now`, **when** `getAccessView` runs, **then** it returns the ask-again form, not a cooldown view.
- **Given** a message containing `<script>` or 501 characters, **when** rendered/validated, **then** it is text-only and rejected at submit with the counter/error.

### Task 3 — SQL migration and RLS (security-critical)

**File:** `supabase/migrations/20261125000000_access_requests.sql`; test in `src/infrastructure/supabase/access-requests-migration.test.ts`.

The developer must implement the following SQL (schema-qualified and with the exact privilege posture; harmless `drop policy/function` statements may be used only for objects introduced by this migration). The SQL is the contract, not pseudocode:

```sql
create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending'
    constraint access_requests_status check (status in ('pending','approved','denied')),
  message text not null default ''
    constraint access_requests_message_length check (char_length(message) <= 500),
  created_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  request_count integer not null default 1
    constraint access_requests_request_count check (request_count >= 1),
  next_request_at timestamptz,
  constraint access_requests_decision_consistency
    check ((status = 'pending') = (decided_at is null))
);
create index access_requests_status_requested_idx
  on public.access_requests (status, requested_at desc);

create table public.access_request_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.access_requests(user_id) on delete cascade,
  requested_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0
    constraint access_request_notifications_attempts check (attempts >= 0)
);
create index access_request_notifications_retry_idx
  on public.access_request_notifications (sent_at, attempts, created_at);

alter table public.access_requests enable row level security;
alter table public.access_request_notifications enable row level security;
revoke all on table public.access_requests from public, anon, authenticated;
revoke all on table public.access_request_notifications from public, anon, authenticated;
grant select on public.access_requests to authenticated;
create policy access_requests_select on public.access_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
-- There are deliberately no client insert/update/delete policies or grants.

create or replace function public.is_approved_tutee() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_requests r
    where r.user_id = (select auth.uid()) and r.status = 'approved'
  )
$$;
revoke all on function public.is_approved_tutee() from public, anon;
grant execute on function public.is_approved_tutee() to authenticated;

create or replace function public.request_access(p_message text)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_message text := btrim(coalesce(p_message, ''));
  v_row public.access_requests;
  v_now timestamptz := now();
begin
  if v_uid is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if public.is_admin() then raise insufficient_privilege using message = 'admins cannot request access'; end if;
  if char_length(v_message) > 500 then raise exception using errcode = '22023', message = 'message too long'; end if;
  if (select count(*) from public.access_requests where status = 'pending') >= 50
     and not exists (select 1 from public.access_requests where user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'access requests are temporarily closed';
  end if;
  select * into v_row from public.access_requests where user_id = v_uid for update;
  if v_row.user_id is null then
    insert into public.access_requests(user_id, message) values (v_uid, v_message) returning * into v_row;
  elsif v_row.status = 'denied' then
    if v_row.next_request_at is not null and v_row.next_request_at > v_now then
      raise exception using errcode = 'P0001', message = 'access request cooldown active';
    end if;
    update public.access_requests set status = 'pending', message = v_message,
      requested_at = v_now, decided_at = null, next_request_at = null,
      request_count = request_count + 1
      where user_id = v_uid returning * into v_row;
  else
    -- pending and approved are idempotent and do not create an event.
    return v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.decide_access_request(p_user_id uuid, p_decision text)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.access_requests; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  if p_decision not in ('approved','denied') then raise exception using errcode = '22023', message = 'invalid decision'; end if;
  select * into v_row from public.access_requests where user_id = p_user_id for update;
  if v_row.user_id is null then raise no_data_found using message = 'access request not found'; end if;
  if p_decision = 'approved' then
    update public.access_requests set status = 'approved', decided_at = now(), next_request_at = null
      where user_id = p_user_id returning * into v_row;
  else
    update public.access_requests set status = 'denied', decided_at = now(),
      next_request_at = now() + interval '8 hours'
      where user_id = p_user_id returning * into v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.allow_access_request_again(p_user_id uuid)
returns public.access_requests
language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.access_requests; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if not public.is_admin() then raise insufficient_privilege using message = 'admin required'; end if;
  update public.access_requests set next_request_at = null
    where user_id = p_user_id and status = 'denied' returning * into v_row;
  if v_row.user_id is null then raise no_data_found using message = 'denied access request not found'; end if;
  return v_row;
end;
$$;

create or replace function public.get_my_access()
returns table(is_admin boolean, status text)
language sql stable security definer set search_path = '' as $$
  select public.is_admin(), r.status from (select 1) x
  left join public.access_requests r on r.user_id = (select auth.uid())
$$;

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
      left(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(coalesce(u.email,''),'@',1), '')), 100),
      u.email, r.message, r.status, r.requested_at, r.decided_at, r.next_request_at, r.request_count
    from public.access_requests r join auth.users u on u.id = r.user_id
    where p_status is null or r.status = p_status
    order by (r.status = 'pending') desc, r.requested_at desc limit 200;
end;
$$;

revoke all on function public.request_access(text) from public, anon;
revoke all on function public.decide_access_request(uuid,text) from public, anon;
revoke all on function public.allow_access_request_again(uuid) from public, anon;
revoke all on function public.get_my_access() from public, anon;
revoke all on function public.list_access_requests(text) from public, anon;
grant execute on function public.request_access(text) to authenticated;
grant execute on function public.decide_access_request(uuid,text) to authenticated;
grant execute on function public.allow_access_request_again(uuid) to authenticated;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.list_access_requests(text) to authenticated;
```

The migration must then add the outbox trigger and retry functions below. The trigger must insert exactly one outbox row only when `TG_OP = 'INSERT'` or `OLD.status = 'denied' AND NEW.status = 'pending'`; it must never copy name/email/message into the outbox. Both trigger/retry routines are `private`, `security definer`, `set search_path = ''`, and revoke all API privileges. The trigger calls `private.dispatch_access_notification(event_id, user_id)` after inserting; that routine reads Vault names, calls `net.http_post(url := ..., headers := jsonb_build_object('content-type','application/json','x-webhook-secret',secret), body := jsonb_build_object('event_id',..., 'user_id',...)::jsonb)`, increments attempts, and catches all exceptions with a warning containing no row data so the request transaction cannot fail.


Use the existing `list_access_requests(null)` response as the pending-count source: the client counts rows whose status is `pending` (the server cap is 50, while the list hard limit is 200), so there is no second count query or authorization surface. If a separate count is later needed, it must be a tutor-only security-definer RPC, not a client count of an unbounded table.

The trigger/retry SQL is:

```sql
create or replace function private.dispatch_access_notification(p_event_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'access_webhook_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'access_webhook_url' limit 1;
  if v_url is null or v_secret is null then return; end if;
  update public.access_request_notifications set attempts = attempts + 1
    where id = p_event_id;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type','application/json', 'x-webhook-secret',v_secret),
    body := jsonb_build_object('event_id',p_event_id, 'user_id',p_user_id)
  ) into v_request_id;
exception when others then
  raise warning 'access notification dispatch failed';
end;
$$;

create or replace function private.queue_access_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  if tg_op = 'INSERT' or (old.status = 'denied' and new.status = 'pending') then
    insert into public.access_request_notifications(user_id, requested_at)
      values (new.user_id, new.requested_at) returning id into v_event;
    perform private.dispatch_access_notification(v_event, new.user_id);
  end if;
  return new;
exception when others then
  raise warning 'access notification queue failed';
  return new;
end;
$$;

create trigger access_request_notification_trigger
  after insert or update of status on public.access_requests
  for each row execute function private.queue_access_notification();

create or replace function private.retry_access_notifications()
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  for v in select id, user_id from public.access_request_notifications
    where sent_at is null and attempts < 5
      and created_at > now() - interval '24 hours'
    order by created_at
  loop
    perform private.dispatch_access_notification(v.id, v.user_id);
  end loop;
exception when others then
  raise warning 'access notification retry failed';
end;
$$;
revoke all on function private.dispatch_access_notification(uuid,uuid) from public, anon, authenticated;
revoke all on function private.queue_access_notification() from public, anon, authenticated;
revoke all on function private.retry_access_notifications() from public, anon, authenticated;
`private.retry_access_notifications()` selects unsent events with `attempts < 5` and `created_at > now() - interval '24 hours'`, dispatches each, and is scheduled as:

```sql
select cron.schedule('access-request-notification-retry', '*/10 * * * *',
  $$select private.retry_access_notifications()$$);
```

Use the Vault lookup compatible with the hosted extension (`vault.decrypted_secrets` by name) and document the exact SQL used in the migration/README. The trigger must not rely on an undocumented Vault API. Add a unique cron job name or unschedule/re-schedule only this named job for repeatable deployment.

**Given/When/Then acceptance criteria**
- **Given** anon or an authenticated non-owner, **when** they select another row, insert/update/delete a row, or call tutor RPCs, **then** PostgreSQL denies it.
- **Given** a signed-in user, **when** `request_access` is called twice while pending, **then** one row and one outbox event exist.
- **Given** a denied row, **when** request is called before eight hours, **then** it raises stable cooldown conflict; at/after the exact boundary it becomes pending and creates a new event.
- **Given** a tutor denies/revokes, **when** the row is read, **then** `next_request_at = now()+8 hours`; allow-again clears it only for denied rows.
- **Given** a revoked approved tutee, **when** `get_blocked_intervals` is called, **then** it raises `42501` immediately; approved users receive only merged intervals.
- **Given** a failing Vault/pg_net call, **when** a request is inserted, **then** the request and outbox row commit.

### Task 4 — PGlite SQL/RLS contract tests

Mirror `calendar-migration.test.ts`: stub `auth.users`, `auth.uid`, `admins`, `vault`, `net`, and `cron`; use fixed UUIDs and `admin@example.test` only. Test constraints, status consistency, one-row identity, pending cap 50, cooldown at boundary, all transitions, outbox event uniqueness, no PII in outbox, RLS/grants, `get_my_access`, admin list limit/order/display fallback, `is_approved_tutee`, and trigger failure isolation. Include REST-equivalent privilege checks for anon, tutee, and tutor. Do not use any owner email.

### Task 5 — Supabase and memory adapters

Implement `SupabaseAccessRequestRepository` using RPCs for all writes/listing and a scoped `select` for `getMine`; validate every response with zod and map Postgres codes to typed `PortError`. Update `SupabaseAuthProvider` to call `rpc('get_my_access')`, never trust metadata for role, and map `is_admin=true` to tutor plus `accessState`. Keep email out of `User`.

Update the in-memory adapter to model the same state machine, fixed injected clock, 8-hour cooldown, 50 pending cap, event count, admin-only actions, and deterministic summaries. Add a shared contract test suite run against memory and PGlite where practical.

**Given/When/Then acceptance criteria**
- **Given** malformed Supabase data or an unknown RPC code, **when** an adapter maps it, **then** it returns a typed unavailable/invalid result and no raw SQL text reaches UI.
- **Given** identical calls and a fixed clock, **when** memory and SQL adapters are tested, **then** status, cooldown, and event semantics agree.

### Task 6 — DI, auth refresh, routes and guards

Wire the Supabase access adapter when a client exists and memory otherwise; expose it through `Services`. Add `/access` (`RequireAuth`), `/availability` (`RequireAccess`), and `/access-requests` (`RequireRole('tutor')`). Remove `TUTEE_CALENDAR_ENABLED` and its TODO entirely. Redirect approved users/tutor away from `/access`; map revoked calendar `42501` to access-ended state. Refresh `get_my_access` on sign-in, focus/visibility and explicit Check again; no polling/realtime.

**Given/When/Then acceptance criteria**
- **Given** signed-out, none, pending, denied, approved, and tutor sessions, **when** each protected route is opened, **then** the exact design redirect/content occurs.
- **Given** a client-side forged approved state, **when** blocked intervals are requested, **then** server RLS still denies it.

### Task 7 — Tutee and tutor UI

Implement the design unchanged: form privacy notice, text-only untrusted content, 500-character counter, pending/check-again/cooldown/ask-again/error views; tutor filter counts, cards, approve/deny/revoke confirmation/allow-again, loading/error/empty/cap states, live announcements and focus transfer. Use existing tokens/components and no page-specific new tokens. Build title-free tutee availability and no event details.

Tests: Testing Library state/role/name assertions, form validation, no PII in URL, focus after card removal, dialog keyboard behavior, 320px/200% zoom checks where feasible, and `vitest-axe` for `/access`, `/access-requests`, nav and availability.

### Task 8 — Edge Function and notification tests

**Files:** `supabase/functions/notify-access-request/index.ts`, `logic.ts`, `logic.test.ts`, `supabase/config.toml`.

- Set `[functions.notify-access-request] verify_jwt = false`.
- Accept POST only; parse UUID `event_id` and `user_id`; compare `x-webhook-secret` to `WEBHOOK_SECRET` with a constant-time byte comparison (length mismatch still performs a fixed-length comparison); return 401 without reason detail.
- Service-role client reads only the event, request and Auth user; enforce event user match and return 2xx for missing/already-sent events (idempotent).
- Build constant recipient `TUTOR_EMAIL`, constant subject, escaped HTML plus plain text; never set `reply-to`; Resend `Idempotency-Key: access-request-${eventId}`; set `sent_at` only after a successful Resend response. Return 502 on provider failure.
- Log only event id and HTTP status; never PII, secret, Resend body or request message.
- Keep pure validation, constant-time comparison, escaping and email construction Deno-free so Vitest can mock global `fetch` without deploying Deno.

**Given/When/Then acceptance criteria**
- **Given** missing/wrong secret, method, malformed UUID, mismatched user, or arbitrary recipient input, **when** the handler runs, **then** it rejects safely and sends no email.
- **Given** HTML/script in name/email/message, **when** an email is built, **then** all HTML special characters are escaped and text content remains readable.
- **Given** duplicate event delivery after `sent_at`, **when** the handler runs, **then** it returns 2xx without a second Resend call.
- **Given** a mocked Resend 500/network error, **when** the handler runs, **then** it returns 502 and leaves the event unsent.

### Task 9 — CI, dependencies and docs

Add only dependencies actually required: no new app dependency is expected; use existing Vitest, Supabase CLI, zod and PGlite. If a function-local Deno import requires a type-only Deno config, keep it under `supabase/functions` and exclude it from app `tsc`/ESLint. Add a CI command that runs pure function Vitest tests; do not make Deno a prerequisite for the Vite app. Update `supabase/README.md` with owner-only deployment and extension checks.

### Task 10 — Verification gate, owner smoke test, merge and deploy

This is a BIG change. After developer implementation, QA and reviewer approval, **STOP for owner verification locally before any merge**. The owner performs the E2E smoke test with a second Google account; the agent does not use or record personal email addresses.

Owner-only steps (placeholders only):

```powershell
npx supabase login status
npx supabase secrets list
# owner sets these outside git:
npx supabase secrets set RESEND_API_KEY=<existing-secret> TUTOR_EMAIL=<owner-resend-account-email> WEBHOOK_SECRET=<random-32-byte-hex>
npx supabase functions deploy notify-access-request --use-api
npx supabase db push --remote
```

In Supabase SQL Editor, owner enters the same secret and project ref, never commits it:

```sql
select vault.create_secret('<WEBHOOK_SECRET>', 'access_webhook_secret');
select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/notify-access-request', 'access_webhook_url');
```

If `pg_net`, `pg_cron`, or Vault is unavailable, owner enables the extensions in Database → Extensions and reruns `npx supabase db push --remote`. Confirm the exact CLI flags against the installed CLI before execution. Smoke test: second Google account signs in → sends request → owner receives exactly one email → tutor approves → second account sees availability with no event titles → tutor revokes → next server call redirects/denies → owner allow-again/cooldown behavior is checked. Never paste real addresses into source, tests, screenshots, logs or this repository.

## 3. Free-tier feasibility and required adjustment

The architecture is feasible for this workload on Supabase Free **provided extensions are enabled and the project is awake**: pg_net asynchronous HTTP, pg_cron scheduling, Vault secrets, Edge Functions and the Resend free quota are available. Free-tier shared CPU/network, project auto-pause after inactivity, Edge Function quotas, and Resend's 100/day limit mean email is best-effort, not a request prerequisite. The migration therefore commits the request before dispatch, bounds retries to five/24 hours, keeps a visible tutor list, and uses Resend idempotency.

Required adjustment to ADR 0007 implementation: do not assume extension availability or a guaranteed ten-minute schedule on Free. The deployment checklist must verify `pg_net`, `pg_cron`, Vault and function invocation in the owner's project; if `pg_cron` is unavailable, retain the trigger path and use a manually/owner-run retry invocation until the project supports it. If hosted Vault exposes a different view/API, use the documented `vault.decrypted_secrets` interface and record the actual SQL in `supabase/README.md`; never store the secret in a table or migration. A paused project delays notification but does not lose the request. This is acceptable for the stated ~10-user, low-volume product and must be called out in the UI/help text as email-notification best effort.

## 4. QA test plan

1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and the PGlite migration suite.
2. Unit: state machine, cooldown exact boundary, pending cap, validators, DTO mapping, pure helpers, constant-time comparison, escaping and idempotency.
3. Component: every loading/error/empty/status/action state, accessible names, live regions, focus management, dialog cancel/Escape, no event titles in availability.
4. Axe: `/access`, `/access-requests`, nav, availability; keyboard-only and 320px/200% zoom pass.
5. SQL/RLS: anon/non-admin/tutor matrix; forged status/user/timestamps; cross-user reads; revoked access; transaction-failure notification; trigger only on initial/re-request; no PII outbox.
6. Manual integration: deploy function/migration in owner project, inspect one outbox event, one email, duplicate delivery, Resend failure/retry, and the second-account smoke sequence.
7. Verify no real owner email or secret appears in git diff, bundles, test fixtures, logs or docs.

## 5. Reviewer focus list

Security-heavy review is mandatory: RLS and grants/revokes; every security-definer `search_path = ''`; admin and approved-tutee privilege escalation; status/cooldown/pending-cap races; Auth identity joins; service-role scope; webhook constant-time authentication and UUID/user binding; outbox retry/idempotency; email recipient injection; HTML escaping and plain-text construction; PII in logs/outbox/URLs; denial/revocation taking effect server-side; secret/Vault handling; extension and free-tier failure behavior. Also verify the UI never treats client `accessState` as authorization and that the deployment owner gate is preserved.

## 6. Commit and merge plan

Use small Conventional Commits on `feature/access-requests`, for example:

1. `feat(core): model access state and request port`
2. `feat(db): add access request RLS and workflow RPCs`
3. `test(db): cover access request policies and state machine`
4. `feat(adapters): wire Supabase and memory access repositories`
5. `feat(access): add request and tutor approval flows`
6. `feat(notifications): add access request email function`
7. `test(access): add accessibility and notification coverage`
8. `docs(access): add deployment and owner verification runbook`

QA and reviewer must pass before owner verification. After owner records a pass, squash-merge locally into up-to-date `main` (no GitHub PR), push `main`, and verify CI/Pages deployment using the repository's required API/live URL checks. If deployment fails, create a new fix branch and repeat the pipeline; never repair directly on `main`.

