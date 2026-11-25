# 2026-11-25 Recurring blocked events

## Owner decisions
- Manual grid events can repeat: every N weeks on selected weekdays; end required (on date / after N occurrences); no "never"; max 12 months ahead. Presets: does not repeat, every week on this weekday, every weekday, custom.
- Edit/delete of repeating events asks this / this and following / all.
- Delete only via the grid dialog; the list below the calendar is removed; imported `.ics` events stay view/delete-only.
- 08:00–22:00 Brussels, 30-min snap, DST-correct, native controls only, accepted sessions never block event creation.

## Architect – PASS
- **Summary**: Keep the existing model: recurrence is expanded once at creation into ordinary `calendar_events` rows (as `.ics` already is; no RRULE storage exists), linked by a thin `calendar_event_series` table (`series_id`, display-only `rule jsonb`). `get_blocked_intervals`, tutee grid, RLS and all ADR 0010 overlap checks stay unchanged. Expansion is a single pure TS function in Brussels wall-clock time; the server validates invariants (hours, grid, horizon, cap 400) rather than re-expanding. Scope ops are admin-only atomic RPCs under the schedule lock (this = one row; following = split series; all = whole series). Pattern editing is deferred (delete + recreate). The "Events this week" list still exists in `calendar-manager.tsx` and is to be removed.
- **Artifacts**: `docs/adr/0013-recurring-manual-events.md` (Proposed).
- **Constraints / risks**: Migration `20261127000000_recurring_events.sql` must not be applied without review. Never overlap-check events against sessions at creation. Iterate on `IsoDate`, not ms. Series rule can drift after a "this event" edit (display only). The grid `onDeleteBlock` path must use the scope-aware flow or be removed. Extend ports explicitly (`addSeries`, `getSeries`, scope params); keep in-memory adapter in parity. Tests: DST (March/October), multi-weekday + N-week intervals, 12-month cap, RPC scope/split/conflict, RLS, a11y of radio/checkbox groups.
- **Open questions**: see below.

### OPEN QUESTIONS (product behaviour)
1. **Default end for a new repeating event?** Recommended default: "On date" pre-filled to 3 months after the start date (never beyond the 12-month cap); the tutor can change it.
2. **Do "All events" delete/edit also touch past occurrences?** Recommended default: yes, the whole series, like Google Calendar.
3. **When changing time/title for "All" or "This and following", should it overwrite occurrences the tutor edited individually?** Recommended default: yes for the fields changed in this edit only (title/time); individually moved dates are kept.
4. **May the tutor change the repeat pattern (days, interval, end) of an existing series?** Recommended default: not in this release; delete this-and-following/all and create a new one.
5. **If "After N occurrences" would run past 12 months, what happens?** Recommended default: show an error with the latest allowed date and let the tutor adjust, never silently shorten.

## UI/UX Designer – PASS
- **Summary**: Spec in `docs/design/recurring-events.md`. Create dialog gets a native **Repeat** select (Does not repeat / Every week on {day} / Every weekday / Custom…); Custom is an **inline section** (interval 1–12, Mon–Sun checkboxes), not a sub-dialog. Required **Ends** radio group (On date, pre-filled start + 3 months, max 12 months / After N events, 2–400) with an exact error naming the latest allowed date, no "never". A generated summary sentence (`Weekly on Tue, Wed, Thu until 28 Feb 2027 (34 events)`) is shown in create and (read-only, `Repeats: …`) in edit. Edit/Delete on a repeating event show a **scope step in the same dialog** (This event / This and following events / All events, with hints, All includes past). Date change is only allowed for "This event"; the pattern is read-only. Repeating events get a `↻` glyph plus "repeats" in the accessible name (mobile: `Repeats` line). The "Events this week" list is removed; deletion only via the event dialog.
- **Decisions made**: imported `.ics` events get **no** scope choice (delete this event only; "Remove all imported events" stays in the import panel); scope step is a view swap, not a stacked dialog; series-summary load failure falls back to "This event" only; stale/gone copy added.
- **Artifacts**: `docs/design/recurring-events.md` (23 numbered acceptance criteria).
- **Constraints / risks**: No new tokens or components beyond a weekday chip style and the glyph. Native controls only; the summary uses polite live updates on change only. Remove the grid `Delete`-key shortcut. Focus after delete goes to the "Week view" heading. Count of events in the summary must equal events created (same expansion function).
- **Open questions**: none. Tech-lead: confirm the `Saving…`/`Deleting…` button labels and count-based status messages (`{n} events created.`) need the RPCs to return counts.
- **Next**: hand off to `tech-lead`.
## Tech Lead

- **PASS — implementation plan:** `docs/design/recurring-events-plan.md` turns ADR 0013 and the UI specification into ordered domain, migration, adapter, UI, and verification steps.
- The next migration is fixed as `20261127000000_recurring_events.sql`; it is designed for review only and must not be applied during this docs phase. Its admin-only, `search_path = ''` RPCs use the existing schedule lock, return typed occurrence/affected counts, preserve optimistic `updated_at`, and deliberately do not reject events over accepted sessions or alter session-request RPCs.
- Implement recurrence expansion once in pure TypeScript using Brussels `IsoDate` wall-clock conversion, with late-March and late-October DST fixtures. Extend both adapters and remove the calendar list/Delete shortcut only after the port and migration contract tests are in place.
- Existing service-role grants already cover the Edge Function's session request/outbox reads; no new recurring-series grant is needed. QA/reviewer should verify exact `RETURN QUERY` types (especially `varchar` versus `text`), RLS/search-path/atomicity, counts, DST, and session-request non-regression.

## Developer (backend)

- **Done:**
  - `src/core/domain/recurrence.ts`: pure Brussels wall-clock expansion and validation, with DST tests for the last Sundays of March and October. The end kind is `'until'` or `'count'`.
  - Migration `20261127000000_recurring_events.sql`, written only and not applied or pushed. It adds `calendar_event_series` with admin-only RLS and `calendar_events.series_id`. The three RPCs are `create_calendar_series`, `update_calendar_event` and `delete_calendar_event`: admin-only, security definer, `search_path = ''`, exact `RETURN TABLE` types, `private.lock_schedule()`, caps of 12 months and 400 occurrences, hours and 30-minute grid checks, `updated_at` concurrency, scopes this, following and all (following splits the series), and counts returned.
  - ICS events and session-request overlap behaviour are unchanged. There are no overlap checks for series.
  - Port: `addSeries`, `getSeries`, and `updateEvent`/`removeEvent` with a scope and counts. `eventChangesOf` derives Brussels wall-clock changes from an edited event.
  - In-memory and Supabase adapters, with `40001` mapped to `conflict` and `P0002` to `not-found`.
  - Tests: PGlite migration tests with non-empty data for every RPC and rule, plus memory and Supabase adapter tests.
  - All gates are green: lint, prettier, typecheck, test and build.
- **Remaining for the UI:**
  - Repeat, Ends and Custom fieldsets in the create dialog, using `expandRecurrence` and `validateRecurrence`, then `addSeries`.
  - The scope step in edit and delete, wired to `updateEvent` and `removeEvent` with a scope. Date edits are allowed only for scope `this`.
  - `{n} events created`, updated and deleted messages from the returned counts.
  - Fetch the series rule with `getSeries` for the summary.
  - Repeat indicator and accessible name.
  - Remove the events list and the grid Delete shortcut.
- **Review before applying:**
  - The migration needs review and apply approval.
  - `update_calendar_event` rebuilds times from Brussels wall-clock values, so an edit keeps an event's day span but cannot change a multi-day end date.

## Developer (UI)

- **Done:** the full UI half, with no stubs.
  - Create dialog: Repeat select, inline Custom section, required Ends group and polite summary (`repeat-form.ts`, `repeat-fields.tsx`, `calendar-event-dialog.tsx`).
  - Edit and delete of repeating events go through a scope step (`scope-step.tsx`). The pattern is read-only (`use-series-details.ts` loads it, with retry).
  - Imported events are view and delete only.
  - Count messages come from the RPC results (`calendar-manager.tsx`).
  - Repeat glyph and accessible name `repeats` on the grid, and a `Repeats` line on mobile.
  - Removed: `EventList`, the "Events this week" section, `onDeleteBlock` and the grid Delete-key shortcut.
  - `recurrence.ts` now gives field-level problems (`recurrenceProblem`) and formatted dates in messages. `Dialog` gained `titleRef`.
- **Tests:** `repeat-form.test.ts` (pure logic), `repeating-events.test.tsx` (create, custom, scope, delete, imported, list removed, with axe), `repeating-events-mobile.test.tsx` (mobile with axe), and updated page, manager and a11y tests. Lint, prettier, typecheck, test (1012) and build pass.
- **Criteria** (tests are in `src/features/calendar/`):
  - [x] 1 Repeat options and weekday label: `repeat-form.test.ts` (options), `repeating-events.test.tsx` (select).
  - [x] 2 No End fieldset, Custom section or summary without repeat; the single event is still created (`repeating-events.test.tsx`, `calendar-page.test.tsx`).
  - [x] 3 Ends group, no "never", On date pre-selected at +3 months and capped (`repeat-form.test.ts`); `min` and `max` are set in `repeat-fields.tsx`.
  - [x] 4 Custom: interval, 7 checkboxes with one pre-checked (test); "Choose at least one day." (`repeat-form.test.ts`).
  - [x] 5 Summary text and count (`repeat-form.test.ts`, `recurrence.test.ts`); the created count matches (the "4 events created." test).
  - [x] 6 End date messages with the latest date (`repeat-form.test.ts`).
  - [x] 7 Count 2 to 400 and the 12-month error (`repeat-form.test.ts`, component test).
  - [x] 8 Created announcement and dialog closes (test); focus returns to the cell via the existing manager test; the failure copy keeps the values because the form is not reset.
  - [x] 9 Glyph, `repeats` name and the mobile `Repeats` line (grid and mobile tests); imported and non-repeating blocks have none.
  - [x] 10 Edit shows `Repeats: …` and the hint, with no repeat controls (test).
  - [x] 11 Scope step with *This event* selected, or `Nothing has changed.` (tests).
  - [x] 12 Scope step for delete, and the plain confirmation for non-repeating events (tests).
  - [x] 13 Hints in `scope-step.tsx`; *All events* update and *This and following* delete are tested. Past-event fixtures are covered by the in-memory adapter and migration tests, not by UI tests.
  - [x] 14 Disabled scopes with the hint (test); changed-only writes via `changesBetween`, with adapter tests for preservation.
  - [x] 15 Count announcement and focus to the Week view heading after delete (tests); focus to the event after edit uses the existing return-focus behaviour.
  - [x] 16 Back keeps values and Escape closes without saving (test).
  - [x] 17 Imported dialog with only Delete and Close, and the plain confirmation (test).
  - [x] 18 List, row Delete buttons and Delete key removed (tests).
  - [x] 19 Error, conflict, gone and details-failed copy implemented in `calendar-manager.tsx` and `calendar-event-dialog.tsx`; busy sets `aria-busy` and disables controls. The conflict and gone paths are tested via the existing conflict test and the gone test.
  - [ ] 20 320px and 200% zoom: CSS is mobile-first (wrapping chips, stacked full-width actions). jsdom cannot measure it, so it needs a manual or QA check.
  - [x] 21 Axe passes for create, custom, scope, mobile and the grid with the list removed; the scope heading receives focus.
  - [x] 22 Tutee projection untouched (`availability-page.test.tsx`).
  - [x] 23 DST in `recurrence.test.ts` (last Sundays of March and October).
- **Not met or not verified:** criterion 20 (manual). The focus-after-edit path for a repeating event reuses the non-repeating behaviour and has no dedicated test. The form shows the first repeat problem only, one at a time.
- **Try locally:** `npm run dev` (the in-memory services when no Supabase env is set). Open Calendar as tutor, go to next week, click a cell, choose Repeat, then create. Click an event to edit it or delete it through the scope step. The migration is still unapplied and needs review before the real backend works.

## QA

- **Verdict: PASS** (accepted risks below).
- **Checks:** lint, `prettier --end-of-line auto --check .`, typecheck, build and all tests pass (71 files, 1013 tests).
- **Migration (read line by line):** admin-only (`is_admin()` first, 42501), `security definer`, `search_path = ''`, revoke from `public, anon`, grant to `authenticated`, private helpers revoked. The series table is select-only for the admin, with RLS. Types, hours (08:00-22:00), the 30-minute grid, caps (2 to 400, 12-month horizon), the schedule lock and the clicked-row version check (to the millisecond) are correct. The three scopes, the "this and following" split, counts and the empty-series cleanup are correct. The tutee projection, ICS and session requests are untouched.
- **Domain hunt:** DST (last Sundays of March and October), weekday selection across weeks, interval above 1, caps, past dates, end date beyond 12 months and "edit one, then all" are covered and correct.
- **Fixes:** the flaky `compares the version to the millisecond` test (it used the old version plus 1 ms, which could equal the new `updated_at`; it now uses minus 1 ms). Added a migration re-run idempotency test.
- **Accepted risks:** criterion 20 (320px and 200% zoom) is not verifiable in jsdom and needs a manual check. A multi-day end date cannot be edited, as already documented. The migration is not applied. `git status` shows the migration as modified only because of CRLF (`autocrlf`), with no content diff.

## Developer rework

- **Stable order:** `calendar_events.series_index` (0..n-1, chronological at creation, check that it is set exactly when `series_id` is set, deferrable unique per series). "This and following" (update split and delete) now selects and splits by `series_index`, not `starts_at`, so an occurrence moved with "this event" keeps its place. A split keeps the indexes (monotonic in the new series). Rules after a split or "following" delete are derived from the real remaining/moved dates (start = earliest, end = latest) instead of clicked date - 1. Domain `CalendarEvent.seriesIndex`, row mapping, the Supabase column list and the in-memory adapter follow the same order.
- **Rule validation:** `private.assert_series_rule_matches` runs in `create_calendar_series`: start date from today to the horizon and not after the first occurrence; end date not before the start date, not before the last occurrence and not past the horizon; after-N equal to the occurrence count. Rejections are `22023` (mapped to the existing validation error). Mirrored client-side by `ruleOccurrenceProblem` in the in-memory adapter.
- **Copy:** the pending-delete failure now reads `We couldn't delete this event. Check your connection and try again.`
- **Tests:** PGlite (moved occurrence then "following" on an earlier and a later one, delete following, index numbering and check, 8 rule rejections), in-memory adapter (same scenarios, mismatched rule), `ruleOccurrenceProblem`, row mapping, delete copy.
- **Still not applied:** the migration was edited in place and is not applied or pushed.
