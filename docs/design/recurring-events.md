# Recurring blocked events UI specification

Builds on `docs/design/calendar-click-to-create.md` and ADR 0013. Owner decisions are final: Google-Calendar-style custom repeat, required end (max 12 months), no "never", scope question on edit/delete, pattern not editable, delete only via the grid dialog, list below the calendar removed. Docs only; no application code here.

## Scope and user goal
The tutor blocks a recurring slot (for example badminton on Tue, Wed and Thu evenings) once, instead of cell by cell, and later changes or removes one occurrence, the rest of the series, or all of it. Tutees see no change (anonymous striped "Not available" blocks).

## Design decisions
- **Custom repeat is an inline section, not a sub-dialog.** Stacked modals are poor on mobile, hard for screen-reader users, and the existing `Dialog` is single-level. The section appears inside the create dialog only when "Custom…" is chosen.
- **The scope question is a second step inside the same dialog** (content swaps, heading changes, a **Back** button returns). No stacked dialogs.
- **Imported `.ics` events get no scope choice.** They are individual rows with no series link in this product (the import panel already offers "Remove all imported events"). The dialog stays view + **Delete event** with the plain confirmation (this event only).
- **Repeat pattern is read-only when editing.** Edit shows the summary sentence plus a hint; there are no repeat controls.
- Native controls only (`select`, radio group, checkbox group, `input type=number|date|time`). Existing tokens and shared `Dialog`, `Field`, `TextInput`, `Button`, `ErrorSummary`, `ConfirmDialog`. No new tokens or raw colours.

## Create dialog layout
Dialog title **Create blocked time** (unchanged). Field order:

1. **Title (optional)**: unchanged, with hint.
2. **Date (Brussels time)** (required)
3. **Start (Brussels time)** (required)
4. **End (Brussels time)** (required)
5. **Repeat**: native `<select>`, default **Does not repeat**. Options, in order:
   - `Does not repeat`
   - `Every week on {Tuesday}` (weekday follows the Date field, updates when it changes; full weekday name)
   - `Every weekday (Monday to Friday)`
   - `Custom…`
6. *(only if Repeat is not "Does not repeat")* **Custom section**, only for `Custom…`:
   - Fieldset legend **Repeat every**: number input (1–12, default 1) labelled **Repeat every (weeks)** with the suffix text `week(s)`; render the suffix as text next to the input, not inside the label.
   - Fieldset legend **Repeat on**: seven native checkboxes, labels `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun` (accessible names are the full day names via visually hidden text, e.g. `Mon` + `day`). The weekday of the Date field is pre-checked. Order Monday first (Belgium).
7. **End** fieldset (shown for every repeating choice; required): legend **Ends**, native radio group:
   - `On date` (default), with a date input labelled **End date (Brussels time)**, pre-filled with the start date + 3 months, `min` = start date, `max` = today + 12 months.
   - `After` with a number input labelled **Number of events** (2–400, default 10), followed by the text `events`.
   Only the input of the selected radio is enabled; the other is disabled, keeping its value.
8. **Summary** line (text, not a control), directly under the End fieldset, e.g. `Weekly on Tue, Wed, Thu until 28 Feb 2027 (34 events)`.
9. Status/alert lines, then actions: primary **Create event** (**Create events** when repeating, count > 1), secondary **Cancel**.

```
Create blocked time
Title (optional)        [Badminton______________]
Date (Brussels time)    [Tue 02 Dec 2026]
Start  [18:00]   End  [20:00]
Repeat                  [Custom…            v]
  Repeat every (weeks)  [1] week(s)
  Repeat on  [ ]Mon [x]Tue [x]Wed [x]Thu [ ]Fri [ ]Sat [ ]Sun
  Ends      (•) On date   End date [28 Feb 2027]
            ( ) After     Number of events [10] events
Weekly on Tue, Wed, Thu until 28 Feb 2027 (34 events)
[ Create events ]  [ Cancel ]
```

### Behaviour rules
- Changing Date while Repeat is a weekly preset updates the label and weekday; for Custom, the new weekday is added to the checked days if none is checked.
- Presets fill the same rule structure: "Every week on …" = every 1 week on that weekday; "Every weekday" = every 1 week on Mon–Fri. Choosing a preset hides the Custom section but keeps End visible.
- Choosing **Does not repeat** hides Custom, End and Summary; entered values are kept if the tutor switches back.
- The End date default is recomputed (start + 3 months, never beyond the 12-month cap) only until the tutor edits the End date or radio.
- First occurrence is the first selected weekday on or after the start date; weeks count from the Monday-based week of the start date.
- Closed-hours clipping from the existing spec applies once, before any events are created, and nothing is saved until the tutor confirms again.

### Summary sentence copy (generated, Brussels date format `D MMM YYYY`)
| Rule | Sentence |
|---|---|
| Every week, one day | `Weekly on Tue until 28 Feb 2027 (14 events)` |
| Every week, several days | `Weekly on Tue, Wed, Thu until 28 Feb 2027 (34 events)` |
| Every weekday preset (or Mon–Fri exactly, interval 1) | `Every weekday until 28 Feb 2027 (60 events)` |
| Interval N > 1 | `Every 2 weeks on Tue, Thu until 28 Feb 2027 (14 events)` |
| Ends after N | the same sentence; `until {date of last event}` is computed, e.g. `Weekly on Tue, Wed, Thu until 16 Dec 2026 (10 events)` |
| One event only | `Weekly on Tue until 2 Dec 2026 (1 event)` |
| Invalid / incomplete | `Choose how this event repeats to see a summary.` (no counts) |
Days are always listed Monday first and abbreviated (`Mon`, `Tue`, …). Singular `1 event`, otherwise `{n} events`.

Edit dialog shows the same sentence prefixed `Repeats: ` (for example `Repeats: Weekly on Tue, Wed, Thu until 28 Feb 2027`). The sentence describes the series as created; after a "This event" edit it can differ from individual events, so it never claims dates for the clicked row.

## Validation and error copy
Errors appear inline under the field (`Field` error), in the `ErrorSummary`, with `aria-invalid` and `aria-describedby`. Existing messages (end after start, 08:00–22:00, one day, title length) are unchanged.

| Situation | Field | Copy |
|---|---|---|
| Repeating start in the past | Date | `Choose today or a later date for a repeating event.` |
| Interval empty/outside 1–12 | Repeat every | `Enter a number of weeks from 1 to 12.` |
| No weekday checked | Repeat on | `Choose at least one day.` |
| No end choice (cannot occur by default) | Ends | `Choose when this event stops repeating.` |
| End date empty | End date | `Enter an end date.` |
| End date before start | End date | `Choose an end date on or after {start date}.` |
| End date after the limit | End date | `Choose an end date on or before {latest date}. Events can repeat for 12 months at most.` |
| Count empty or outside 2–400 | Number of events | `Enter a number of events from 2 to 400.` |
| Count runs past 12 months | Number of events | `{N} events would run past {latest date}, the latest date allowed. Choose fewer events or an earlier end.` |
| Count/date gives only one event | End | `This would create only one event. Choose a later end.` |

`{latest date}` is the full computed date, e.g. `25 Nov 2027`. Nothing is silently shortened. Server rejection of a series (invariants) shows the generic save error below.

## Edit dialog for a repeating event
- Title **Edit blocked time**. Fields: Title, Date, Start, End as today. Above the fields, the line `Repeats: …` (text) and hint `To change how this event repeats, delete it and create a new one.`
- Primary action **Save changes**, secondary **Cancel**, and a tertiary **Delete event** (secondary variant, left of Cancel on desktop, last on mobile). Non-repeating manual events: Save saves directly; Delete uses the existing `ConfirmDialog` (**Delete this event?** / `This cannot be undone.` / **Delete event** / **Keep event**).
- Clicking an existing repeating event opens the edit dialog directly; **Delete event** is always reachable here (this replaces the removed list).
- If no field changed, **Save changes** shows `Nothing has changed.` and does not open the scope step.

### Scope step (same dialog, second view)
Heading (replaces the title, focus moves to it): **Edit repeating event** or **Delete repeating event**.

```
Edit repeating event
Which events do you want to change?
(•) This event
( ) This and following events
( ) All events
[ Save ]  [ Back ]
```

Fieldset legend: `Which events do you want to change?` / `Which events do you want to delete?`. Radio options and hints (hint is text under each label):

| Option | Edit hint | Delete hint |
|---|---|---|
| **This event** (default) | `Only {Tue 2 Dec, 18:00–20:00} changes.` | `Only {Tue 2 Dec, 18:00–20:00} is deleted.` |
| **This and following events** | `This event and all later events in the series change.` | `This event and all later events in the series are deleted. Earlier events stay.` |
| **All events** | `Every event in the series changes, including past ones.` | `Every event in the series is deleted, including past ones. This cannot be undone.` |

Actions: edit **Save changes** / **Back**; delete **Delete events** (destructive variant) / **Back**. When "This event" is chosen for delete, the button reads **Delete event**. Cancel is the dialog close/Escape (discard), **Back** returns to the form with values kept.

Edit rules shown to the tutor:
- Only fields that were changed are written; other fields on other events stay as they are (for example a moved occurrence keeps its own date and an individually renamed one keeps its name unless Title was changed now).
- The **Date** field is editable only for This event. If Date was changed, **This and following** and **All events** are disabled with hint `Dates can only be changed for a single event.`, and *This event* is preselected.
- Title and time changes are applied to every event in scope using each event's own date.
- After **This event** edits, the event stays part of the series.

## Imported events
Dialog **Imported event** as today: title, when, `Imported from calendar file`, actions **Delete event** (opens the plain confirmation, this event only) and **Close**. No Repeat, no scope step, no edit controls, even if the source file was recurring.

## Indication on the grid and mobile list
- Repeating events (those with a series) show a small repeat glyph (`↻`, `aria-hidden`) before the title in the event button, using the existing event text colour. Do not rely on the glyph: the accessible name and visible detail line add the word **Repeats**.
- Accessible name: `{title}, Tue 2 Dec 18:00–20:00, repeats` (plus the existing overlap count text when relevant). Untitled: `Blocked time, …`.
- Desktop short events (30 minutes) show only the glyph and title, truncated with the existing ellipsis; the full text is in the accessible name and the dialog.
- Mobile day list: the event row shows a second line `Repeats weekly` or `Repeats` plus source; one line, wrap allowed, no truncation.
- Imported events show no repeat indicator. Tutee view is unchanged (no indicator, no titles).

## States
| State | Behaviour and copy |
|---|---|
| Empty week | Open grid with `Nothing is blocked this week.` (unchanged; the removed list had no other empty state). |
| Loading calendar | `Loading the calendar...`; `aria-busy` on the grid during navigation (unchanged). |
| Loading series summary (edit dialog) | The dialog opens at once with fields; the `Repeats:` line shows `Loading repeat details…`. Save and Delete are enabled only after it resolves or fails. |
| Series summary failed | Line shows `We couldn't load the repeat details.` with button **Try again**; this event can still be edited with **This event** only; the scope step offers only *This event* with hint `Repeat details are unavailable, so only this event can be changed.` |
| Saving (create) | Form controls disabled, `aria-busy`, primary button `Saving…` (existing). For series: `Saving 34 events…` is not announced; the visible button text stays `Saving…`. |
| Saving (scope) | Scope radios and buttons disabled, primary button `Saving…` (edit) or `Deleting…` (delete). |
| Success | Dialog closes; polite status `Event created.` / `{n} events created.` / `Event updated.` / `{n} events updated.` / `Event deleted.` / `{n} events deleted.`; grid refreshes; focus returns to the originating cell/event, or to the **Week view** heading after a deletion (the list no longer exists). |
| Save error | Dialog and values stay open, `role="alert"`: `We couldn't save this event. Check your connection and try again.` For a series `We couldn't save these events. Check your connection and try again.` (nothing is partly created). |
| Delete error | `We couldn't delete this event. Check your connection and try again.` / `We couldn't delete these events. Check your connection and try again.` |
| Conflict (stale event) | `This event changed. Review the details and try again.` The dialog reloads the event's current values. (Replaces `This time changed…` for edit; the grid copy for time conflicts is unchanged.) |
| Event already gone | `This event no longer exists. It may have been deleted already.` with **Close**; the grid refreshes. |

## Mobile (< 40rem)
- Dialog is full width; the form is a single column; every control is at least `--tap-target` (44px) high.
- Native `select`, date, time, number and radio/checkbox inputs only, so the OS pickers are used. Weekday checkboxes are a wrapping row of 44px chips (`Mon`…`Sun`) with a visible checked state (tick + border, not colour only); at 320px they wrap into two rows.
- The summary stays visible near the actions; the dialog body scrolls, action buttons stack full-width (primary on top, Cancel/Back below, Delete last).
- No horizontal scrolling at 320px and 200% zoom. Number inputs use `inputmode="numeric"`.

## Accessibility
- Repeat is a labelled `select`; Custom, Ends and Repeat on are `fieldset` + `legend`; checkboxes and radios are native with visible labels.
- Switching Repeat reveals sections without moving focus; the select keeps focus. Dependent controls are removed from the tab order when hidden or disabled.
- The summary is plain text with `aria-live="polite"` only; it updates on `change` of a control (not per keystroke) so it is not announced repeatedly. Do not announce counts while typing.
- Errors: inline `Field` error text, `aria-invalid`, `aria-describedby`, and the `ErrorSummary` linking to the field (existing pattern). Save/delete failures use `role="alert"`; success uses the existing persistent `role="status"`.
- Scope step: heading receives focus on entry; fieldset has a legend; each radio hint is linked with `aria-describedby`; disabled options keep their hint visible; **Back** returns focus to the control that opened the step (Save or Delete).
- Dialog Escape closes without saving (also from the scope step); focus restoration as in the base spec.
- Grid: the glyph is `aria-hidden`; "repeats" is in the accessible name. Contrast ≥ 4.5:1 for all text and glyph, visible focus using `--color-focus`, state never by colour alone.
- Times and dates are always labelled Brussels time; dates in summaries use unambiguous `D MMM YYYY`.
- `prefers-reduced-motion`: no transitions when sections appear.
- No custom keyboard handlers; remove the grid's `Delete`-key shortcut if still wired (decision of 2026-11-24).

## Removal of the list below the calendar
Remove the **Events this week** section, its per-row Delete buttons and the list's empty/delete copy. Page order becomes: `Calendar` heading, timezone note, week navigator, grid, `Import a calendar file`. Deleting is only possible from the event dialog. Because the grid truncates short events, accessible names must always carry full title and time.

## Acceptance criteria
1. The create dialog shows a **Repeat** select with exactly: Does not repeat (default), Every week on {weekday}, Every weekday (Monday to Friday), Custom…; choosing "Every week on" shows the weekday of the Date field and updates when Date changes.
2. With "Does not repeat" no End fieldset, Custom section or summary is shown and one event is created as before.
3. Any repeating choice shows the required **Ends** radio group; there is no "never" option; **On date** is preselected with the start date + 3 months, min = start date, max = today + 12 months.
4. **Custom…** shows **Repeat every (weeks)** (1–12) and Mon–Sun checkboxes (Monday first) with the start weekday pre-checked; zero checked days shows `Choose at least one day.`
5. The summary sentence matches the table (for example `Weekly on Tue, Wed, Thu until 28 Feb 2027 (34 events)`; `Every weekday until …`; `Every 2 weeks on Tue, Thu until …`; singular `1 event`) and matches the number of events actually created.
6. An end date beyond today + 12 months, before the start date, or empty shows the specified messages, with the latest allowed date; nothing is created.
7. "After N events" accepts 2–400; outside that range shows `Enter a number of events from 2 to 400.`; a count whose last event is past the 12-month limit shows the `{N} events would run past {latest date}…` error with the full latest date and is never silently shortened.
8. Create succeeds with `{n} events created.` announced, the grid shows all events, the dialog closes, and focus returns to the originating cell; failures keep the dialog open with the retry copy and all values.
9. Repeating events on the grid show the repeat glyph and the accessible name ends with `repeats`; mobile rows show `Repeats`; imported and non-repeating events show neither.
10. Clicking a repeating event opens **Edit blocked time** with `Repeats: …`, the "delete it and create a new one" hint, and no repeat controls; the pattern cannot be edited.
11. **Save changes** on a repeating event with changes opens the scope step with *This event* selected; with no changes it shows `Nothing has changed.` and no scope step.
12. **Delete event** on a repeating event opens the scope step with the delete wording; for non-repeating manual events it opens the plain confirmation.
13. The three scope options have the specified hints; *This event* deletes/edits one event; *This and following* affects the clicked and later events only; *All events* includes past events (QA with fixtures that include past events).
14. When Date is changed, *This and following* and *All events* are disabled with the stated hint; for *All*/*This and following* edits only changed fields are written, and individually moved dates and titles are preserved.
15. After edit or delete the dialog closes, the grid refreshes, the status announces the count (`Event deleted.` / `{n} events deleted.`), and focus goes to the originating event, or to the **Week view** heading after deletion.
16. **Back** in the scope step returns to the form with values intact; Escape closes without saving.
17. Imported events open **Imported event** with only **Delete event** / **Close**, no Repeat and no scope step; deletion removes that one event after the plain confirmation.
18. The "Events this week" list and per-row Delete buttons are gone; no delete path exists outside the event dialog; no `Delete`-key shortcut on the grid.
19. Error and conflict copy matches the States table (save, delete, stale, already gone, repeat-details failure with *This event* only); the busy state disables controls and sets `aria-busy`.
20. At 320px width and 200% zoom there is no horizontal scrolling; all controls are ≥ 44px, weekday checkboxes wrap, native pickers are used, and buttons stack full-width.
21. Axe/WCAG checks pass: labelled select/fieldsets/legends, `aria-invalid`/`aria-describedby` on errors, contrast ≥ 4.5:1, visible focus, state not by colour alone, polite summary announcing on change only, scope heading receives focus.
22. Tutee pages are unchanged: no repeat indicator, titles, counts or series information is exposed.
23. DST fixtures (late March, late October) show events at the same Brussels wall time across the change.
