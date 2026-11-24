# Calendar click-to-create implementation plan

## Scope and governing decisions

Implement the interaction described in `docs/design/calendar-click-to-create.md`, ADR 0008, and ADR 0009. Keep the custom in-house grid, Brussels local-time rules, UTC persistence, tutor-only mutation policy, and a generic mode/strategy boundary for a future tutee request mode. Do not add FullCalendar or react-big-calendar. Do not apply a database migration as part of this planning task; the developer must create and test any required migration and obtain the normal migration approval before applying it.

The implementation should be delivered as small vertical slices. Every slice must keep the app buildable and add or update focused tests.

## Target module layout

Prefer the existing `src/features/calendar` folder until a second feature consumes the abstraction. Extract only genuinely generic code to `src/shared/calendar` (or an equivalent `src/shared/time-grid`) when the tutee strategy is introduced.

```text
src/features/calendar/
  calendar-manager.tsx                 # orchestration, load/mutate state, focus return
  calendar-view-model.ts               # existing week/day projection, extended as needed
  time-grid/
    time-grid-model.ts                 # pure types and selection/view-model functions
    time-grid-selection.ts             # pure snap, clip, overlap and gesture math
    selectable-time-grid.tsx           # generic responsive grid/list presentation
    time-grid.module.css               # token-only grid/selection/overlap styling
    time-grid.test.ts                  # component keyboard/pointer/responsive tests
    time-grid-selection.test.ts        # pure selection and drag tests
  calendar-event-dialog.tsx            # create/edit/imported details dialog
  calendar-event-form.ts                # pure form parsing/validation/view model
  calendar-event-dialog.test.tsx
  calendar-event-form.test.ts
  event-list.tsx                       # retain/update event list actions
  import-panel.tsx                     # retain; still tutor-only
  week-navigator.tsx                   # retain/update focus and announcements

src/core/ports/calendar-event-repository.ts
src/core/domain/calendar-event.ts
src/infrastructure/memory/in-memory-calendar-event-repository.ts
src/infrastructure/supabase/calendar-event-repository.ts
src/infrastructure/supabase/rows.ts
supabase/migrations/<timestamp>_calendar_event_versions.sql # developer creates only if approved
```

`SelectableTimeGrid` must consume a presentation model (`GridBlock`, day/cell models and labels), not Supabase rows or repository instances. Its mode/strategy interface should be explicit and narrow, for example:

```ts
export type TimeGridMode = 'tutor-create' | 'tutee-request';
export interface TimeGridStrategy {
  readonly mode: TimeGridMode;
  canSelect(range: LocalTimeRange): boolean;
  activateBlock(key: string): 'details' | 'request' | 'none';
}
```

The tutor strategy owns create/edit/delete commands outside the generic renderer. A future tutee strategy must receive only public availability states and must not receive event titles or IDs. Keep React state, pointer capture, focus restoration, and dialogs in components; keep all time arithmetic, validation, overlap layout, and gesture math in pure functions.

## Ordered implementation steps

### 1. Inventory and freeze the existing contracts

**Files:** `calendar-view-model.ts`, `week-view.tsx`, `week-table.tsx`, `day-list.tsx`, `calendar.module.css`, existing calendar tests.

- Preserve `DayModel`, `weekRange`, existing `Europe/Brussels` helpers, and the ICS import path.
- Record the current title limit (`MAX_TITLE_LENGTH`), UTC `CalendarEvent` shape, and the existing shared `Dialog`, `Field`, `TextInput`, `Button`, `ErrorSummary`, and `ConfirmDialog` APIs.
- Add characterization tests before replacing the old table: seven-day projection, closed intervals, event visibility, empty week, and loading/error states.

**Given** the existing calendar data and week range, **when** the new view model is built, **then** it produces the same event/closed-hour information and no title or ID is exposed in a future public/tutee projection.

### 2. Add pure time-grid and selection logic

**Files:** `time-grid/time-grid-model.ts`, `time-grid/time-grid-selection.ts`, their unit tests; reuse `local-time.ts` and `tutoring-hours.ts` rather than manual UTC offsets.

Implement and test:

- 30-minute snapping from a cell index or pointer coordinate, including exact boundaries and clamping.
- Conversion between local date/time and UTC through the existing timezone helpers, including a DST fixture.
- Same-day selection, pointer click-versus-drag threshold, pointer-capture range updates, and Escape cancellation.
- Clipping a range intersecting 08:00–22:00 and rejecting closed-only or cross-midnight ranges with the specified messages.
- Open/closed cell status and accessible labels.
- Overlap grouping and deterministic visual columns/offsets without merging events.
- Native semantics: event blocks remain buttons, normal Tab order is preserved, dialog Escape closes without saving, and form fields retain native keyboard behavior. No arrow-key cursor or roving-focus contract is implemented.

**Given** a pointer or keyboard gesture, **when** it is reduced by the pure model, **then** the result is a validated local range or an explicit inert/error outcome, never an implicit save. **Given** overlapping events, **when** laid out, **then** every event remains individually reachable.

### 3. Introduce the generic responsive grid presentation

**Files:** `selectable-time-grid.tsx`, `time-grid.module.css`, `week-view.tsx`, `week-table.tsx`, `day-list.tsx`, component tests.

- Replace the old read-only table/list body with the generic grid in tutor mode while retaining the existing navigator and import panel order.
- Desktop: semantic `role="grid"`, seven day columns, 30-minute open cells, visibly labelled inert closed areas, event buttons and overlap text.
- Mobile: one chronological day at a time with previous/next day controls and week-range label; full-width 44px cells and event buttons; no horizontal overflow at 320px/200% zoom.
- Use existing tokens only, visible focus, `aria-describedby`, `aria-busy`, one persistent polite status region, and alert/error semantics from the shared UI.
- Pointer handlers must use pointer capture only after intentional movement; a tap opens a default one-hour selection/dialog and never saves directly. Scrolling must win ambiguous touch gestures.
- Preserve native controls and return activation intents to the manager rather than calling a repository; do not implement a replacement keyboard cursor.

**Given** an empty open cell, **when** the tutor clicks/taps or presses Enter/Space, **then** a one-interval selection is shown and the dialog opens without persistence. **Given** a drag, **when** it ends, **then** a snapped same-day selection opens the same dialog. **Given** a closed cell, **when** focused, **then** it announces Closed and remains inert.

### 4. Build the shared event dialog and pure form validation

**Files:** `calendar-event-dialog.tsx`, `calendar-event-form.ts`, tests; use existing shared dialog/form components.

- Support create, manual edit, and imported details variants.
- Fields are title (optional), start, and end, explicitly labelled Brussels time; preserve the existing 200-character limit/counter.
- Snap dialog values to 30 minutes and apply the exact validation/clipping copy from the design. Keep values and focus on save failure; disable commands and set busy labels while saving.
- Imported events are read-only for title/time and expose delete/close only. Manual events expose edit/delete. Delete remains behind `ConfirmDialog`.
- Restore focus to the originating cell/event, or a sensible next event after deletion; announce created/updated/deleted outcomes.

**Given** an invalid or closed-only range, **when** the form is submitted, **then** it shows field errors and performs no repository call. **Given** a save failure, **when** the result returns, **then** the dialog remains open with the entered values and an actionable accessible error.

### 5. Add update capability with server-authoritative conflict handling

**Files:** `src/core/ports/calendar-event-repository.ts`, `calendar-event.ts`/row mapper as needed, both adapters, adapter tests, migration test, and (if needed) a new migration under `supabase/migrations`.

The current port has `listEvents`, `addEvents`, `removeEvent`, and `removeImportedEvents`; it has no update operation. Add an explicit operation, not an overload of `addEvents`, such as `updateEvent(event: CalendarEvent, expectedUpdatedAt: IsoDateTime): PortResult<CalendarEvent>`. Keep imported events out of edit commands in the UI.

Because the current `calendar_events` table has RLS that already allows confirmed admins to update rows but has no version column, a conflict-safe edit needs a migration: add `updated_at timestamptz not null default now()`, update it on every row update (trigger), and expose/map it in the repository response. The migration must preserve the existing admin-only RLS policy; do not weaken policy or expose event data to tutees. The Supabase adapter should issue a conditional update by `id` and expected version, select the updated row, map it through zod, and return a typed conflict/not-found result when zero rows are returned. The in-memory adapter must implement the same compare-and-update behavior for deterministic tests.

If the developer chooses a documented replace/RPC alternative instead, it must provide equivalent optimistic conflict detection, source protection, validation, and RLS tests; never silently accept last-write-wins.

Required tests:

- Port/adapters update title and times and preserve source/external ID.
- Invalid intervals/title lengths are rejected before I/O.
- Imported events cannot be updated through the tutor edit command.
- Missing IDs and stale versions return not-found/conflict and leave the stored row unchanged.
- Migration test covers `updated_at`, trigger/version behavior, admin update access, and non-admin denial; existing calendar RLS/privacy tests remain green.

**Given** two edits use the same event version, **when** the second reaches the backend, **then** it receives a conflict and the UI retains its values for review; no event is silently overwritten.

### 6. Wire tutor strategy and manager orchestration

**Files:** `calendar-manager.tsx`, `week-view.tsx`, `event-list.tsx`, `calendar-view-model.ts`, `import-panel.tsx` only where refresh callbacks require it; add manager/component tests.

- Create a tutor strategy/container that maps selected ranges to `NewCalendarEvent` and maps manual event activation to dialog mode.
- Keep load state behavior: initial loading copy, previous grid with `aria-busy` during navigation, retry/error/forbidden states, and refresh after successful mutation/import.
- Remove the old below-calendar manual form from the page. The ICS import panel remains below `Events this week` and remains tutor-only.
- Keep list event actions consistent with grid event actions; do not duplicate save validation in the list.

**Given** a confirmed create/update/delete, **when** the repository succeeds, **then** the dialog closes, the visible range refreshes, the mutation is announced, and focus returns correctly. **Given** a repository error, **when** it fails, **then** the correct save/conflict/delete message is shown without discarding input.

### 7. Remove superseded manual-form code and update tests

**Remove or replace:** `src/features/calendar/add-blocked-time-form.tsx`, `src/features/calendar/blocked-time-form.ts`, and `blocked-time-form.test.ts` once their validation is covered by `calendar-event-form` tests. Remove obsolete CSS selectors and old table/list tests only when their behavior is covered by the generic grid tests; retain useful characterization tests for view-model and import behavior.

**Change:** `calendar-page.test.tsx`, calendar a11y tests, event-list tests, and any fixtures that assume a manual form below the calendar. Add explicit assertions that the old `Add blocked time` form is absent, ICS import remains present, and tutee/public projections contain no private event titles/IDs.

### 8. Accessibility, responsive, and regression verification

Run focused Vitest/Testing Library tests, including `vitest-axe`, then the project lint, strict typecheck, full test suite, and production build. Test at 320px and 200% zoom, keyboard-only, reduced motion, pointer/touch, empty/loading/error/conflict states, overlap, DST, and focus restoration. Do a manual screen-reader/keyboard pass for the grid and dialogs. Update directly related design/README documentation only if implementation behavior or owner setup changes.

## Backend and migration decision

An update capability is required for manual edit. Existing Supabase RLS already grants `select/insert/update/delete` only to authenticated users satisfying `is_admin()`, so no RLS policy broadening is needed. The current schema lacks a version field, so the recommended implementation adds `updated_at` plus a trigger (or an equivalently safe conditional-update RPC) in a new migration to make the specified stale-edit conflict behavior real. The developer must write and test, but not apply, that migration in this task. No tutee-facing event read or write path may be added.

## Files to remove/change summary

- **Remove after replacement:** `add-blocked-time-form.tsx`, `blocked-time-form.ts`, `blocked-time-form.test.ts`, and obsolete manual-form CSS/tests.
- **Change:** `calendar-manager.tsx`, `week-view.tsx`, `week-table.tsx`, `day-list.tsx`, `calendar-view-model.ts`, `event-list.tsx`, `calendar.module.css`, calendar page/a11y tests, repository port/domain/row mapper, Supabase and memory adapters and their tests.
- **Retain:** `import-panel.tsx`, `week-navigator.tsx`, ICS parser/import flow, blocked-interval privacy path, shared dialog/form primitives, and existing RLS policy unless a migration adds only versioning.
- **Add:** pure time-grid modules, generic grid/dialog/form modules, component/unit tests, and a versioning migration only after implementation approval.

## Definition of done

1. All design acceptance criteria 1–9 pass, including desktop/mobile, pointer/touch, keyboard, overlap, error/conflict retention, focus restoration, axe/WCAG, and privacy boundaries.
2. Pure logic has deterministic unit coverage for snapping, clipping, timezone/DST, overlap, drag math, cursor movement, and validation; component tests cover all interaction states and dialogs.
3. Tutor create/edit/delete uses the repository port; imported events are view/delete-only; no old manual form remains; ICS import still works.
4. Supabase and memory adapters agree on validation, update, conflict, not-found, and source behavior; migration tests prove RLS and versioning without applying the migration from this planning task.
5. `npm run lint`, strict typecheck, tests (including axe), and production build pass; formatting is clean; no new raw colors/tokens, secrets, or personal data are committed.
6. The developer, QA, and reviewer handoffs record test results and any migration/deployment approval status. Branching/merge/deploy rules remain unchanged.

## Risks and mitigations

- **DST and local/UTC drift:** centralize conversion in existing helpers; fixed Brussels DST fixtures and never add offset arithmetic.
- **Pointer capture versus scrolling:** intentional movement threshold, pointer capture only after commitment, tap fallback, and mobile tests.
- **Keyboard/focus regressions:** native buttons, focus-return tests, and a manual Tab/dialog/form keyboard pass.
- **Overlapping events becoming hidden:** deterministic layout plus visible/accessible overlap count and individual event buttons.
- **Stale edits or accidental overwrite:** versioned conditional update and conflict-preserving dialog; backend remains authoritative.
- **Imported event mutation/privacy:** explicit source discriminator, read-only imported dialog, RLS regression tests, and public projection tests.
- **Large component scope:** vertical slices and pure logic first; avoid extracting to `src/shared` until a second consumer exists.
- **Migration/deployment drift:** migration is reviewed and tested locally, never applied implicitly by the developer; record application separately in the handoff.

## Owner amendment (2026-11-24)

The final owner decisions supersede conflicting steps above: free intervals render with no text/label; only non-free intervals are blocks. The tutee availability path uses anonymous intervals from `get_blocked_intervals`, maps them to read-only blocked `GridBlock`s, and reuses `SelectableTimeGrid` without selection or mutation. Tutee blocks use accessible diagonal striping (`Not available`) with a `prefers-contrast: more` fallback and no private titles/IDs. Reserve a future distinct non-striped `busy` kind for the tutee’s own sessions/requests. Remove `time-grid-keyboard.ts`, its wiring/tests/docs, and the custom cursor/roving-focus behavior; retain native buttons, Tab, dialog Escape, and form-field semantics.
