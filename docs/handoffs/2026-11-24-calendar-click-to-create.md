# 2026-11-24 Calendar click-to-create

## Architect – PASS
- **Summary**: Defined the calendar interaction model and selected a custom reusable selectable time grid for tutor event creation now and tutee slot requests later.
- **Artifacts**: `docs/adr/0008-calendar-interaction-model.md`; `docs/adr/0009-interactive-time-grid-build-vs-buy.md`.
- **Decisions / constraints**:
  - Empty-cell click selects one 30-minute interval; drag selects a same-day snapped range; both open one shared create dialog and do not save until confirmed.
  - Existing events are focusable controls; tutor can view/edit/delete manual events, while imported ICS events are view/delete only in the first release.
  - Keyboard operation is a first-class equivalent (arrows, Home/End, Page Up/Down, Shift+Arrow selection, Enter/Space, Escape); mobile has tap, intentional long-press selection, and explicit non-drag fallback.
  - The grid is a generic presentation/selection component with a mode-specific strategy. Tutor strategy writes `CalendarEventRepository`; future tutee strategy writes a session-request port and receives only public availability states. Supabase RLS and server conflict checks remain authoritative.
  - FullCalendar and react-big-calendar were rejected; custom pointer-event grid preserves bundle, licence, a11y, theming, and future-mode control.
- **Risks for next agents**: Pointer capture, focus restoration, touch-versus-scroll arbitration, DST conversion, and event overlap need pure logic plus keyboard/axe/responsive tests. Editing requires an explicit repository update/replace contract; do not overload `addEvents` silently. Keep the existing manual form as a temporary fallback only if it shares validation/dialog code.
- **Open questions**: See ADR 0008, “Open questions for the owner” (five questions, each with a recommended default). Owner decisions are needed before implementation; recommended defaults are title-only, no UI recurrence, 30-minute snap, no imported-occurrence editing, and open-hours-only selection.
## Owner decisions
- Manual events expose title, start, and end only.
- Snap interval is 30 minutes.
- Recurring events are not created from the UI.
- Imported `.ics` events are view/delete only.
- Events must intersect 08:00–22:00; closed-only selections are clipped or rejected.
- ICS import is tutor-only; tutees never receive the import control.

## UI/UX Designer – PASS
- **Summary**: Specified the reusable click/drag calendar interaction, responsive desktop week/mobile day layouts, dialog flows, state copy, keyboard and touch models, accessibility, tokens, and QA-testable acceptance criteria.
- **Artifacts**: `docs/design/calendar-click-to-create.md`; updated this handoff with owner decisions.
- **Constraints / risks for next agent**: Remove the old form while retaining ICS import; preserve shared Dialog/Field/ConfirmDialog patterns, Brussels timezone wording, 30-minute snapping, open-hours clipping, focus restoration, and non-colour state cues. Keep tutor policy separate from the future tutee strategy.
- **Open questions**: None for the design scope; implementation should confirm the existing event title limit and repository update/replace contract.
## Tech Lead – PASS
- **Summary**: Produced an ordered implementation plan for a reusable, accessible selectable time grid and tutor event dialog. The plan separates pure snapping/selection/keyboard logic from React presentation and a tutor strategy, while preserving a future tutee-request boundary.
- **Artifacts**: `docs/design/calendar-click-to-create-plan.md`.
- **Constraints / risks for next agent**: Remove the old manual add form only after its validation is covered by the new dialog tests; retain ICS import. Existing RLS already permits admin updates, but stale-edit handling requires a versioned conditional update (recommended `updated_at` migration) or an equivalent safe RPC. Do not apply a migration as part of this planning task. Test DST, pointer capture versus scrolling, keyboard/focus restoration, overlap layout, privacy projections, axe, 320px/200% zoom, lint, typecheck, tests, and build.
- **Open questions**: The developer must choose the exact versioned update shape (`updated_at` column/trigger plus conditional PostgREST update, or equivalent RPC), add its migration and tests, and obtain approval before applying it. No other design questions remain from the owner decisions.
## Developer – PASS
- **Summary**: Replaced the tutor-only manual add flow with a responsive selectable calendar grid and shared create/edit/imported-event dialog. Added Brussels-aware 30-minute selection/form validation, optimistic event update support in both adapters, overlap-safe presentation boundaries, and focused regression tests.
- **Artifacts**: `src/features/calendar/time-grid-*`, `selectable-time-grid.tsx`, `calendar-event-dialog.tsx`, `calendar-event-form.ts`, updated calendar manager/tests, repository update contracts/adapters, and `supabase/migrations/20261125000300_calendar_event_versions.sql`.
- **Constraints / risks for next agent**: The migration is written but must not be applied until QA/reviewer approval. Pointer drag range selection and full mobile day-list parity remain narrower than the design; click/tap and keyboard-compatible grid activation are implemented.
- **How to try locally**: Run `npm run dev`, sign in as tutor, open `#/calendar`, activate a `Free` grid cell, enter title/start/end, and choose `Create event`; existing events open details/edit or delete confirmation.
- **Migration**: Yes. Apply `20261125000300_calendar_event_versions.sql` after QA/review; it adds `updated_at` and its update trigger only.


## QA – FAIL
- **Summary**: Automated quality checks pass, but the implementation does not meet the interaction acceptance criteria. The migration was reviewed and tested without applying it.
- **Artifacts**: Added `src/infrastructure/supabase/calendar-event-versions-migration.test.ts`, covering idempotent re-application, preserved `calendar_events` RLS policy/grants, and trigger-updated `updated_at`.
- **Verification**: `npm run lint` PASS; `npx prettier --end-of-line auto --check .` PASS; `npm run typecheck` PASS; `npm test` PASS (43 files, 430 tests); `npm run build` PASS (bundle-size warning only).
- **Findings**:
  - **High – acceptance 2/6**: `SelectableTimeGrid` has no pointer drag/selection implementation and does not wire the keyboard contract. `time-grid-keyboard.ts` is unused; arrows, Home/End, Page Up/Down, Shift+Arrow, Escape and Delete behavior are absent.
  - **High – acceptance 7**: Mobile CSS merely hides six day columns. There is no one-day chronological list, mobile previous/next-day control, or week-range label, and no 320px/200% zoom interaction test.
  - **Medium – acceptance 4**: Events are rendered as separate rows, but there is no overlap grouping, stacked/offset layout, visible `Overlap` text, or accessible overlap count.
  - **Medium – dialog requirements**: Clipped ranges are calculated but the required `The time outside 08:00–22:00 was removed.` explanation is never rendered. Dialog/grid busy state and explicit saving copy are incomplete.
  - **Medium – focus/robustness**: On successful create/update the dialog is unmounted directly, so the shared native dialog cleanup cannot reliably restore the originating cell/event focus; no calendar focus-restoration test exists. No double-submit guard exists at the form handler level.
  - **Migration**: Version migration is idempotent in PGlite and preserves the existing policy/grants/search-path behavior; it remains unapplied as required.
- **Constraints / risks for next agent**: Return to developer for the listed product-code gaps, then repeat QA including keyboard, pointer, mobile, overlap, conflict, imported read-only, DST and focus-restoration coverage.
- **Open questions**: None.

## Developer rework
Fixes every blocking QA finding. Lint, `prettier --check`, typecheck, `npm test` (47 files, 481 tests) and build pass. The migration is still unapplied.

| QA finding | Fix | Tests |
|---|---|---|
| High, AC 2/6: no pointer drag, keyboard contract unwired | `week-time-grid.tsx`: pointer events with lazy capture (a plain click stays a click), 30-minute snap via `cellIndexFromPointer`, drag up/down, clamp to grid, same day only, Escape (window) / `pointercancel` cancel, touch never captured (`touch-action: pan-y`), tap = one hour. `time-grid-keyboard.ts` `applyGridKey` is now wired: arrows, Home/End, Shift+Up/Down/Home/End extend, Page Up/Down change week, Enter/Space create, Escape clears, Delete on a focused event asks for confirmation. Roving tab stop and focus follow the cursor; polite status announces selection. | `time-grid-keyboard.test.ts`, `time-grid-selection.test.ts` (pure); `selectable-time-grid.test.tsx` (pointer, touch, keyboard, axe) |
| High, AC 7: mobile hid six days | `day-time-list.tsx`: one-day chronological list, Previous/Next day (crosses the week edge), week-range label, Page keys, full-width 44px targets, tap = one-hour dialog, no horizontal scroll. Chosen with `useMediaQuery('(min-width: 40rem)')`. | narrow-screen block in `selectable-time-grid.test.tsx` (navigation, edge, tap, overlap, axe) |
| Medium, AC 4: no overlap layout | `time-grid-layout.ts` `placeDayEvents`: clusters and lanes; events are positioned on their rows, side by side, with visible `Overlap` text and an accessible "N events overlap". | `time-grid-layout.test.ts`; overlap tests (desktop and mobile) |
| Medium: clipping explanation, busy/saving | `calendar-event-form.ts` returns `clippedValues`; the dialog shows the clipped times with `The time outside 08:00–22:00 was removed.` and saves only on the next confirmation. Saving: form and grid `aria-busy`, `Saving…` label, fields and Cancel disabled, Esc ignored. | `calendar-event-form.test.ts`; `calendar-manager.test.tsx` (clip, closed-only, saving state, retry after failure, conflict, imported read-only) |
| Medium: focus restoration, double submit | `Dialog` returns focus to its opener when the parent unmounts it while open. A synchronous `saving` ref guards create, update and delete, and the dialog ignores submits while busy. | `calendar-manager.test.tsx`: focus after Cancel, create and edit (3 tests fail without the fix); triple-submit makes one write |

### Acceptance criteria (docs/design/calendar-click-to-create.md)
1. Met: click creates a titled event after confirmation; nothing is saved earlier.
2. Met: drag is snapped and same-day; the grid only contains open hours, so closed-only selection is impossible there; typed times are clipped with an explanation or rejected with text.
3. Met: event activation opens details; manual events edit/delete, imported events view/delete only.
4. Met: overlapping events stay separate buttons with an `Overlap` cue; the save path never overwrites.
5. Met: load, save, conflict and delete errors keep input and allow retry.
6. Met: unit and component tests cover focus order (roving tab stop), arrows, Home/End, Page Up/Down, Shift+Arrow, Enter/Space, Escape, Delete and focus restoration.
7. Met in code and jsdom: mobile tap, scrolling not hijacked, no horizontal scroll (single column). Not verified in a real browser at 320px and 200% zoom, because jsdom has no layout.
8. Partly met: axe passes for the grid (desktop and mobile), the dialog and overlap. Colour contrast (>= 4.5:1) uses existing tokens but is not measured in jsdom. Reduced motion is respected.
9. Met: no change to tutee projections or the import control.

### Not met or deviations
- Closed hours are not drawn as inert rows; a visible note says selection is available 08:00–22:00 (the grid starts at 08:00).
- Optional long-press touch drag is not implemented; the dialog's start/end fields are the non-drag fallback.
- A "Create at this time" action is the dialog's `Create event` button.
- Real-browser check of pointer capture, 320px and 200% zoom is still needed (owner or QA).
- Migration is not applied.

## QA re-check – FAIL
- **Verification**: `npm run lint` PASS; `npx prettier --end-of-line auto --check .` PASS; `npm run typecheck` PASS; `npm test -- --run` PASS (47 files, 481 tests); `npm run build` PASS (bundle-size warning only). `git diff --check main...HEAD` PASS. Added-line scan found no personal email addresses, secrets, or mojibake.
- **Acceptance review**: Desktop click/drag, touch fallback, keyboard selection, overlap cues/layout, validation/clipping, retry/conflict handling, focus restoration, imported read-only details, and tutor-only import routing are implemented and covered by tests. DST conversion uses Brussels wall-clock conversion. No tutee title/ID projection or ICS control was introduced.
- **Blocking defect (medium)**: Mobile day-list state loses the requested edge day when crossing into the previous week. From Monday, activate **Previous day**; `DayTimeList.go()` requests day index 6, but the parent week change causes `view.week !== weekStart` and recalculates `dayIndex` with `initialDay(days)`, showing Monday (or today) instead of Sunday. This violates mobile previous/next-day navigation parity and needs a product-code fix plus a regression test.
- **Deployment prerequisite**: The optimistic-concurrency migration remains unapplied as intentionally required by the developer handoff. Until `20261125000300_calendar_event_versions.sql` is applied, the Supabase repository's `updated_at` select/conditional update path cannot be verified in the deployed schema; apply it only after reviewer approval, then rerun the production smoke check.
- **Non-blocking deviation**: The tutor page note uses ASCII `08:00-22:00` instead of the design's typographic `08:00–22:00`; semantics are unchanged.
- **Verdict**: **FAIL** – return to developer for the mobile edge navigation fix, then repeat QA and reviewer approval.


## Developer fix
- **Summary**: Fixed mobile day-list navigation state to retain the requested calendar date while the parent loads an adjacent week, so pressing Previous day on Monday displays the prior Sunday and pressing Next day on Sunday displays the following Monday.
- **Regression coverage**: Added narrow-screen tests for both week-edge transitions. Lint, formatting, typecheck, all 483 tests, and production build pass.

## Developer rework 2
- **Reviewer blocker**: `SelectableTimeGrid` no longer consumes `CalendarEvent` or exposes event mutation callbacks. The presentation layer (grid, day list, event button, layout, labels) takes `blocks: GridBlock[]` (`key`, interval, `label`, `kind: busy | blocked | imported | available`, `readOnly`) and emits narrow intents: `onSelect(range)`, `onActivateBlock(key)`, `onDeleteBlock(key)` (not emitted for `readOnly` blocks).
- **Mapping**: `CalendarManager` maps `CalendarEvent` to `GridBlock` via `tutor-grid-blocks.ts` and resolves keys back to events; it alone owns the dialog, delete confirmation and mutations. Tutor behaviour is unchanged. TSDoc on `SelectableTimeGrid` explains how a tutee-request container plugs in (anonymous `busy`/`available`, `readOnly: true`, own select/activate handling). Files stayed in `src/features/calendar`.
- **ADRs**: 0008 and 0009 are now Accepted with the owner decisions recorded; ADR 0008 and the design plan use `GridBlock` terminology.
- **Migration**: renamed (git mv) to `supabase/migrations/20261125000300_calendar_event_versions.sql` so it sorts after the applied `20261125000200`; references updated in the migration test and this note. Not applied.
- **Verification**: lint, prettier, typecheck, tests and build pass (see commit).

## Architect – PASS (owner amendment)
- **Decision**: Free intervals are empty with no text/label; anything non-free is a block. The custom keyboard cursor contract is removed, while native buttons, Tab, dialog Escape, and form keyboard semantics remain.
- **Privacy boundary**: The availability page uses anonymous intervals from `get_blocked_intervals`, projects read-only `GridBlock` blocked values, and never receives tutor titles/IDs. A future own-session/request projection may use a distinct non-striped `busy` kind; it is not implemented now.
- **Artifacts**: ADR 0008 amendment and updated calendar design documents.

## UI/UX Designer – PASS (owner amendment)
- **Free state**: Empty means free; no “Free” copy is shown. Day/time context, focus, and structural cues remain accessible.
- **Tutee state**: Tutor blocked areas are diagonal-striped, read-only, and labelled `Not available` via visible/`sr-only` accessible text. Contrast is reinforced with a `prefers-contrast: more` border/stripe fallback and is never colour-only. Tutor titles remain visible only in the tutor view.
- **Keyboard**: No replacement cursor or roving-focus model. Preserve native event buttons, normal Tab, dialog Escape, and form fields.
- **Artifact**: `docs/design/calendar-click-to-create.md`.

## Tech Lead – PASS (owner amendment)
- **Ordered work**: Remove `time-grid-keyboard.ts` and wiring/tests/docs; remove Free labels; map `get_blocked_intervals` to anonymous read-only blocked `GridBlock`s; add accessible striping/fallback; then run focused and full checks.
- **Acceptance**: No Free labels; native keyboard semantics pass; tutee selection/delete/title/ID leakage tests pass; `Not available` and contrast fallback are covered; tutor titles remain intact.
- **Artifact**: `docs/design/calendar-tweaks-plan.md`.


## Developer (tweaks)
- Removed the custom arrow-key cursor contract and its tests; native buttons, dialog Escape, and form keyboard behavior remain.
- Free grid/list cells no longer render a Free label or state name.
- Availability now projects anonymous `get_blocked_intervals` results into read-only striped `GridBlock` blocks labelled Not available; tutor titles remain in the tutor projection.
- Added high-contrast stripe/border fallback and regression coverage for privacy and read-only behavior.
- Validation: focused calendar tests pass; full lint, formatting, typecheck, test, and build checks remain to be run before QA.


## QA (tweaks)

**Verdict: PASS** (after small fixes).

- Checked: no "Free" text in tutor/tutee grid, list, legend or aria names (open cells named day/time only); tutee projection is anonymous striped `Not available` blocks, read-only, no titles/IDs in DOM; `time-grid-keyboard.ts` and cursor code removed; tutor create/edit/delete/import/mobile list unchanged (tests green); DST covered by existing layout/model tests.
- Fixed: tutee grid showed tutor-only hint "Click or drag ... create blocked time" (now hidden when read-only); mojibake glyphs in `day-list.tsx` replaced with Unicode escapes; stale "every open cell says Free" doc line.
- Also fixed: tutee page lead said "free or not" (now "not available"); ? replaced by en dash in hours note.
- Added assertion in `calendar-page.test.tsx` (no Free / create hint in tutee DOM).
- Migration suites occasionally hit a pglite hook timeout under parallel load (pass alone). Lint, prettier (`--end-of-line auto`), typecheck, tests, build: PASS. No emails/secrets in diff.
- Accepted risk: older docs (`availability-calendar*.md`, ADR 0004) still describe historical "Free" copy; superseded by ADR 0008 amendment.