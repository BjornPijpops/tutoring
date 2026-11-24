# Timeslot requests implementation plan

**Status:** Tech Lead plan — documentation only; do not apply migrations or implement code in this phase.

This plan turns ADR 0010 (range requests and overlap integrity), ADR 0011 (tutor notification outbox), `docs/design/timeslot-requests.md`, and the existing calendar/access boundaries into small, ordered developer tasks. Work must remain on `feature/timeslot-requests`, created from an up-to-date `main`; do not commit directly to `main`. The developer hands off to QA and reviewer, and the final delivery is a reviewed squash-merge PR/workflow according to the repository instructions.

## Product contract to keep centralized

Define one server-owned constants/validation module (and mirror it in pure UI validation) for: `Europe/Brussels`, 30-minute grid steps, 30-minute minimum, 2-hour maximum, 24-hour minimum notice, 30-calendar-day inclusive horizon, 08:00–22:00 local hours, and three pending requests per tutee. Persist UTC instants and treat ranges as half-open `[starts_at, ends_at)`. Do not add a note field, tutee email delivery, private tutor title, or another tutee's identity to the tutee projection.

## Ordered implementation steps

### 1. Confirm the branch and existing seams

- Verify `feature/timeslot-requests` is based on current `main`; record the base commit in the handoff.
- Read the existing `SessionRequestRepository` placeholder, `session-request` domain type, `BlockedTimeRepository`, `SelectableTimeGrid`, `GridBlock`, Supabase row mappers, container wiring, and access notification implementation before changing contracts.
- Keep the feature dependency direction: feature code imports core ports/domain only; Supabase and memory details stay in adapters; the grid receives view models, never rows.
- Replace the obsolete `slotId` contract rather than adding a second competing session-request API.

**Acceptance:** Given the branch is checked out, when the developer starts, then no migration is edited/applied and the implementation target is documented as a range-based request flow.

### 2. Add the range-based domain and port contract

**Files/modules:** `src/core/domain/session-request.ts`, a shared request-validation/constants module if useful, `src/core/ports/session-request-repository.ts`, `src/core/ports/blocked-time-repository.ts` only if a separate own-request read port is needed, and exports.

- Model `pending | accepted | declined | cancelled`; include request id, owner id only where the caller is authorized, UTC `startsAt`/`endsAt`, timestamps, decision/cancellation timestamps, and tutor-only requester identity in a separate summary type.
- Use distinct types for `MySessionRequest` and tutor decision rows so email/display identity cannot accidentally reach tutee components.
- Define operations such as `create(range)`, `listMine(range?)`, `listPendingForTutor()`, `decide(id, 'accepted'|'declined')`, and `cancel(id)`. The create/decision/cancel methods return typed `PortError` values, including validation, forbidden, conflict, not-found, and unavailable; do not expose SQL text.
- Document that `listBlockedIntervals` is anonymous/merged and excludes the caller's own accepted sessions for approved tutees; own pending/accepted requests come from `listMine` and are overlaid separately.

**Acceptance:** Given a caller implements the port, when TypeScript compiles in strict mode, then it cannot use `slotId`, direct Supabase types, or an unscoped tutor identity in the tutee request model.

### 3. Design and implement the migration (do not run it in this task)

**New migration:** use the next repository timestamp after the current migrations, for example `supabase/migrations/20261125000400_timeslot_requests.sql`; never edit an applied migration. Add a focused PGlite migration test fixture under `src/infrastructure/supabase/` or the repository's existing migration-test convention.

#### 3a. Table, indexes, RLS, and constraints

Create `public.session_requests` with server-generated UUID `id`, `user_id` referencing `auth.users` with cascade delete, `starts_at`, `ends_at`, `status` (`pending`, `accepted`, `declined`, `cancelled`), `created_at`, `updated_at`, nullable `decided_at`, and nullable `cancelled_at`. Add an ordering check, a partial/functional `tstzrange(starts_at, ends_at, '[)')` GiST exclusion constraint for `status = 'accepted'`, and indexes for owner/status/time and tutor pending order. Enable RLS, revoke direct client insert/update/delete (and avoid broad table reads); all lifecycle writes are security-definer RPCs. The table contains no note, display name, or email.

Install/use `btree_gist` only if required by the exclusion operator. Keep the range half-open so adjacent sessions are valid. Add explicit checks for `ends_at > starts_at` and any safe maximum range length; the RPC remains responsible for product rules and Brussels conversion.

#### 3b. Shared schedule lock and blocked-event race protection

Choose and document one fixed advisory-lock key (for example `hashtextextended('tutoring.schedule', 0)`). Every transaction that can create or make an accepted session, and every calendar-event insert/update path, acquires the same transaction-scoped lock before cross-table checks.

~~Add a trigger on `calendar_events`~~ **Superseded by owner decision (see ADR 0010):** there is no trigger on `calendar_events`; manual events and ICS imports are never blocked by an accepted session. The session RPCs acquire the lock before checking `calendar_events` and accepted sessions, so request creation and acceptance cannot pass each other. A tutor-only `list_accepted_sessions_for_tutor` feeds read-only blocks on the tutor calendar.

#### 3c. Security-definer RPCs

All RPCs use `security definer`, `set search_path = ''`, schema-qualified names, authenticated-only execute grants, and explicit `auth.uid()`/`is_admin()`/`is_approved_tutee()` checks. No browser write goes directly to the table.

Implement these operations (names may follow the existing naming convention, but keep one stable contract):

1. `create_session_request(p_starts_at, p_ends_at)`: validate one Brussels local day, 30-minute boundaries, 08:00–22:00, duration 30 minutes–2 hours, at least 24 hours ahead, no more than 30 calendar days ahead, approved caller, and fewer than three pending rows. Acquire the schedule lock, recheck blocked events and accepted sessions, insert pending row, and rely on the same transaction to enqueue exactly one `session-requested` outbox event. Map all expected failures to stable SQLSTATE/error codes.
2. `list_my_session_requests(p_from, p_to)` (or an equivalent bounded list): return only the caller's own active/history rows needed by **My sessions** and the grid. No tutor event title, other user, email, or outbox data.
3. `list_session_requests_for_tutor()`: admin-only pending decision projection with request id, requester display name/email, UTC range, status, and timestamps needed by the tutor UI. Do not use this projection for tutee availability.
4. `decide_session_request(p_request_id, p_decision)`: admin-only, lock the request row and shared schedule, require it is still pending, and on acceptance recheck all conflicts. Update to accepted/declined in the same transaction. On acceptance, automatically update every *other pending* request for that tutor whose half-open range overlaps to `declined`, and return the accepted request plus the exact overlap-declined count (either a composite return type or a second stable result field). A conflict/stale decision leaves the target pending.
5. `cancel_session_request(p_request_id)`: owner-only for pending or accepted, lock the row, transition to cancelled with timestamp, and retain history. Accepted cancellation releases the interval. Do not allow a tutee to cancel another user's row or alter a declined/cancelled row.

#### 3d. Privacy-safe blocked intervals and own-session query

Update `get_blocked_intervals` rather than creating a parallel public calendar RPC. For an approved tutee, union tutor `calendar_events` with accepted sessions where `user_id <> auth.uid()`, clip to the requested range, merge touching/overlapping intervals, and return only `starts_at`/`ends_at`. For the tutor/admin, include all accepted sessions as appropriate for the tutor calendar. Keep the existing bounded-range validation and authorization.

Do **not** put the caller's accepted sessions in this anonymous result: `list_my_session_requests` is the separate query that supplies the caller's own accepted/pending busy blocks. This avoids duplicate blocks and lets the UI label own states without revealing anyone else. Add migration tests proving adjacent intervals merge, own accepted sessions are omitted from the anonymous tutee result, another tutee's accepted session is included, and no id/name/title/email column is returned.

#### 3e. Notification outbox in the same migration

Reuse ADR 0011's delivery path. Prefer a typed `tutor_notification_outbox` with UUID id, `event_type` (`access-requested`/`session-requested`), request id, user id, created/sent timestamps, attempts, and a uniqueness/idempotency key. Preserve already queued `access_request_notifications` rows: either migrate them without deletion or retain a compatibility view/dispatch path and document the rollout. A trigger/RPC insert for a new pending session request must create one `session-requested` event in the same transaction; notification enqueue/HTTP failure must never roll back the request. Acceptance, decline, and cancellation do not send mail.

**Acceptance:** Given concurrent acceptance, calendar-event insertion, or request creation, when transactions overlap, then the shared advisory lock plus accepted-session exclusion constraint prevents double booking; accepting one request atomically declines overlapping pending requests and reports the count.

### 4. Extend or reuse the notification Edge Function

Modify `supabase/functions/notify-access-request/logic.ts`/`index.ts` rather than creating an unprotected client email path. Keep webhook secret constant-time validation, UUID/event validation, service-role-only current-data loading, Resend idempotency, bounded retry semantics, and logs containing ids/status only.

- Accept typed event payloads for both access and session notifications, while remaining backwards-compatible with queued access events during rollout.
- For `session-requested`, load the current request and Auth user server-side, build a fixed tutor-only subject/body with Brussels date/time and duration, and escape all user-controlled values. Send only to `TUTOR_EMAIL`; never send to the tutee and never trust PII/range values from the webhook body.
- Use an event-specific idempotency key and mark the outbox event sent only after a successful provider response. Unknown/already-sent events remain safe successes; failures return retryable status.

**Tests:** extend `logic.test.ts` with session event validation, current-data loading, Brussels formatting, HTML/text escaping, recipient enforcement, idempotency, unknown/already-sent handling, provider failure, and assertions that logs/payloads contain no secrets or unrelated PII.

### 5. Implement both adapters and composition wiring

**Supabase:** add row schemas/mappers and RPC calls in `src/infrastructure/supabase/session-request-repository.ts`; map stable SQLSTATE codes to `PortError` and map malformed data to the existing unavailable/malformed boundary. Add exports and select the adapter in `src/infrastructure/container.ts` whenever Supabase is configured.

**Memory:** replace the placeholder slot-based implementation in `src/infrastructure/memory/in-memory-session-request-repository.ts` with range-based behavior. Model Brussels validation, pending cap, owner/tutor authorization, overlap checks, accepted/cancelled lifecycle, automatic decline count, and history sufficiently for offline UI/tests. Keep deterministic clock/id injection and avoid pretending memory provides database concurrency; concurrency/race guarantees belong to PGlite/Postgres tests.

Add adapter tests for every port operation, malformed RPC rows, stable error mapping, ownership, and no private fields in tutee results. Update the container tests so Supabase mode uses the Supabase session adapter and fallback mode remains usable.

### 6. Add pure view-model and validation logic

**Files:** new focused modules in `src/features/calendar` and `src/features/access` alongside existing `calendar-view-model.ts`, `time-grid-selection.ts`, `time-grid-model.ts`, and Brussels helpers.

- Convert anonymous blocked intervals to striped, read-only `GridBlock` values labelled `Not available`.
- Convert only the current user's pending/accepted rows to non-striped `busy` blocks labelled exactly `Pending` or `Accepted`; keep stable opaque keys and local date/time accessible names. Declined/cancelled rows do not occupy the active grid.
- Keep selection one local day, snapped to 30 minutes, within 08:00–22:00, and never allow selection across blocked intervals. Client validation is advisory and uses the same pure constants; the RPC remains authoritative.
- Add pure grouping/formatting for **My sessions** (`Pending`, `Accepted`, `Past and closed`) and tutor pending rows, including overlap-declined announcement count and stable UI error-copy mapping.

**Acceptance:** Given a tutee projection containing another user's row or title, when the view model is built, then it rejects/ignores private fields and emits only anonymous blocked or own generic busy blocks.

### 7. Build tutee request and My sessions UI

Extend the existing `AvailabilityPage`/`SelectableTimeGrid` strategy boundary; do not put Supabase calls in grid components. Load anonymous blocked intervals and own requests separately, overlay own blocks, and refresh both after create/cancel. Selecting a range opens the exact confirmation dialog from `timeslot-requests.md`; it never saves implicitly and has no note field.

Add the authenticated **My sessions** page and lifecycle details. Pending cancellation uses the standard confirmation pattern; accepted cancellation uses the exact title/body/actions in the design. Preserve draft/dialog context on conflict, expose `aria-busy`, use the specified stable messages, and restore focus after success.

### 8. Build tutor Requests UI and calendar projection

Add a tutor-only **Requests** page immediately after **Calendar**, with pending badge, identity/range/status rows, native Accept/Decline controls, loading/empty/error states, and no note field. Acceptance refreshes both request list and tutor calendar; announce `N overlapping requests were declined.` only when the RPC count is non-zero. A conflict leaves the row pending and shows the specified retryable message.

Update the tutor calendar view to show accepted sessions as distinct non-striped `busy` blocks, with tutee identity only in the tutor-only request/calendar projection. Keep imported/manual event titles within tutor boundaries.

### 9. Routes, navigation, and access guards

Update the existing app route and navigation modules rather than introducing a second router. Add `/my-sessions` for approved tutees and `/session-requests` (or the established Requests route) for tutors, protect both by auth/access role, place My sessions after Availability and Requests after Calendar, and expose pending badges with accessible text. Signed-out, unapproved, and forbidden states must use existing guards and stable copy.

### 10. Tests and verification gates

Run focused tests first, then the repository's full checks without changing migrations or deployment state:

- **PGlite migration tests:** apply all migrations to a fresh PGlite database; verify schema/RLS/grants where supported, Brussels validation, range boundaries, 24-hour/30-day rules, 3-pending cap, accepted exclusion, no calendar trigger (manual and ICS writes succeed over accepted sessions), request/accept re-check, advisory-lock serialization, own-vs-other blocked projection, cancellation/history, and atomic overlap auto-decline.
- **Supabase adapter tests:** RPC names/arguments, row mapping, stable error mapping, malformed response handling, and privacy-safe projections.
- **Edge Function logic tests:** both event types, escaping, idempotency, retries, recipient, secret, and no-PII logging.
- **Pure domain/view-model tests:** duration, local-day/DST conversion, half-open adjacency, selection constraints, block labels/kinds, grouping, and announcement text.
- **Component tests:** confirmation/cancellation/decision flows, loading/empty/error/success states, focus restoration, pending badges, overlap count, responsive day list, and no implicit save.
- **Accessibility:** run `axe` component tests, verify native Tab/Enter/Space/Escape behavior, labels/descriptions/live regions, visible focus, 44px targets, contrast/non-colour cues, and no horizontal scrolling at 320px/200% zoom.
- Then run lint, typecheck, unit/component tests, and build. Review the diff for docs-only scope before any later implementation branch work.

## Definition of done

- Migration design and tests cover the table, RLS, partial accepted-session exclusion, shared advisory lock, no calendar trigger (owner decision), all RPCs, outbox, and anonymous/own interval split.
- Session-request port is range-based; both Supabase and memory adapters implement it and are wired through the container.
- The Edge Function supports access and session events with idempotent, tutor-only delivery and no client email path.
- Tutee and tutor UIs match `timeslot-requests.md`, including no note, no tutee email, privacy-safe labels, cancellation, acceptance auto-decline count, routes, and nav badges.
- Focused migration, adapter, Edge Function, pure logic, component, and axe tests pass; lint/typecheck/full tests/build pass.
- QA and reviewer have explicit evidence for concurrency/privacy/accessibility; no migrations are applied as part of this planning task; developer handoff and branch/PR rules are satisfied.

## Risks and review focus

- **Cross-table races:** verify the request RPCs (create, decide) acquire the lock; calendar writes intentionally take none and must never fail because of a session.
- **Time-zone/DST errors:** compare local Brussels wall time for notice/horizon and persist UTC; test DST transition dates and inclusive 30-day semantics.
- **Privacy leakage:** inspect SQL return shapes, row mappers, logs, URLs, accessible names, and tutor-vs-tutee projections; accepted sessions of others must be anonymous.
- **Outbox compatibility:** do not strand existing access notifications or make request creation depend on Resend/Vault/pg_net availability.
- **Lifecycle races:** stale decisions must leave requests pending; cancellation must be owner-only; accepted cancellation must free time while retaining history.
- **UI drift:** keep all error/status copy and navigation positions aligned with the design; do not revive the obsolete slot id or custom keyboard cursor.
- **Operational cost:** bounded pending rows, outbox attempts, and existing Supabase/Resend free-tier limits remain enforced.

**Reviewer focus:** SQL privilege posture and transaction integrity first, then privacy projections, adapter contract fidelity, notification idempotency, and axe/component evidence. **QA focus:** boundary/time-zone/concurrency cases plus complete lifecycle and responsive/accessibility flows.
