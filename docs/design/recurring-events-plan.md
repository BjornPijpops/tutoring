# Recurring blocked events implementation plan

**Status:** Tech Lead plan — documentation only. This branch is `feature/recurring-blocked-events`; do not apply or edit migrations in this planning phase. Implementation must remain on a feature branch based on an up-to-date `main`, and finish as a reviewed squash-merge PR rather than a direct `main` commit.

This plan implements ADR 0013 and `docs/design/recurring-events.md` on top of the existing materialised `calendar_events` model. It reuses the Brussels wall-clock helpers, optimistic `updated_at`, `private.lock_schedule()`, existing Dialog/Field/error patterns, and the current ICS import. The recurrence rule is display/scope metadata; materialised occurrence rows remain the read and overlap source of truth.

## Ordered implementation steps

### 1. Confirm seams and freeze the compatibility boundaries

- Verify the implementation branch is based on current `main`; record the base commit in the developer handoff and do not commit directly to `main`.
- Read the current `calendar_events`, `updated_at`, schedule-lock/session-request, and ICS migrations plus their PGlite tests before writing the new migration. The existing session-request RPCs and `get_blocked_intervals` must remain behaviourally unchanged.
- Reuse `CalendarEvent`, `NewCalendarEvent`, `CalendarEventRepository`, `wallTimeToInstant`, `addDays`, `startOfWeek`, `TUTOR_TIME_ZONE`, the existing Supabase row mapping, memory repository, `CalendarEventDialog`, `CalendarManager`, grid blocks, and import panel. Do not create a second recurrence or ICS model.

**Acceptance:** Given the branch and existing fixtures are inspected, when implementation starts, then no applied migration is changed, no migration is run from the product branch, and the intended extension points are recorded.

### 2. Add the pure recurrence domain module first

**Files/modules:** a focused module beside the existing core calendar/local-time domain (for example `src/core/domain/recurrence.ts`) and its tests.

- Define `RecurrenceRule`, `RecurrenceEnd`, `RecurrenceScope`, occurrence/result types, and shared constants: `Europe/Brussels`, 1–12 interval weeks, 2–400 count, 12-calendar-month horizon, and the existing 08:00–22:00 / 30-minute grid.
- Implement `expandRecurrence(rule, todayInBrussels)` as a pure function. Iterate `IsoDate` calendar dates, anchor week arithmetic at Monday, choose the first selected weekday on or after the start date, and call `wallTimeToInstant` for every occurrence. Never add milliseconds to move a recurrence. Preserve each selected Brussels wall-clock start/end across late-March and late-October DST changes.
- Implement validation and summary/count helpers used by both UI and adapter tests. Validate one local date, hours, grid, interval, weekdays, required end, horizon and occurrence count; never silently shorten a count that exceeds the horizon. Keep clipping before expansion/confirmation as required by the existing calendar spec.

**Acceptance:** Given multi-weekday rules and both Brussels DST transitions, when expansion runs, then dates, count, 30-minute alignment, wall times and computed summary agree with the design; invalid rules produce the specified field-level messages and no persistence request.

### 3. Design migration `20261127000000_recurring_events.sql` (review/apply later only)

Create one reviewed migration after the current migration chain; do not apply it in this task.

#### 3a. Series schema and privileges

- Add `public.calendar_event_series(id uuid primary key default gen_random_uuid(), rule jsonb not null, created_at timestamptz not null default now())`. Store the rule shape from ADR 0013 (`startDate`, `intervalWeeks`, ISO weekdays, start/end minutes, and `end`), with no title; occurrence rows are authoritative.
- Add nullable `calendar_events.series_id` referencing the series with `on delete cascade`, plus `(series_id, starts_at)` index. Keep `source = 'manual'` and `external_id is null` for manual series; ICS rows never receive a series id.
- Enable RLS, revoke table/function access from `public` and `anon`, and allow only the existing authenticated admin boundary. RPCs must be `security definer`, schema-qualified, `set search_path = ''`, and check `public.is_admin()` with stable forbidden errors. Preserve the existing `updated_at` trigger and source/external-id uniqueness.
- Do not add service-role grants: the notification Edge Function already has the `service_role` grants it needs for session requests/outbox, and recurring-series data must not be exposed to it.

#### 3b. Atomic admin RPC contract

All three write RPCs take `private.lock_schedule()` before inspecting or mutating rows. They do **not** overlap-check or reject manual/ICS events against accepted sessions or other events. There is no calendar trigger and no change to session-request RPCs: session creation/acceptance keeps its existing checks and exclusion constraint, while tutor blocked-event creation remains allowed over accepted sessions.

1. `create_calendar_series(p_rule jsonb, p_title text, p_occurrences jsonb)` validates admin identity, rule shape, title length, 2–400 occurrences, and every supplied occurrence (Brussels local one-day range, 30-minute grid, 08:00–22:00, valid ordering, today-to-12-month horizon). Insert the series and all `calendar_events` rows in one transaction. Return a stable result containing the new `series_id` and `occurrence_count` (exact SQL types; cast named text/varchar columns explicitly in `RETURN QUERY`).
2. `update_calendar_event(p_event_id uuid, p_expected_updated_at timestamptz, p_scope text, p_changes jsonb)` validates admin/scope and the clicked row's optimistic version. `this` updates one row and keeps its series link; `following` splits at the clicked occurrence, moves later rows to a copied series/rule, and applies changed title/time; `all` applies changed title/time to every row using each row's own Brussels date. Date changes are legal only for `this`; changed fields only are written. Update display-only rule minutes where applicable, remove empty series rows, and return `affected_count` (and any new series id needed by the adapter). On stale clicked-row version, return the existing conflict contract without partial writes.
3. `delete_calendar_event(p_event_id uuid, p_scope text)` validates admin/scope and locks the schedule. Delete one row, clicked-and-following rows, or the complete series; clean up an empty series. Non-series and imported rows accept only `this`. Return `affected_count`, distinguishing not-found/stale from a successful zero-free operation.

Add PGlite migration tests using non-empty fixtures: admin-only RLS/grants, exact return column types, series cascade/index, 400/horizon/hours/grid invariants, atomic create, optimistic conflict, this/following split/all semantics, preservation of individually moved dates/titles, empty-series cleanup, and count returns. Explicitly prove accepted sessions still do not block event creation, session-request RPCs remain unchanged, and the lock is acquired without introducing a calendar trigger.

### 4. Extend the core port and both adapters

- Add series creation/read and scoped update/delete to `CalendarEventRepository` without overloading imported `addEvents`: `addSeries`, `getSeries`, `updateEvent(..., scope, changes)`, and `removeEvent(id, scope)` with typed count/result values. Add `seriesId` to `CalendarEvent`; keep imported events series-free. Keep `removeImportedEvents` unchanged.
- Supabase adapter: call the three RPCs with explicit arguments, map exact row/result shapes, map conflict/not-found/forbidden/validation/unavailable errors through existing `PortError`, and continue using table reads for ordinary event listing. Add `series_id` to select columns and row schemas. Do not grant the browser direct access to the new table.
- Memory adapter: implement the same scope/split/count semantics, deterministic ids/clock support, optimistic versions, and Brussels validation. Share contract tests with the Supabase adapter; memory must not claim database concurrency guarantees.
- Update container wiring and exports while preserving the existing ICS parser/import flow. ICS rows remain individual view/delete-only events and retain “Remove all imported events”.

**Acceptance:** Given either adapter and the same fixture, when a series is created, edited or deleted with each scope, then returned counts, series links, conflicts, imported-event restrictions and visible rows match the port contract.

### 5. Integrate the create/edit/delete UI and calendar projection

- Extend `CalendarEventDialog` with the exact native Repeat select, inline Custom fieldsets, required Ends radios, Brussels date bounds, summary sentence, count validation, disabled dependent inputs, and specified copy. Use the pure expansion module so displayed counts equal persisted occurrences. Keep repeat pattern read-only on edit.
- Replace edit/delete actions for series rows with the same-dialog scope step (This event / This and following / All events), focus the heading on entry, preserve values on Back, disable date-incompatible scopes, and use the exact busy/conflict/already-gone/status messages. Imported events retain the plain confirmation and no scope controls.
- Update `CalendarManager` to call series APIs, show count-based success announcements, restore focus correctly, remove the Events this week section/EventList and all per-row delete paths, and remove the grid Delete-key shortcut. Keep Week view empty/loading behaviour and import ordering.
- Add repeat indicators to tutor grid/mobile view models only (`↻` plus accessible “repeats” and mobile `Repeats` line). Do not expose series/title/count data in tutee projections; anonymous blocked interval merging remains unchanged.
- Preserve existing clipping/confirm-again behaviour, native controls, tokens, responsive layout, and shared Dialog/Field/ErrorSummary/ConfirmDialog components. No custom keyboard handlers or new colour tokens.

**Acceptance:** Given create/edit/delete and imported-event fixtures, when the tutor uses the dialog at desktop, 320px and 200% zoom, then all 23 design acceptance criteria remain true, axe labels/descriptions/live regions pass, and no delete path exists outside the event dialog.

### 6. Verification and handoff gates

Run focused checks before the full suite:

- recurrence expansion tests for presets, Monday anchoring, multiple weekdays, interval weeks, singular/plural summaries, limits, and late-March/late-October Brussels DST;
- PGlite migration tests with non-empty data, exact `RETURN QUERY` types (`varchar`/`text` casts included), RLS/privileges, schedule-lock/no-overlap interplay, scope counts/splits/conflicts, and unaffected session requests;
- Supabase/memory adapter contract tests, row mapping, RPC arguments and error mapping;
- dialog/calendar-manager/component tests, including no list/Delete shortcut, focus restoration, scope Back/Escape, repeat indicators, responsive controls, and axe;
- then lint, typecheck, unit/component tests and build. Review the final diff for docs-only scope before implementation starts. Developer hands off evidence to QA and reviewer; reviewer focuses first on SQL privilege/search-path/atomicity, exact return types, optimistic concurrency, DST wall-clock preservation, privacy boundaries, and unaffected session-request behaviour.

## Definition of done

- The migration design is reviewed but not applied in this planning task; it has admin-only, empty-search-path RPCs, schedule locking, exact count results, caps/invariants, optimistic concurrency, and no session-overlap rejection.
- Pure Brussels recurrence expansion, ports, Supabase and memory adapters, and the UI match ADR 0013/design copy and preserve ICS/tutee behaviour.
- Focused migration, DST, adapter, component and axe tests plus the repository gates pass; branch/PR and squash-merge rules are respected.

## Risks and mitigations

- **DST drift:** one pure expansion function, `IsoDate` iteration, `wallTimeToInstant`, and transition fixtures; never use epoch-day arithmetic.
- **SQL result mismatch:** define named return columns once and cast `varchar`/`text` explicitly in every `RETURN QUERY`; test PGlite result field types.
- **Cross-feature regression:** use the existing schedule lock but do not add a trigger or alter session-request RPCs; prove accepted sessions still allow tutor event creation.
- **Partial series writes:** lock and insert/update/delete atomically; return counts only after the transaction succeeds.
- **Rule drift after “This event”:** treat `rule` as display-only, preserve the series link, and state that pattern changes require delete/recreate.
- **Privacy leakage:** series/rule/title remain admin-only; ICS and tutee projections never gain series metadata.