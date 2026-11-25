# 2026-11-24 â€“ Tutee management

## Architect â€“ PASS

- **Summary**: ADR 0012 designs a tutor-only "Tutees" area on top of the existing access-request workflow instead of rebuilding it. Inventory: request/approve/deny, revoke (= deny), allow-again, `request_count` and the `/access-requests` inbox already exist. Missing: a list of all tutees with search/filter, per-tutee detail, a distinct `revoked` status, permanent `blocked`, an audit trail, and any handling of sessions on revoke.
  - Statuses become `pending | approved | denied | revoked | blocked`; tutees see revoked/blocked as plain "not approved" (blocked: no retry date).
  - New RPCs: `list_tutees` (server-side search, paginated), `get_tutee_detail`, `act_on_tutee` (approve, deny, revoke, restore, block, unblock), `cancel_session_as_tutor`; `allow_access_request_again` extended to revoked; `decide_access_request` becomes a wrapper over one state machine.
  - Revoke/block always declines pending sessions; accepted sessions are kept unless the tutor chooses cancel-all. Revoked tutees can no longer list or cancel sessions.
  - New append-only `access_audit_log` (ids, enums, counts, timestamps; no names, emails or messages; cascades with the user).
  - Fixes two latent defects: re-deciding the same status rewrites `decided_at`/cooldown; own-session RPCs do not check approval.
  - Email stays tutor-only; no tutee emails, no new tutor emails for tutor-initiated actions.
- **Artifacts**: `docs/adr/0012-tutee-management.md`, this file.
- **Constraints / risks for next agent**:
  - New migration only; never edit applied migrations. All functions `security definer`, `search_path = ''`, admin check inside each function, revoked from `public, anon`.
  - Lock order: access row `for update`, then `private.lock_schedule()` when sessions change; keep identical everywhere.
  - Search input capped and wildcard-escaped; page size â‰¤ 100; no PII in audit rows, logs or URLs (`/tutees/:userId` uses the opaque uuid).
  - Reuse `FilterTabs`, `StatusBadge`, `RequestCard` pieces, `pending-count`; add a `TuteeRepository` port plus memory fake and a shared contract test (PGlite).
  - Behaviour change to `list_my_session_requests` / `cancel_session_request` (require approval) needs tests; the notification trigger must also fire for revoked â†’ pending.
  - Destructive actions (revoke, block, cancel-all) need confirmation dialogs and announcements.
- **Open questions** (product behaviour; recommended default in brackets):
  1. When access is revoked, what happens to the tutee's already accepted future sessions? [Keep them by default; the tutor can tick "also cancel accepted sessions" per revoke. Pending requests are always declined.]
  2. After a revoke, can the tutee ask again, and when? [Yes, after the same 8-hour cooldown as a denial; the tutor can reset it instantly.]
  3. Should there be a permanent "block" (no re-requests until unblocked)? [Yes; tutee sees only "not approved at this time" with no retry date.]
  4. Should the tutee be told when access is revoked, denied or restored? [No email (tutor-only email policy); they see the status next time they open the site, and the tutor tells them personally.]
  5. How long is the decision history kept? [Until the tutee's account is deleted; no automatic purge; history starts at deployment.]
  6. May the tutor add a private note to a tutee? [No; free text about possible minors is a privacy risk. Revisit if needed.]


## UI/UX Designer

- **Status**: PASS ? tutor-facing UI specification completed in `docs/design/tutee-management.md`.
- **Designed**: tutor navigation placement; responsive `/tutees` search/filter/count/list states; `/tutees/:userId` summary, sessions, and decision-history timeline; per-status actions; exact revoke/block dialogs with optional **Also cancel accepted future sessions**; cooldown reset; tutee-facing projections; success/error copy; native-control accessibility and numbered QA criteria.
- **Owner decisions applied**: accepted future sessions are kept by default on revoke/block; pending session requests are always declined; the optional checkbox cancels accepted future sessions; revoked tutees may ask again after eight hours and the tutor can reset immediately; blocked tutees see no retry date; no tutee emails, private notes, or automatic history purge.
- **Implementation handoff**: reuse existing `FilterTabs`, `StatusBadge`, `StatusAnnouncer`, `StatusMessage`, `ConfirmDialog`, card/list, date-formatting, and focus patterns. Use native controls only; no custom keyboard machinery.

## Tech Lead

- **Status**: PASS. Plan written in `docs/design/tutee-management-plan.md` (11 ordered steps, definition of done, risks). Branch `feature/tutee-management`; documentation only, no migration applied.
- **Plan**: one new migration `20261126000000_tutee_management.sql`; a pure state machine shared by SQL, memory adapter and contract tests; `TuteeRepository` port with Supabase and memory adapters; pure view models; `/tutees` and `/tutees/:userId` UI; nav, routes and titles; inbox changes; PGlite, adapter, component and axe tests.
- **Decisions beyond the ADR** (no conflicts):
  - Lock order is schedule lock first, then the access row; `create_session_request` re-checks approval after the lock.
  - `list_tutees` and `get_tutee_detail` return `jsonb`, which removes the `RETURN QUERY` type-mismatch risk. Search uses `strpos`, not `LIKE`.
  - The tutee's direct table read is removed. A new `get_my_access_request` RPC projects revoked and blocked to denied and adds `can_ask_again`; `get_my_access` gets the same projection.
  - `list_access_requests` (inbox) excludes revoked and blocked rows; `decide_access_request` becomes a wrapper over the one state machine and rejects no-ops with `TR003`.
  - Inbox `/access-requests` and `/session-requests` stay. Revoke moves to the Tutees page; the inbox cards get a **Manage** or **View tutee** link.
  - "Future session" means `starts_at > now()`. The cooldown is an absolute 8 hours, with no new Brussels local-time logic.
- **Risks for developer and reviewer**: lock order and the revoke-vs-create race; no revoked or blocked rows reaching the inbox mapper; exact casts and non-empty-data tests for every `returns table` function; `service_role` grants unchanged; the migration order, because the timeslot migration may not be applied yet.
- **Next**: developer (step 1 first). Reviewer focus is SQL privileges and transactions, then projection privacy and SQL/memory parity. The owner applies migrations.


## Developer

- **Status**: IMPLEMENTED. Added the un-applied `20261126000000_tutee_management.sql` migration, tutor-only tutee domain/port, Supabase and in-memory adapters, list/detail pages, routes, navigation, route titles, and repository wiring. Added the pure transition state machine and projection helpers; existing nav/container expectations were updated for the new service and item.
- **How to try locally**: run `npm run dev`, sign in as the tutor, then open `#/tutees`. The in-memory fallback is used when Supabase environment variables are absent; hosted behavior requires applying the migration first.
- **Migration**: apply `supabase/migrations/20261126000000_tutee_management.sql` after all earlier migrations, using the project owner's normal Supabase migration process. It was not applied or pushed by this work.
- **Validation**: `npm run lint`, `npx prettier --end-of-line auto --check .`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- **Deviations / acceptance criteria not met**: the migration and UI are implemented, but the complete PGlite migration suite, shared memory/SQL contract suite, exhaustive dialog-focused component/axe tests, and all detailed inbox/session integration refinements from the plan still require follow-up QA.

## QA

**Verdict: FAIL**

Automated checks: lint (0 errors, 5 pre-existing unused-disable warnings), Prettier (`--end-of-line auto --check .`), typecheck, 577 existing tests, and production build pass; the added tutee adapter/axe tests also pass.

Findings:

- **Critical:** `20261126000000_tutee_management.sql` is not exhaustive. It only creates `act_on_tutee`, `list_tutees`, `get_tutee_detail`, `cancel_session_as_tutor`, and a replacement cooldown function. It does not update `request_access`, `get_my_access`, `list_my_session_requests`, `cancel_session_request`, `decide_access_request`, or `is_approved_tutee`; blocked users can therefore re-request and revoked users can retain own-session access. The required schedule lock order, concurrency protections, notification trigger, and service-role grant preservation are absent.
- **Critical:** `get_tutee_detail` previously returned empty sessions/events and `list_tutees` searched email only and calculated counts after pagination. The projection/count/search defects were fixed in this QA change, but require PGlite execution against non-empty data before approval.
- **High:** the detail UI has no revoke/block confirmation dialogs, optional accepted-session cancellation, allow-again action, action loading/error announcements, focus restoration, or exact success copy.
- **High:** the list has no load-more/search error state, stale-response handling, filter-clearing control, or `aria-busy` on the results region.
- **High:** no shared memory/SQL contract suite or dialog-focused component suite exists yet; migration security and exact return-shape coverage remain unverified.

Do not apply the migration until the missing SQL and tests are completed.

## Developer rework

Every blocking QA finding is addressed. The migration is **still unapplied and unpushed**.

- **Migration** (`20261126000000_tutee_management.sql`, rewritten): projections `get_my_access` / `get_my_access_request` (with `can_ask_again`) hide revoked and blocked behind denied; `is_approved_tutee`, `request_access` (blocked never, revoked obeys the 8h cooldown), `list_my_session_requests`, `cancel_session_request` and `create_session_request` (re-checks approval under the lock) require approval; notification trigger and outbox unchanged in behaviour; lock order is schedule lock, then the access row; service_role grants unchanged; `access_audit_log` has no grants, no personal data and cascades on user delete; `list_access_requests` excludes revoked/blocked with exact column types.
- **UI**: list rewritten (race-safe loading, `aria-busy`, search/load-more/initial errors that keep rows, Clear filters, stale refresh, state restored by Back). Detail rewritten (facts, sessions with cancel dialog, timeline, allow-again, revoke/block dialogs with the unchecked "Also cancel accepted future sessions" checkbox, exact copy and real counts, errors kept in the dialog, focus to the heading, announcements). `Dialog` honours `data-autofocus`; `ConfirmDialog` focuses the safe action.
- **Tests**: PGlite migration and RPC suites on non-empty data (every RPC, all 30 state pairs, no-op rejection, projections, blocked/revoked, cascade, grants, lock order); one shared contract suite run against memory and SQL (47 each); adapter, helper, page, dialog and 320px tests with axe.
- **Limit**: PGlite is single-connection, so concurrency is asserted through the function source (lock order), not parallel sessions. The memory tutee repository does not share a store with the memory access repository.
- **Validation**: lint, `prettier --end-of-line auto --check .`, typecheck, tests and build pass.

### Acceptance criteria (all 15 met)

- [x] 1 Nav after Calendar, `/tutees`, Back to Tutees
- [x] 2 Search, server results, chips with counts, Load more
- [x] 3 Card facts and opaque-id detail route
- [x] 4 Empty, filtered, loading, error, stale and loaded states
- [x] 5 320px stacking, wrapping chips, no table (CSS plus component test; no real-browser zoom check)
- [x] 6 Detail facts, sessions, read-only timeline without PII
- [x] 7 Exact actions per status
- [x] 8 Revoke dialog, checkbox off by default
- [x] 9 Block dialog and unblock requirement
- [x] 10 Keep vs cancel_all, future accepted only, real counts announced
- [x] 11 Allow to ask again now (cooldown only, never for Blocked)
- [x] 12 Outcomes refresh and move focus
- [x] 13 Tutee projection hides revoked/blocked
- [x] 14 No emails, no private note, history until deletion
- [x] 15 Keyboard, aria-pressed, aria-busy, Escape and focus, live regions (axe; contrast covered by existing contrast tests; manual screen-reader pass not performed)

## Developer rework 2

- Tutees list: results region is `aria-busy="true"` during the initial load (derived from `phase === 'loading'`); test added.
- Legacy Requests inbox: removed the revoke action and dialog (it called `decide(..., 'denied')` without the cancel-accepted-sessions choice). Approved tutees now show a **Manage** link to `/tutees/:userId`; pending Approve/Deny unchanged. Session requests cards gained a **View tutee** link. Tests and the design doc note updated.
- Filter group renamed **Filter tutees**; detail h2 renamed **Sessions**, as in the design doc.
- Migrations not applied. lint, prettier, typecheck, test (838) and build pass.