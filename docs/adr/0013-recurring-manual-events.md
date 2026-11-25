# ADR 0013 – Recurring manual events: data model, scope operations and recurrence UI

**Status**: Proposed (2026-11-25). Builds on ADR 0004 (calendar), 0005 (admin RLS), 0008/0009 (grid), 0010 (overlap integrity).

## Context
The tutor plays badminton most Tue/Wed/Thu evenings and must create such blocked time once, not one cell at a time. Owner decisions (final):

- **A.** Manual events on the grid can repeat, Google-Calendar "custom" style: every N weeks, on selected weekdays, with a **required end** (on date, or after N occurrences). **No "never".** Hard cap 12 months ahead, the same horizon as the `.ics` import (`ICS_EXPANSION_MONTHS`). Presets: does not repeat, every week on this weekday, every weekday, custom.
- **B.** Editing/deleting a repeating event asks *this event / this and following events / all events*.
- **C.** Deleting happens by clicking the event on the grid (dialog with Delete). The list below the calendar goes away. Imported `.ics` events stay view/delete-only.
- Hours 08:00–22:00 Brussels, 30-minute snap, DST-correct, native controls only, accepted sessions never block the tutor from creating events (ADR 0010).

### What exists today
- `calendar_events` stores **one row per occurrence**: `starts_at/ends_at timestamptz`, `source` (`manual|ics`), `external_id`, `updated_at` (optimistic concurrency, trigger). RLS: admin only.
- Recurring `.ics` events are **materialised at import**: `ical.js` expands the RRULE client-side in the browser (Brussels wall clock for floating times, `ICS_EXPANSION_MONTHS = 12`, `ICS_MAX_OCCURRENCES = 2000`) and each occurrence becomes a row with `external_id = UID#start`. There is **no RRULE, series or exception storage** in the database.
- `get_blocked_intervals`, `list_accepted_sessions_for_tutor` and the three overlap checks of the session-request RPCs (create request, decide, re-validate) all read `calendar_events` rows by `starts_at < to and ends_at > from`.
- The tutor page still renders an "Events this week" `EventList` (with per-row Delete) under the grid. It is the only list; it is removed by this ADR.

## Decision

### 1. Data model: keep materialised occurrences, add a thin series link
Recurrence is **expanded once, at creation, into ordinary `calendar_events` rows** (same model as `.ics`). A small `calendar_event_series` table groups them.

Options evaluated:

| | Materialised rows + series link (chosen) | RRULE series + exception/override rows, expanded on read |
|---|---|---|
| Correctness of overlap checks (ADR 0010) | Unchanged: every existing check, index and RPC keeps seeing rows | Each of `get_blocked_intervals`, the three request-RPC checks, the tutor listing and the tutee grid must expand rules in SQL; one missed site = a double booking |
| DST | Wall-clock expansion computed once; instants stored | Needs `at time zone` expansion in plpgsql and in TS, kept in sync forever |
| Scope operations | Plain `delete/update … where series_id = … and starts_at >= …` | Truncate rule (`UNTIL`), split into a new rule, add `EXDATE`/override rows; most complex part |
| RLS / privacy | Unchanged; tutees only get merged anonymous intervals | New table plus expansion inside security-definer functions |
| Performance | Rows are bounded: ≤ 7/week × ~52 = 364 per series; existing `(starts_at, ends_at)` index serves all reads | Per-read expansion cost on every tutee page view |
| Fit with existing system | Identical to `.ics` | Second recurrence model beside `.ics` |

Because every series must end and is capped at 12 months, nothing ever needs rolling re-materialisation (no cron, no "never" extension). Materialised rows win on correctness and blast radius; the cost is a few hundred rows per series, which is trivial for the Supabase free tier.

**Schema (migration `20261127000000_recurring_events.sql`, not applied by the architect):**
- `public.calendar_event_series(id uuid pk, rule jsonb not null, created_at timestamptz default now())`. `rule` = `{startDate, intervalWeeks 1..12, weekdays [1..7 ISO], startMinutes, endMinutes, end: {kind:'until', date} | {kind:'count', count}}`. It exists for the "Repeats …" summary in the dialog and for series splits; **the event rows are the source of truth**. No title in the series (titles stay on events, tutor-only anyway).
- `calendar_events.series_id uuid null references calendar_event_series(id) on delete cascade`, index `(series_id, starts_at)`. `source` stays `manual`; `external_id` stays null (the `(source, external_id)` unique is unaffected). `.ics` rows never get a `series_id`.
- RLS on the series table: admin only (`is_admin()`), `revoke all … from public, anon`; no tutee access. `get_blocked_intervals` and every session-request RPC are **unchanged**.

### 2. Expansion lives in one place: pure TypeScript in `core/domain`
`expandRecurrence(rule, today)` returns occurrence intervals. It uses `wallTimeToInstant(date, hour, minute, 'Europe/Brussels')` per local date, so the 08:00–22:00 wall time is preserved across DST (clock changes happen at 02:00–03:00, outside the open hours, so no occurrence can fall in a skipped or repeated hour and elapsed duration equals wall duration). Week anchor is the **Monday-based week of the start date** (Belgium); "every N weeks" counts from that week; the first occurrence is the first selected weekday on or after the start date. Date iteration is on `IsoDate` (calendar arithmetic), never on millisecond offsets.

The client sends the **rule plus the expanded occurrences**; the server does not re-expand. A SQL re-implementation would be a second recurrence engine to keep in parity; since only the admin can write, the server instead enforces **invariants** and rejects violations: each occurrence's Brussels local start/end is on one date, on the 30-minute grid, inside 08:00–22:00 (the existing `private.validate_session_range` style of check), starts not before today and not after today + 12 months, `ends_at > starts_at`, count between 2 and 400, title ≤ 200. The same limits are checked in the TS domain (validation messages) and the in-memory adapter.

### 3. Scope operations (atomic `security definer` RPCs, admin-checked, `search_path = ''`, revoked from `public, anon`)
All take `private.lock_schedule()` first (ADR 0010: every transaction that creates blocked events takes the schedule lock). They **never check for overlap with accepted sessions or other events**: creation is always allowed; a conflicting accepted session is simply shown on the grid and judged by the existing request RPCs.

- `create_calendar_series(rule, title, occurrences[])`: inserts the series and all rows in one transaction. Returns the events.
- `delete_calendar_event(id, scope)`: `this` deletes the row; `following` deletes rows of the same `series_id` with `starts_at >=` the clicked occurrence; `all` deletes every row of the series. A series left with no rows is deleted. Non-series events (including `.ics`) support `this` only and keep using `removeEvent`.
- `update_calendar_event(id, expected_updated_at, scope, changes)`: the clicked row's `updated_at` must match (existing optimistic rule → `conflict`); other rows in scope are last-writer-wins (single tutor). `changes` = optional `title`, optional `startMinutes/endMinutes` (and, for `this` only, a `date`).
  - `this`: updates the one row; it stays in the series (so later "following"/"all" still reach it).
  - `all`: applies the changed fields to every row of the series; time changes recompute each row's instants from its own Brussels local date plus the new minutes (so DST is right and individually moved dates are preserved). Series `rule` start/end minutes are updated.
  - `following`: **split**: a new series row (copy of the rule with new times, `startDate` = the clicked date) takes the rows from the clicked occurrence on (`update … set series_id`); the old series' rule end becomes the day before. Then the `all` logic runs on the moved rows.
- Date changes are only offered for `this event`. For `following`/`all` the date field is read-only (moving a whole series by dates is a pattern edit, out of scope).

**Editing the recurrence pattern itself** (days, interval, end) is **not** in this release: the scope choices cover title and time edits; to change the pattern the tutor deletes (this and following / all) and re-creates. Justification: pattern edits are the dominant complexity (re-expansion, orphaned/edited occurrences, end-date semantics) and the owner's need is create + delete + simple edits. The model leaves room: a later `following` pattern edit is "delete following + create new series".

### 4. Reads: tutor and tutee grids
- Tutor grid: `listEvents(range)` returns rows as today; `CalendarEvent` gains optional `seriesId`. The grid and `toGridBlock` need no recurrence logic. The dialog fetches the series rule on open (`getSeries(seriesId)`) for the "Repeats …" summary.
- Tutee grid: still `get_blocked_intervals` merged anonymous intervals; unchanged, so no title, series or count leaks (ADR 0004 §8).
- Overlap integrity (ADR 0010): unchanged; the schedule lock plus checks against rows still hold because recurrence is rows.

### 5. Ports and adapters
Extend `CalendarEventRepository` (no silent overloading of `addEvents`): `addSeries(draft)`, `getSeries(id)`, `removeEvent(id, scope = 'this')`, `updateEvent(event, expectedUpdatedAt, scope = 'this', changes?)`. A `RecurrenceScope = 'this' | 'following' | 'all'` type lives in `core/domain`. Supabase adapter calls the RPCs; in-memory adapter implements the same semantics with shared contract tests. `.ics` parser and import stay untouched.

### 6. Recurrence UI model
- **Create dialog** (existing `CalendarEventDialog`): a native `<select>` "Repeat" with *Does not repeat* (default), *Every week on {Tuesday}*, *Every weekday (Mon–Fri)*, *Custom…*. Any repeating choice reveals the **End** control (required): native radio group *On date* (`<input type="date">`, min = start date, max = today + 12 months) / *After N occurrences* (`<input type="number">`, 2–400). Presets fill the same rule structure; *Custom* additionally reveals "Repeat every N weeks" (`<input type="number">` 1–12) and a native checkbox group Mon–Sun (clicked weekday pre-checked, at least one required). There is no "Never" option.
- A live, text-only summary ("Repeats every week on Tue, Wed, Thu until 12 Mar 2027 · 17 events") uses the TS expansion; a validation message shows the latest allowed date when the end exceeds 12 months (no silent truncation).
- **Edit/Delete of a repeating event**: the dialog shows the summary. *Save* and *Delete* on a series event open a scope step with a native radio group (*This event* default, *This and following events*, *All events*) and Confirm/Cancel, reusing `Dialog`. Non-repeating manual events keep the current single-step save and `ConfirmDialog` delete. Imported events: details plus Delete (this event only); "Remove all imported events" remains in the import panel.
- **Remove the list below the grid** (decision C): delete the "Events this week" section, `EventList`, `deleteLabel` and their CSS/tests from `calendar-manager.tsx`; return focus to the "Week view" heading after a delete. Verify no delete path remains outside the grid dialog (the grid's `onDeleteBlock` shortcut, if still wired, must route to the same scope-aware flow or be removed per the 2026-11-24 "no custom keyboard machinery" decision). The "Nothing is blocked this week." note stays.
- Native controls only; no keyboard handlers beyond what the elements provide; all text in Brussels time.

## Consequences
- Series operations are three small RPCs plus pure TS; reads, RLS, the tutee projection and all overlap logic are untouched.
- The rule duplicated in `rule jsonb` can drift from rows after a "this event" edit; it is display-only and the summary says "Repeats …" for the series, not per row.
- One new migration; must be reviewed and applied with the usual approval, after the code lands behind the adapter.
- Per-series limit (400) and `.ics` limit (2000) are independent.

## Security and privacy requirements
- Admin-only tables/RPCs; each RPC checks `public.is_admin()` and raises `42501` otherwise; `search_path = ''`; no grants to `anon`.
- Tutees and tutee-facing RPCs never see series, rule, titles or counts.
- Tests: RLS/grant checks for the new table and RPCs; RPC invariants (hours, grid, horizon, cap, scope correctness, split, empty-series cleanup, stale `updated_at` conflict); TS expansion across both DST changes (late March, late October) and week-interval/multi-weekday cases; dialog accessibility (radio groups labelled, errors in `ErrorSummary`); removal of the list.

## Open questions
See the handoff `docs/handoffs/2026-11-25-recurring-events.md`.
