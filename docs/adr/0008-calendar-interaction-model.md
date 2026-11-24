# ADR 0008 – Calendar interaction model and reusable selectable time grid

**Status**: Accepted (2026-11-24). Owner decision: accepted as written, adopting the recommended default for each open question below; the mode/strategy boundary is implemented via the `GridBlock` view model.

## Context

The tutor currently creates manual blocked events in a form below the calendar. The next calendar change must make the calendar itself the primary editor: a click or drag on the time grid creates a blocked event, and selecting an existing event opens its details and edit/delete actions. ICS import remains unchanged. The same interaction surface must later support a tutee selecting an available slot for a session request rather than creating a blocked event.

Constraints are the existing React 19/TypeScript strict/Vite/HashRouter/CSS Modules/Supabase stack, 08:00–22:00 every day in `Europe/Brussels`, UTC persistence, server-side RLS, mobile support, and WCAG 2.2 AA keyboard operation. The existing `CalendarEventRepository` remains the persistence port; client validation is not authorization or conflict protection.

## Decision

Build a shared, accessible `SelectableTimeGrid` domain/UI boundary with an explicit mode strategy. Do not make tutor-specific event mutations part of the grid.

### Interaction contract

The grid presents a desktop week view and a mobile day view using the existing week navigation and 30-minute model. The selectable interval is the intersection of 08:00–22:00 local tutor time and the visible day. Times are converted to UTC through the existing date/time domain helpers; no fixed offset arithmetic is allowed.

- **Click on an empty time cell**: select one snap interval and open the create dialog, prefilled with that date and start/end. Focus moves to the dialog heading or first field. The dialog contains title, start, end, cancel, and save. It does not save on selection alone.
- **Drag on empty time**: pointer down starts a selection; moving vertically changes the end; release opens the same create dialog with the selected range. Selection is constrained to one local day, 08:00–22:00, and the snap interval. Escape cancels the draft. A short click must not also create a second selection.
- **Click an existing tutor event**: open an event dialog showing title, local date/time, source, edit, and delete actions. Edit reuses the create form with the event values. Delete requires the existing confirmation dialog. ICS events are view/delete only in this first interaction release; their source is never changed to `manual` accidentally.
- **Overlap and errors**: the grid may display overlapping events, but never silently merges or overwrites them. The repository/server result is authoritative. Save failures keep the dialog open, show an accessible error, and retain values. Successful create/edit/delete refreshes the visible range and announces the result in a live region. A stale event produces a recoverable conflict/error, not data loss.
- **Closed hours and other days**: clicks/drags outside 08:00–22:00 are inert and expose a non-colour text/ARIA explanation. A drag cannot cross midnight; the user can create another event on the next day. Navigation does not discard an open dialog without an explicit cancel.
- **Keyboard equivalent**: each selectable time cell is a native button (or a focusable gridcell with an equivalent button action), with an accessible name containing day, time, and state. Enter/Space opens creation for one snap interval. Arrow keys move by one snap interval vertically and one day horizontally; Home/End move to the first/last interval of the day; Page Up/Page Down change week/day view. Shift+Arrow extends a keyboard selection; Enter opens the create dialog for it; Escape clears it. Existing events are focusable buttons with Enter/Space opening details and Delete opening the existing confirmation (with a non-destructive confirmation step). Focus returns to the originating cell/event after close, or to the next sensible event after deletion.
- **Touch/mobile**: the minimum target is 44x44 CSS px. A tap opens a one-interval create dialog; press-and-hold (with a short, documented delay) begins range selection, and dragging updates it. Scrolling must win over an ambiguous vertical gesture: selection starts only after the pointer is captured on a grid cell and movement is intentional. Provide explicit “Select start”/“Select end” controls in the dialog as a fallback; never require a precise drag. The mobile day list exposes the same event buttons and a “Create at this time” action, so all operations remain possible without dragging.

### Reusable abstraction and modes

`SelectableTimeGrid` consumes a view model, not Supabase types:

```ts
type GridMode = 'tutor-create' | 'tutee-request';
interface TimeGridStrategy {
  canSelect(range: TimeRange): boolean;
  canActivateBlock(block: GridBlock): boolean;
  select(range: TimeRange): void;
  activateBlock(key: string): void;
}
```

The exact exported names can be chosen by the tech lead, but the boundary must keep these responsibilities separate:

1. **Pure selection model**: pointer/keyboard gestures become a validated local `TimeRange`; snapping, day boundaries, opening hours, past-time rules, and timezone conversion are pure functions with unit tests.
2. **Presentation**: grid/list rendering, focus management, live announcements, dialog plumbing, and responsive layout. It receives generic `GridBlock` values (`key`, range, label, kind, `readOnly`) and never reads repository data directly.
3. **Strategy**: mode-specific policy and commands. `tutor-create` maps selection to `NewCalendarEvent` and uses `CalendarEventRepository`; `tutee-request` accepts only available future ranges and maps selection to a future `SessionRequest` port. The tutee strategy must not receive private event titles or IDs.
4. **Repository/server**: Supabase RLS/RPC and transactional conflict checks remain authoritative. The tutor UI must not infer permission from mode, and a future tutee flow must re-check availability and double-booking on the server.

The current manual form can remain as a non-pointer fallback during migration, but the grid dialog becomes the canonical create/edit form. ICS import continues to call the existing repository and refreshes the grid; no second event model is introduced.

### Accessibility and responsive requirements

Use semantic controls and labelled dialogs rather than a canvas or mouse-only hit areas. Do not communicate free/blocked/requested state by colour alone. Include visible focus, `aria-describedby` instructions, `aria-busy` while saving, and `role="status"` announcements. Test the grid and dialogs with keyboard interaction, axe, 320px width, 200% zoom, and reduced motion. A responsive day list is a first-class equivalent, not merely an overflowed desktop table.

## Consequences

- One interaction model can serve tutor creation now and tutee requests later without exposing tutor event details or coupling either flow to a calendar library.
- Pointer and keyboard behavior require more implementation and tests than the current read-only table; focus and gesture regressions are a material risk.
- The current `CalendarEvent`/`CalendarEventRepository` contracts remain compatible. Editing needs a repository update operation (or a documented replace operation) before implementation; this ADR does not silently overload `addEvents`.
- The existing title limit, maximum event length, ICS rules, and `Europe/Brussels` UTC storage remain in force.
- The old form can be retained temporarily for accessibility fallback, but two create entry points must share one validation/dialog component to avoid divergent behavior.

## Open questions for the owner

1. **What event fields should manual creation expose beyond title, start, and end?** Recommended default: title only; do not add description, location, attendees, or recurrence until a concrete need exists.
2. **Should the UI create recurring manual events?** Recommended default: no; create one occurrence at a time and keep recurrence exclusively in ICS import for this release.
3. **What snap interval should click/drag use?** Recommended default: 30 minutes, matching the existing grid; allow 5-minute HTML time input precision only in the dialog if needed later.
4. **Is editing an individual occurrence of an imported recurring event in scope?** Recommended default: no; ICS events are view/delete only, and changes happen by editing/re-importing the source calendar.
5. **Should creating/editing events be allowed outside 08:00–22:00?** Recommended default: allow only ranges intersecting the open hours and clip/reject closed-only selections; keep the existing form's behavior (it stores a range that partly lies outside hours) only if the owner explicitly needs it.

## Amendment – owner decisions (2026-11-24)

The owner made the following final decisions after live local testing; this amendment supersedes conflicting interaction details above:

1. **Free cells are empty.** Free time has no visible text or label. A free interval is represented by the absence of a block; non-free time is represented as a block. Accessibility must still expose the day/time and any applicable state without adding a “Free” label.
2. **Tutee privacy uses anonymous striped blocks.** The availability page obtains the tutor’s blocked areas from the existing `get_blocked_intervals` RPC and projects them as read-only `GridBlock` values. Blocked areas use the existing `blocked` kind and an accessible `Not available` label, never private titles. `SelectableTimeGrid` is reused in a read-only/no-selection mode for this page. A later own-session/request feature may add a distinct non-striped `busy` kind in the view model; it is not implemented by this amendment. The tutor projection continues to show titles.
3. **Remove the custom keyboard cursor contract.** Nobody uses the arrow-key cursor/selection machinery. Remove `time-grid-keyboard.ts`, its wiring, tests, and documentation. Retain native element semantics: event blocks remain real buttons, dialog Escape and normal Tab behavior remain available, and form fields retain their native keyboard behavior.

The decision does not change server-side authorization, the `GridBlock` privacy boundary, or the requirement that future tutee requests be checked by the server.
