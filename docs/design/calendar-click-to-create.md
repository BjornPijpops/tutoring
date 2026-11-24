# Calendar click-to-create UI specification

## Scope and user goal
The tutor manages blocked events directly in the calendar: click or drag an empty time range, enter a title, and save. Clicking an event opens its details and edit/delete actions. The old form below the calendar is removed; the existing ICS import panel remains. The interaction surface is reusable for a future tutee slot-request mode, but this release exposes creation only to tutors.

## Layout

### Desktop (viewport >= 40rem)
- Keep the page order: `Calendar` heading, timezone/open-hours note, week navigator, interactive week grid, `Events this week`, then `Import a calendar file`.
- Use a seven-column semantic week grid with a time-label column. Show 30-minute rows from 08:00 through 22:00; closed periods remain visibly labelled but inert.
- Events render as labelled buttons spanning their range. Overlapping events retain separate buttons with visible stacking/offset and a text indication such as “2 events overlap”. Do not merge or hide an event.
- Keep the existing `--space-*`, `--tap-target`, typography, radius, and surface tokens. Do not introduce raw colour values or new tokens.

### Mobile (< 40rem)
- Replace the week table with the existing chronological day-list pattern; show one day at a time with previous/next day controls and a clear week-range label.
- Each 30-minute open interval is a full-width, minimum 44px action target. Events are full-width event buttons with title, local date/time, and source.
- Keep ICS import below the calendar. Do not show the removed manual form. At 320px and 200% zoom, content remains usable without horizontal scrolling.

Always display “Times are shown in Brussels time (Europe/Brussels). Calendar hours: 08:00–22:00.”

## Interaction states

| State | Behaviour and copy |
|---|---|
| Empty | Show the open grid plus `Nothing is blocked this week.`; open cells are unlabelled by state (day and time only, no “Free” text). |
| Hover | Highlight the hovered 30-minute range with `--color-info-bg`; show a text tooltip/status: `Create blocked time at Tue 14:00–14:30`. Never rely on hover alone. |
| Dragging selection | Pointer capture keeps selection on one local day. Snap start/end to 30 minutes and show a solid outline plus text `Selected: Tue 14:00–16:00`. Escape cancels. |
| Selected | The selected range remains visible until the dialog opens or is cancelled. It never saves implicitly. |
| Overlap | Keep all event buttons operable; add visible `Overlap` text and an accessible count. Saving never silently overwrites another event. |
| Error | For load errors show `We couldn't load the calendar. Check your connection and try again.` and `Try again`. For save errors keep the dialog and values open: `We couldn't save this event. Check your connection and try again.` Conflicts say `This time changed. Review the times and try again.` |
| Loading | First load shows `Loading the calendar...`; navigation keeps the previous grid with `aria-busy="true"` until replacement data arrives. |
| Saving | Disable form commands, set dialog and grid `aria-busy="true"`, and label the primary button `Saving…`. |
| Imported/read-only event | Show source text `Imported from calendar file`; title and times are view-only. Allow delete through confirmation, but do not show edit controls or change the source. |

## Create and edit dialog
Use the existing shared `Dialog`, `Field`, `TextInput`, `Button`, `ErrorSummary`, and `ConfirmDialog` patterns.

- Create title: **Create blocked time**. Edit title: **Edit blocked time**. Details-only imported title: **Imported event**.
- Fields in order: **Title (optional)**, **Start (required)**, **End (required)**. Title hint: `Only you can see this title. Tutees see only that the time is blocked.` Keep the existing maximum title length and character counter.
- Date is presented in the start/end local date-time controls or a read-only date summary; all values are explicitly labelled **Brussels time**. Snap values to 30 minutes.
- Create primary action: **Create event**. Edit primary action: **Save changes**. Secondary action: **Cancel**. Imported details actions: **Delete event**, **Close**.
- Validation copy: `Enter an end time after the start time.`; `Choose a time between 08:00 and 22:00.`; `This selection must be on one day.`; `Enter a title of 200 characters or fewer.` Closed-only selections are rejected; a range intersecting open hours is clipped to 08:00–22:00 and explained: `The time outside 08:00–22:00 was removed.`
- No recurrence, description, location, attendees, or other event fields. No drag-to-move event editing in this release.
- On success close the dialog, refresh the visible range, announce `Event created.` / `Event updated.` / `Event deleted.`, and return focus to the originating cell/event (or the next event after deletion).
- Delete always uses the existing confirmation: **Delete this event?** / `This cannot be undone.` / **Delete event** / **Keep event**.

## Keyboard and native semantics

Remove the custom arrow-key cursor, roving-focus, and keyboard-selection contract. Open intervals are empty presentation areas rather than “Free” controls. Preserve native semantics for controls that remain: event blocks are real buttons; normal Tab order reaches actionable controls; dialog Escape closes without saving; and title/time fields use normal form keyboard behavior. Do not add a replacement cursor abstraction.

## Tutee availability projection

The availability page reads anonymous blocked intervals through the existing `get_blocked_intervals` RPC and passes read-only `GridBlock` values to the shared `SelectableTimeGrid`. It uses read-only/no-selection mode: tutees cannot create, edit, or delete blocks. Blocked areas are diagonal-striped, with an `sr-only`/ARIA label **Not available** and sufficient text/stripe contrast; state is not conveyed by colour alone. Add a `prefers-contrast: more` fallback that uses a stronger border and denser/high-contrast stripe treatment. Private tutor titles and IDs never enter the tutee view model. Reserve a later distinct non-striped `busy` kind for the tutee’s own sessions/requests; do not implement it here. The tutor view continues to render titles.

## Touch behaviour
- Tap an open cell creates a default one-hour selection at the snapped time and opens the create dialog. A tap never saves directly.
- Use the native controls and dialog fields as the mobile fallback; do not introduce a custom keyboard or cursor interaction contract. Scrolling must remain native.
- Provide dialog start/end controls and a visible **Create at this time** action so precise dragging is never required. Imported events respond to tap with details only.

## Colour, contrast, and motion
Use existing tokens only: free `--color-surface` with `--color-border-subtle`; selection/hover `--color-info-bg` and `--color-info`; events `--color-surface-alt` with `--color-border` accent; errors `--color-error-bg` and `--color-error`; success `--color-success-bg` and `--color-success`. Verify text and controls at least 4.5:1 (large text 3:1), visible focus with `--color-focus`, and 44px targets. State is always conveyed by text, icon plus text, or structure, never colour alone. Respect `prefers-reduced-motion` by removing selection transitions.

## ARIA and announcements
- Use native buttons where possible; use `aria-current="date"` for today, `aria-disabled` only when a control remains discoverable, and `aria-invalid`/`aria-describedby` for invalid fields.
- Dialogs have a labelled heading, initial focus on the first field (or heading for details), trapped modal focus, and focus restoration.
- Keep one persistent polite `role="status"` live region for loading, selection, and successful mutations; use `role="alert"` for actionable errors. Do not announce every pointer movement.

## Acceptance criteria
1. At desktop width the tutor can click an empty 30-minute cell, create a titled event, and see it after refresh; no save occurs before confirmation.
2. A drag creates a same-day snapped range; closed-only and cross-midnight selections are inert or rejected with text and accessible explanation; intersecting ranges are clipped to 08:00–22:00.
3. Event activation opens details. Manual events can edit title/start/end and delete with confirmation; imported events can view/delete only.
4. Overlapping events remain individually reachable and no save overwrites another event silently.
5. Load, save, conflict, and delete failures preserve user input where applicable, expose an accessible error, and allow retry.
6. Tests cover native Tab order, event-button activation, dialog Escape, form-field keyboard behavior, and focus restoration; no arrow-key cursor contract is required.
7. On mobile, tap opens a default one-hour create dialog, scrolling is not hijacked, and all actions work at 320px and 200% zoom without horizontal scrolling.
8. Axe/WCAG checks find labelled controls/dialogs, visible focus, contrast >= 4.5:1, non-colour state cues, live announcements, and reduced-motion support.
9. Tutee users never receive ICS import or tutor event titles/IDs; blocked areas are anonymous striped read-only blocks labelled “Not available”, and the grid remains reusable for future slot requests.
