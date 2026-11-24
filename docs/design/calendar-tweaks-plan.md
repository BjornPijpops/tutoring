# Calendar tweaks implementation plan

This plan applies the 2026-11-24 owner amendment to the existing calendar implementation. Keep the work small and sequential; do not add a calendar dependency or change persistence contracts.

## Ordered steps

1. **Remove the obsolete keyboard contract.** Delete `time-grid-keyboard.ts` and its tests; remove imports, cursor state, roving-focus logic, arrow/Home/End/Page/Shift selection behavior, and related documentation. Keep native buttons, normal Tab, dialog Escape, and form-field keyboard behavior.
2. **Make free time empty.** Remove visible and accessible “Free” labels from grid/list cells. Treat only non-free intervals as blocks; retain day/time context and clear focus/hover affordances. Update empty-state and interaction copy.
3. **Add the tutee projection.** Use the existing `get_blocked_intervals` RPC through the availability-page path. Map anonymous intervals to read-only `GridBlock` values with `kind: 'blocked'`; reuse `SelectableTimeGrid` in read-only/no-selection mode and do not pass titles or IDs. Keep tutor blocks titled. Reserve, but do not implement, a distinct non-striped `busy` kind for future own sessions/requests.
4. **Style and expose blocked areas.** Add diagonal striping for tutee blocked blocks, an `sr-only`/ARIA `Not available` label, adequate contrast, and a `prefers-contrast: more` fallback with stronger borders/stripes. Ensure stripes are supplemental, never the only state cue.
5. **Update documentation and regression coverage.** Amend ADR 0008, update the click-to-create design docs, and append the three agent handoffs.

## Tests

- Grid/list tests assert no “Free” label is rendered or included in free-cell names, while day/time context remains available.
- Component tests assert native Tab order, event blocks are real buttons, dialog Escape works, form fields remain keyboard usable, and no arrow-key cursor behavior is expected.
- Availability tests assert `get_blocked_intervals` data becomes anonymous read-only blocked blocks, selection and delete intents are disabled, tutor titles remain tutor-only, and no title/ID leaks into the tutee projection.
- Accessibility tests assert the `Not available` accessible name/`sr-only` text, stripe fallback styles, visible focus, and no colour-only state cue.
- Run focused calendar tests, then lint, typecheck, full tests, and build.
