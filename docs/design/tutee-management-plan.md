# Tutee management implementation plan

**Status:** Tech Lead plan, documentation only. Do not apply migrations or write code in this phase.

Turns ADR 0012, `docs/design/tutee-management.md` (UI spec) and the existing access-request and session-request code into small, ordered developer tasks. Work stays on `feature/tutee-management` (verified as the current branch; record the base commit in the handoff and confirm it is based on up-to-date `main`). No commits to `main`; the work ends as a PR, squash-merged after reviewer approval.

## Decisions made by the Tech Lead (clarifying ADR 0012, none contradict it)

1. **Migration file:** `supabase/migrations/20261126000000_tutee_management.sql`. It sorts after `20261125000400_timeslot_requests.sql`, which has been edited in place and may not be applied yet. The developer must not edit any existing migration, and the owner must apply the migrations in order.
2. **Lock order everywhere:** `private.lock_schedule()` first, then the `access_requests` row `for update`. ADR 0012 listed the row first; the order is changed so that `create_session_request` (which takes only the schedule lock) can re-check approval after it holds the lock. Nothing may take the row lock and then the schedule lock. `request_access` and `allow_access_request_again` take only the row lock.
3. **Read RPCs return `jsonb`, not `returns table`.** `list_tutees` and `get_tutee_detail` return a `jsonb` document and are validated by zod in the adapter. This removes the `RETURN QUERY` type-mismatch class entirely (see the type rules in step 1). Only functions that must keep an existing `returns table` shape use `RETURN QUERY`.
4. **Search uses `strpos(lower(haystack), lower(needle)) > 0`, not `LIKE`.** `%`, `_` and `\` are then literal with no escaping to get wrong. The search string is trimmed and at most 100 characters, otherwise `22023`. ADR intent (case-insensitive substring on name and email, wildcard-safe) is unchanged.
5. **Tutee-facing projection moves to the server.** Today the tutee reads its own row straight from the table (RLS, `getMine`). That would leak `revoked`/`blocked`. Revoke the table `select` grant (and drop the policy) from `authenticated`, and add `public.get_my_access_request()` that projects `revoked`/`blocked` to `denied` and adds `can_ask_again boolean` (false only for `blocked`). `get_my_access` is redefined with the same projection. The client `AccessState` does not change; `AccessRequest` gains `canAskAgain: boolean` and `AccessView` gains `'denied-blocked'` (same "Not approved at this time" copy, no date, no form).
6. **Future session = `starts_at > now()`.** Used for `cancel_all`, the `accepted_future_sessions` count and `cancel_session_as_tutor` (a session that has started is "past" for management).
7. **Counts in the list** are per status for the current search, ignoring the status filter, so the chips stay stable while filtering.
8. **`/access-requests` and `/session-requests` stay** as pending inboxes (see step 10). Revoke leaves the inbox because it now needs the session-policy dialog.
9. **Stable codes:** reuse SQLSTATE `TR003` (stale state) for rejected no-op or invalid transitions. Blocked re-request raises `P0001` message `access request blocked`, mapped to the new `ConflictCode` `access_blocked`. Adapter maps `TR003` to `state_conflict` (`mapAccessError` currently lacks it).

## Ordered implementation steps

Each step ends green (`typecheck`, `lint`, focused tests) before the next starts. Steps 1-3 are the backend contract; 4-5 are pure/memory; 6-9 are UI.

### 1. Migration `20261126000000_tutee_management.sql`

Header comment: purpose, ADR 0012, new SQLSTATE usage. Every function: `security definer`, `set search_path = ''`, schema-qualified, `revoke all ... from public, anon`, `grant execute ... to authenticated`, `auth.uid()` null -> `42501 authentication required`, non-admin -> `42501 admin required` (tutor-only RPCs). Redefined functions use `create or replace` with an **identical signature and return type** (a changed return type needs a drop, which also drops grants).

**1a. Status model**
- Replace the check: `alter table public.access_requests drop constraint access_requests_status; add constraint access_requests_status check (status in ('pending','approved','denied','revoked','blocked'))`. `access_requests_decision_consistency` stays valid: only `pending` has null `decided_at`, so every transition into `blocked` or `revoked` must set `decided_at = now()`.
- `revoke select on public.access_requests from authenticated; drop policy access_requests_select`. `service_role` keeps its select (migration `...000200`); add no new service-role grants for the audit table because the Edge Function never reads it.
- Index for the list: `access_requests (status, requested_at desc)` already exists. No new index is needed at this scale.

**1b. `public.access_audit_log`** (append-only)

| column | type |
|---|---|
| `id` | `bigint generated always as identity primary key` |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` |
| `actor_id` | `uuid` (no foreign key, so deleting the tutor keeps history) |
| `action` | `text not null` check in (`requested`,`re_requested`,`approved`,`denied`,`revoked`,`restored`,`blocked`,`unblocked`,`cooldown_reset`) |
| `from_status`, `to_status` | `text` null, check `is null or in` the five statuses |
| `sessions_ended` | `integer not null default 0`, check `>= 0` |
| `created_at` | `timestamptz not null default now()` |

Index `(user_id, created_at desc)`. `enable row level security; revoke all ... from public, anon, authenticated`; no policies, no grants. No name, email, message or free text. Not backfilled.

**1c. Private helpers** (`revoke all ... from public, anon, authenticated`)
- `private.tutee_display_name(p_meta jsonb, p_email text) returns text`: same expression as `list_access_requests` (`left(btrim(coalesce(meta->>'full_name', meta->>'name', split_part(coalesce(email,''),'@',1), '')), 100)::text`), so list, detail and inbox agree.
- `private.audit_access(p_user uuid, p_action text, p_from text, p_to text, p_ended integer)` inserts one row with `actor_id = auth.uid()`.
- `private.apply_access_action(p_user_id uuid, p_action text, p_policy text) returns jsonb`: the **single state machine**. Steps: validate `p_action in ('approve','deny','revoke','restore','block','unblock')` and `p_policy in ('keep','cancel_all')` (`22023`); `cancel_all` with any action other than `revoke`/`block` is `22023`; reject `p_user_id = auth.uid()` (`22023`); `perform private.lock_schedule()` (always, even for `keep`, because revoke/block decline pending sessions and the create-vs-revoke race needs the schedule lock); `select ... for update` the row (`P0002 no_data_found` if missing); apply the table below; on a not-allowed `from` status raise `TR003 'stale access state'` and change nothing; write the audit row in the same transaction; return `jsonb_build_object('status', new_status, 'pending_declined', n1, 'accepted_cancelled', n2)`.

| action | allowed from | result | `decided_at` | `next_request_at` | audit action |
|---|---|---|---|---|---|
| approve | pending, denied | approved | now() | null | approved |
| deny | pending | denied | now() | now() + 8 h | denied |
| revoke | approved | revoked | now() | now() + 8 h | revoked |
| restore | revoked | approved | now() | null | restored |
| block | pending, approved, denied, revoked | blocked | now() | null | blocked |
| unblock | blocked | denied | now() | null | unblocked |

  Same -> same, and `approve` on revoked/blocked or `deny` on approved/blocked etc., are all `TR003`; they never touch `decided_at` or the cooldown (this fixes the idempotent-decision defect). For `revoke`/`block`: `update public.session_requests set status='declined', decided_at=now(), updated_at=now() where user_id=p_user_id and status='pending'` (count via `get diagnostics`), and when the policy is `cancel_all`, `status='cancelled', cancelled_at=now(), updated_at=now() where user_id=p_user_id and status='accepted' and starts_at > now()`. `sessions_ended` = both counts. Past and other rows are never touched; approve/restore never resurrect sessions.

**1d. Public tutor RPCs**
- `act_on_tutee(p_user_id uuid, p_action text, p_session_policy text default 'keep') returns jsonb`: admin check, then `private.apply_access_action`.
- `decide_access_request(p_user_id uuid, p_decision text) returns public.access_requests` (unchanged signature and return type): admin check, then maps `approved` to `restore` if the row is `revoked`, otherwise `approve`; `denied` to `revoke` if `approved`, otherwise `deny`; returns the updated row. Existing inbox behaviour is preserved except no-ops are now `TR003`. Because the returned row may be `revoked`, the client mapper must tolerate it (step 3).
- `allow_access_request_again(p_user_id uuid) returns public.access_requests` (unchanged): extend `where status = 'denied'` to `in ('denied','revoked')`; take the row lock; when `next_request_at` is already null return `TR003` (nothing to reset) instead of rewriting; audit `cooldown_reset` (from = to = status, sessions 0); `blocked` is rejected (`P0002` as today for non-matching rows).
- `list_tutees(p_status text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb` (`stable`): validates status in the five values, search <= 100 chars after trim (empty -> no filter), `p_limit` clamped to 1..100, `p_offset >= 0` (`22023`). Returns `{"items":[...], "total":<int>, "counts":{"pending":n,...,"all":n}}`. Item keys: `user_id, display_name, email, status, created_at, requested_at, decided_at, next_request_at, request_count, pending_sessions, accepted_future_sessions`. Order: `(status='pending') desc, requested_at desc, user_id` (stable paging). Search matches name **or** email with `strpos`. `jsonb_agg` of an empty set is null, so wrap with `coalesce(..., '[]'::jsonb)`.
- `get_tutee_detail(p_user_id uuid) returns jsonb` (`stable`): `{"tutee":{...item keys plus "message"}, "sessions":[latest 20 by starts_at desc: id, starts_at, ends_at, status, created_at, decided_at, cancelled_at], "events":[latest 50 audit rows: id, action, from_status, to_status, sessions_ended, created_at], "history_starts_at": <min audit created_at or null>}`. Unknown user -> `P0002`. No actor id in `events`.
- `cancel_session_as_tutor(p_request_id uuid) returns public.session_requests`: admin; `lock_schedule()`; `select ... for update`; allowed when `status='pending'`, or `status='accepted' and starts_at > now()`; otherwise `TR003`; set `cancelled`, `cancelled_at`, `updated_at`. No audit row (the enum is about access) and no email.

**1e. Tutee-own functions**
- `request_access(text)` (same signature and return type): add `blocked` -> `P0001 'access request blocked'` (raised before the cap check); `revoked` follows the `denied` cooldown path; audit `requested` on first insert and `re_requested` on denied/revoked -> pending (actor = caller). Keep the 500-char, admin and 50-pending-cap rules and the cap advisory lock.
- `private.queue_access_notification()`: change the condition to `old.status in ('denied','revoked') and new.status = 'pending'`; keep the `exception when others` guard. `create or replace` preserves the trigger and ACL.
- `get_my_access()` (same `returns table(is_admin boolean, status text)`): `case when r.status in ('revoked','blocked') then 'denied' else r.status end`; both branches `text`, so no cast problem.
- New `get_my_access_request() returns table(user_id uuid, status text, message text, created_at timestamptz, requested_at timestamptz, decided_at timestamptz, next_request_at timestamptz, request_count integer, can_ask_again boolean)` (`language plpgsql stable`; zero rows when the caller has no row). Projects `revoked`/`blocked` to `denied`; for `blocked`, `next_request_at` is null and `can_ask_again` false.
- `list_my_session_requests(timestamptz, timestamptz)`: convert from `language sql` to `plpgsql` with the **same** `returns setof public.session_requests`; raise `42501 approved account required` unless `public.is_approved_tutee() or public.is_admin()` (admin keeps today's empty result; grep callers for tutor use before deciding).
- `cancel_session_request(uuid)`: add `if not public.is_approved_tutee() then raise 42501`. The existing update-or-42501 body stays.
- `create_session_request`: keep the pre-lock approval check as a fast fail, and **re-check `is_approved_tutee()` immediately after `private.lock_schedule()`** so a revoke that committed while it waited wins.
- `list_access_requests(text)` (inbox): re-create with the **exact** column types of `20261125000100` and add `where r.status in ('pending','approved','denied')`; the `p_status` validation stays three-valued. Revoked and blocked rows must not reach the inbox adapter, whose zod enum would otherwise reject the whole list.
- `is_approved_tutee()` and `get_blocked_intervals` are **not** redefined: they already require `status = 'approved'`, so revoked/blocked tutees are excluded automatically. Add tests that prove it.

**1f. Exact types (RETURN QUERY lesson from `...000100`).** `auth.users.email` is `varchar(255)`; `raw_user_meta_data->>'x'` and `btrim`/`left` are text but are cast anyway. Every expression in a `returns table` or `RETURN QUERY` gets an explicit cast to the declared type: `::text` for email, names, status, message; `::integer` for `count(*)` (bigint) and `request_count`; `::boolean`; timestamps are already `timestamptz`; ids `uuid`. `jsonb_build_object` needs no declared types, but `count(*)::integer` is still used so JSON numbers stay small ints. Apply the same discipline in `get_my_access_request`. The test for each function must run it against a **non-empty** table (the previous bug appeared at runtime even for empty results because the type check happens at execution).

**1g. Grants.** After creating functions: `revoke all on function ... from public, anon; grant execute on function ... to authenticated` for `act_on_tutee, list_tutees, get_tutee_detail, cancel_session_as_tutor, get_my_access_request`; `revoke all` on the new `private.*` functions. Table `access_audit_log`: `revoke all` as above. Because earlier bugs came from missing `service_role` grants: the Edge Function (`notify-access-request`) still only reads `access_requests` (`select=message`) and the two outboxes, all already granted; add a test/assertion that these grants still exist after this migration and that `service_role` has **no** access to `access_audit_log`. If the developer adds any new table the Edge Function reads, add its `service_role` grant in the same migration.

**1h. Cascade on user deletion.** `delete from auth.users` must remove `access_requests` (existing), `access_request_notifications` (existing), `session_requests` and its outbox (existing) and now `access_audit_log` (`on delete cascade`). The tutor's `actor_id` has no FK, so deleting the tutor account never deletes history. Update the GDPR note in `docs/` (ADR 0006 section 5 reference) to say the audit trail is deleted with the user.

**DST rule (tutee-management scope).** This feature introduces no new Brussels wall-clock logic: "future" is an exact-instant comparison (`starts_at > now()`) and the 8-hour cooldown is `now() + interval '8 hours'` (absolute elapsed time, not local time). Do not use `at time zone` in any new function. Display formatting stays in the existing `formatMoment`/Brussels helpers. Test the cooldown across a DST change by freezing the clock around 2027-03-28 and asserting the elapsed `next_request_at - decided_at` is exactly 8 hours.

**Acceptance (Given/When/Then).** Given a fresh database with all migrations, when the new migration is applied, then the five statuses are accepted, the audit table exists with no client grants, and every listed function exists with the stated signature; given a revoked tutee, when they call `create_session_request`, `list_my_session_requests` or `cancel_session_request`, then each raises `42501`.

### 2. Domain and port contract

Files: `src/core/domain/tutee.ts`, `src/core/domain/tutee-transitions.ts` (+ test), `src/core/ports/tutee-repository.ts`, `src/core/ports/index.ts`, `src/core/ports/port-error.ts`, `src/core/domain/access-request.ts`, `src/core/domain/user.ts` (unchanged, `AccessStatus` stays three-valued).

- `tutee.ts`: `TuteeStatus = 'pending'|'approved'|'denied'|'revoked'|'blocked'` (distinct from `AccessStatus`); `TuteeSummary` (userId, displayName, email, status, createdAt, requestedAt, decidedAt, nextRequestAt, requestCount, pendingSessions, acceptedFutureSessions); `TuteeListQuery {status?, search?, limit?, offset?}`; `TuteeList {items, total, counts: Record<TuteeStatus | 'all', number>}`; `TuteeDetail {tutee: TuteeSummary & {message}, sessions: readonly TuteeSession[], events: readonly TuteeEvent[], historyStartsAt: IsoDateTime | null}`; `TuteeEvent {id, action, fromStatus, toStatus, sessionsEnded, createdAt}` (no identity fields); `TuteeAction = 'approve'|'deny'|'revoke'|'restore'|'block'|'unblock'`; `SessionPolicy = 'keep'|'cancel_all'`; `TuteeActionResult {status: TuteeStatus, pendingDeclined: number, acceptedCancelled: number}`. Constants: `TUTEE_SEARCH_MAX = 100`, `TUTEE_PAGE_DEFAULT = 50`, `TUTEE_PAGE_MAX = 100`.
- `tutee-transitions.ts`: pure `nextAccessState(current, action, now) -> Result<{status, decidedAt, nextRequestAt, auditAction}, 'stale'>` implementing the table in step 1c, plus `allowedActions(status, cooldownCleared)` (feeds the UI action list) and `projectForTutee(status)` (revoked/blocked -> denied). This is the executable spec shared by the memory adapter and the contract tests; SQL must agree with it.
- `TuteeRepository` port: `list(query)`, `get(userId)`, `act(userId, action, policy?)`, `allowAgain(userId)` (`PortResult<void>`), `cancelSession(requestId)` (`PortResult<SessionRequest>`). JSDoc: tutor only; errors are `PortError` (`forbidden`, `not-found`, `conflict` + `state_conflict`, `validation`, `unavailable`); never raw SQL text.
- `ConflictCode` gains `'access_blocked'`. `AccessRequest` gains `canAskAgain: boolean`; update `getAccessView` with a `'denied-blocked'` view and its tests. `AccessRequestRepository` JSDoc updated (decide may now revoke; use `TuteeRepository` for management).

**Acceptance:** Given strict TypeScript, when a feature imports only `core`, then it can express all five statuses, the policy and action sets, and the tutee-facing code still cannot see `revoked`/`blocked`.

### 3. Supabase adapter

Files: `src/infrastructure/supabase/tutee-repository.ts`, `tutee-rows.ts` (zod schemas and mappers), `access-rows.ts`, `access-request-repository.ts`, `index.ts`, `container.ts`.

- `SupabaseTuteeRepository` mirrors `SupabaseAccessRequestRepository` (shared `callRpc` pattern with try/catch -> `unavailable`). RPCs: `list_tutees`, `get_tutee_detail`, `act_on_tutee`, `allow_access_request_again`, `cancel_session_as_tutor`. Validate the jsonb with zod (`z.object` with exact keys, `timestamp` refine, `.int().min(0)` counts); malformed -> existing "unexpected data" unavailable error. Cancel-session reuses the existing session row mapper.
- `access-rows.ts`: `mapAccessError` adds `TR003` -> `{kind:'conflict', code:'state_conflict'}`, and `P0001` message containing `blocked` -> `{kind:'conflict', code:'access_blocked'}`. `mapRequestRow` accepts all five statuses and **projects** `revoked`/`blocked` to `denied` (defence in depth, because `decide_access_request` can return `revoked`); `can_ask_again` optional with default true.
- `getMine()` now calls `get_my_access_request` (an RPC returning zero or one row) instead of the table read; `mapMyAccess` is unchanged. Remove the now-unneeded direct `.from('access_requests')` read and update its test.
- Container: add `tutees` to `Services` and build `SupabaseTuteeRepository(client)` or the memory fake (step 4). Update `container.test.ts` (Supabase mode vs fallback).

**Tests (adapter):** RPC names and argument keys (`p_user_id`, `p_action`, `p_session_policy`, `p_status`, `p_search`, `p_limit`, `p_offset`); defaults sent as `null`; row mapping; malformed rows; each error code; search text and ids never logged or put in messages; `getMine` projection for denied-by-block.

### 4. Memory adapter and shared contract

Files: `src/infrastructure/memory/in-memory-tutee-repository.ts`, changes to `in-memory-access-request-repository.ts` and `in-memory-session-request-repository.ts`, `memory/index.ts`, `src/test/in-memory-*.ts` helpers.

- The access store holds `TuteeStatus` internally, an `audit` array (action, from, to, sessionsEnded, createdAt, no identity) and projects with `projectForTutee` in `getMine`. `requestAccess` follows revoked like denied and rejects blocked with the `access_blocked` conflict; `decide` and `allowRequestAgain` go through `tutee-transitions.ts` (no-op -> `state_conflict`). Existing in-memory tests keep passing; add the new cases.
- `InMemoryTuteeRepository` shares the access store (constructor options like the existing `as(actor)` views) and the session store; implements list (status filter, case-insensitive name/email substring, order, paging, counts), get, act (including `cancel_all` via new non-port methods on the session fake: `endForUser(userId, policy, now)` and `cancelAsTutor(id, now)`), allowAgain, cancelSession. Tutor-only via `forbiddenUnlessTutor`; deterministic clock and ids; document that it does not model database concurrency.
- Shared contract: `tutee-contract.ts` exports a scenario table (sequence of actions with expected status, cooldown, counts and audit actions; includes every transition, every rejected no-op, blocked re-request rejected, revoke with `keep` vs `cancel_all`, pending declined, search escaping of `%` and `_`, ordering and paging). One runner drives the memory adapter; the PGlite test (step 11) drives the same scenarios against the SQL functions. Both must produce identical observable results.

### 5. Pure view-model logic

Files in `src/features/tutees/`: `tutee-view-model.ts` (+ test), `tutee-messages.ts` (+ test), `use-tutee-list.ts` only if logic is not trivially inline.

- Status label (`Pending`, `Approved`, `Denied`, `Revoked`, `Blocked`), badge tone (text label always present), facts line (`{n} access request(s)`, `Last requested {date}`, `Can ask again after {date}`, `{n} pending session requests . {n} accepted future sessions`), card accessible name (`Alex Example, Approved`), cooldown text (`Now` / date / `No, blocked until unblocked`), timeline entry text and consequence (`2 session requests ended`), session-row grouping and "Past" derivation, and action sets by status exactly as the spec table (`allowedActions`, plus whether to show **Allow to ask again now** or muted **Can ask again now**).
- Announcement and error builders with the exact spec strings (revoke/block success including the cancelled-count variants, `Showing {shown} of {total} tutees.`, stale refresh, save failures). Stale (`conflict`) errors map to the refresh message, `unavailable` to the retry message; no raw error text.
- Date formatting reuses `formatMoment`; no new formatter.

**Acceptance:** Given each status and cooldown state, when the view model is computed, then the actions list equals the spec table and no function reads `email` into an announcement.

### 6. Tutees list page and card

Files: `src/features/tutees/tutees-page.tsx`, `tutee-card.tsx`, `tutees.module.css`.

- `h1` Tutees with the spec lead; native search form (label **Search tutees**, **Search** button), chips as a `role="group"` of native buttons with `aria-pressed` (extend/reuse `FilterTabs` only if it can render `aria-pressed` buttons; if it renders ARIA tabs, add a `variant` rather than forking), counts from `counts`, **Load more** with `offset`, one `StatusAnnouncer`, all states and exact copy from the spec section 2 (loading with `aria-busy`, initial empty, filtered/search empty with **Clear filters**, error + **Try again** with focus rules, load-more error keeps rows, search failure keeps previous results, stale refresh).
- Card: link `/tutees/:userId` (opaque uuid only; no name, email or query in the URL), `overflow-wrap: anywhere`, stacked below 40rem, never a table.
- Keep the submitted search/filter/page state when coming back from detail: carry it in `location.state` (not the URL, so names/emails never enter history or logs) and have **Back to Tutees** restore it.
- Race-safe loading: ignore responses from superseded requests (the existing `active` flag pattern).

### 7. Tutee detail page, actions and dialogs

Files: `src/features/tutees/tutee-detail-page.tsx`, `tutee-actions.tsx`, `tutee-sessions.tsx`, `tutee-history.tsx`, `revoke-block-dialog.tsx`.

- `h1` name + `StatusBadge`, native **Back to Tutees**, `dl` summary (reuse `DefinitionList`), **Sessions** list with **Cancel session** (reuse `ConfirmDialog`, exact copy; past sessions have no button), **Decision history** timeline (ordered list, read-only, empty-state copy with `historyStartsAt`).
- **Access actions** section driven by `allowedActions`. Immediate actions (Approve, Deny, Restore access, Allow to ask again now, Unblock) show a busy label, then reload detail. Revoke and Block use `ConfirmDialog` with the optional **Also cancel accepted future sessions** checkbox (default off, associated help text, initial focus on **Keep access**, Escape closes, focus returns to the invoking button). Success announces the exact spec strings using the returned counts; `conflict` reloads and announces the refresh message; `unavailable` keeps the dialog and shows the action-specific error. After success focus moves to the status heading.
- Unknown/not-found user -> `not-found` state with a link back (no raw error).
- A tutor viewing a tutee whose row disappeared (deleted account) gets the not-found state, not a crash.

### 8. Routes, titles and navigation

- `src/app/routes.tsx`: `tutees` and `tutees/:userId` under `RequireRole requiredRole="tutor"` with headings and `noAccessText`.
- `src/app/nav.ts`: tutor items become Home, Calendar, **Tutees** (`/tutees`, no badge), Requests, Access requests. Update `nav` tests and `layout.test.tsx`.
- `Layout` uses `NavLink ... end`, so **Tutees** would not stay current on `/tutees/:id`. Add an optional `matchNested` flag on `NavItem` (used only by Tutees) and drop `end` for that item.
- `src/app/route-meta.ts`: `ROUTE_TITLES` is an exact-path map. Add `/tutees`: `Tutees` and make `documentTitle` resolve `/tutees/<id>` to `Tutee` without putting the id in the title; add tests (including unknown paths still `Page not found`).

### 9. Reuse and the tutee-facing view

- `access-view.ts`/`access-status-view.tsx`/`access-page.tsx`: handle `'denied-blocked'` with the existing "Not approved at this time" copy, no date, no form, no "ask again" hint. Revoked arrives as `denied` with the 8 h date, indistinguishable from a denial.
- `require-access.tsx` keeps relying on `AccessState`; a revoked tutee becomes `denied` on the next `get_my_access`, and open pages hit `42501` on their next call and fall back to the existing forbidden handling.

### 10. How the existing pages relate (keep and link)

- **`/access-requests`:** keep as the pending inbox, route and nav badge (`pending-count`) unchanged. Its **Approve/Deny** keep using `accessRequests.decide`. Remove the inline **Revoke** button and dialog from `RequestCard`/`RequestList` (revoke needs the session-policy dialog, which lives in Tutees) and replace it on Approved/Declined cards with a native **Manage** link to `/tutees/:userId` (accessible name `Manage {name}`); keep **Allow to ask again** for denied cards. The page lead gets a one-line link "See all tutees". Remove the revoke tests and props, add link tests.
- **`/session-requests`:** keep as the pending session inbox and nav item. Add a native **View tutee** link per row to `/tutees/:userId` (the tutor projection already carries `userId`); accept/decline logic unchanged.
- **Tutees page** is the only place for revoke, block, restore, unblock, history and per-session cancel. Both inboxes call `announceRequestsChanged()`; the Tutees page must also call it after any action that changes the pending counts (revoke/block declines pending sessions) and the session pending count must refresh on focus as today.

### 11. Tests

- **PGlite migration test** `src/infrastructure/supabase/tutee-management-migration.test.ts`: reuse the stub from `access-requests-migration.test.ts` and apply calendar, access, the fix migration, service-role grants, calendar versions, timeslot and the new migration in order (import `?raw`; strip extensions as there). Cover: status check and consistency constraint; every transition and every rejected no-op (`TR003`, `decided_at`/cooldown untouched); deny-twice and approve-twice fixed; cooldown boundary and the 8-hour elapsed interval; allow-again for denied/revoked, rejected when already clear and for blocked; blocked cannot re-request, revoked can after cooldown and the notification trigger fires for revoked -> pending (one event) and not for other transitions; revoke/block with `keep` vs `cancel_all` (pending declined, accepted kept/cancelled only if `starts_at > now()`, past and others untouched); `cancel_session_as_tutor` (pending, future accepted, past rejected, non-admin rejected); revoked tutee: `create_session_request`, `list_my_session_requests`, `cancel_session_request`, `get_blocked_intervals` all `42501`; approved tutee still works; admin list_my still empty; `get_my_access`/`get_my_access_request` projection; table select revoked for authenticated; `list_access_requests` excludes revoked/blocked and works on a non-empty table (types); `list_tutees` and `get_tutee_detail` run on non-empty tables, ordering, paging, limit clamp, status counts, search `%`, `_`, `\` literal, case-insensitive name and email, 100-char cap; anon and non-admin and revoked-tutee calls get `42501`; forged action/policy/status; audit row per action with the right enum/from/to/count, no PII columns, no client grants, append-only; user deletion cascades to the audit table and keeps rows of other users; `service_role` grants still present and none on the audit table; concurrency: `pg_advisory_xact_lock` serialization of revoke vs `create_session_request` and revoke vs accept (use two PGlite connections only if supported, otherwise assert the lock/recheck ordering by invoking with the lock held in a transaction and document the limit).
- **Contract scenarios** (step 4) run against memory and SQL.
- **Adapter tests** (step 3), **domain tests** for `tutee-transitions` (full table, property: every non-listed pair rejects) and `getAccessView`.
- **View-model tests** (step 5).
- **Component tests** (`src/features/tutees/*.test.tsx`) with `renderWithServices` and memory fakes: list states, search, chips, load more, announcements, detail facts, per-status actions (exact labels), revoke/block dialogs (checkbox default off, `keep` vs `cancel_all` calls, exact messages with counts), allow-again, cancel session dialog, stale and error paths, focus restoration; nav and route tests; inbox changes (Manage link, no Revoke); tutee access page for revoked/blocked projections. **axe** check on list, detail and every dialog (as in `a11y.test.tsx`), including empty/error states.
- Then run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`. Do not run or apply migrations to a real database.

## Definition of done

- One new migration, no edit to applied migrations; the SQL state machine, audit table, projection RPCs and gating changes match this plan and ADR 0012 and are covered by PGlite tests, including the listed defect fixes and the user-deletion cascade.
- Every `returns table`/`RETURN QUERY` uses exact cast types and is tested against non-empty data; the `service_role` grants the Edge Function needs are verified.
- `TuteeRepository` is implemented by the Supabase and memory adapters, wired in the container, and a shared contract passes on both.
- `/tutees` and `/tutees/:userId` exist, match `tutee-management.md` copy and accessibility rules, appear after Calendar in the tutor nav, and the inboxes link to them as in step 10.
- Tutees never see `revoked` or `blocked`; blocked shows no retry date; no tutee email is sent and no private note exists.
- Unit, adapter, migration, component and axe tests pass; lint, typecheck, format check and build pass.
- Handoff updated by the developer; reviewer and QA have evidence for privileges, concurrency and accessibility; the owner is told which migrations to apply, in order.

## Risks and review focus

- **Lock ordering and races:** schedule lock before the row lock everywhere; `create_session_request` re-checks approval after taking the lock. A wrong order risks a deadlock or a revoked tutee creating a request.
- **Tutee leak of `blocked`/`revoked`:** the table read is removed, but `request_access` for a blocked user still raises `access request blocked` (ADR text). Only a hand-crafted call sees it; the UI shows generic copy. Reviewer to confirm that is acceptable.
- **Changed return shapes:** the inbox must never receive revoked/blocked rows; `decide_access_request` can return `revoked`; the mapper projection and the inbox filter both guard this.
- **`RETURN QUERY` / type mismatches and missing grants** have bitten before: verify every cast and run each function on real rows in PGlite.
- **Behaviour change** to `list_my_session_requests` (now raises for non-approved) and `cancel_session_request`: check the tutee UI treats `42501` as forbidden, not a crash.
- **Kept accepted sessions** of a revoked tutee are invisible to them; the tutor must contact them (accepted product trade-off).
- **PII:** search text, names and emails never in URLs, logs, audit rows, announcements or error messages; `location.state` is used for list state.
- **Deployment order:** the timeslot migration may be unapplied; apply in timestamp order. The owner applies migrations; this task and the developer's local work do not.
- **Scope creep:** no notes, no tutee emails, no purge job, no new notification events.

**Reviewer focus:** SQL privileges and transaction integrity, projection privacy, state-machine parity between SQL and memory, accessibility of the dialogs. **QA focus:** every transition and rejected no-op, revoke/block session policies, search and paging boundaries, stale/conflict handling, keyboard and screen-reader behaviour at 320px and 200% zoom.
