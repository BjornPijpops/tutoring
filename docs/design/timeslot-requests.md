# Timeslot requests UI/UX specification

## Scope and principles

This flow lets an approved tutee request a tutoring session from the existing Brussels-time availability grid. A request is never saved implicitly: selecting a range opens a confirmation dialog, and the server remains authoritative for availability, limits, and lifecycle transitions. Reuse the existing `SelectableTimeGrid`, `GridBlock` boundary, shared dialog/form patterns, and existing spacing, typography, colour, focus, radius, and tap-target tokens. No note field is included.

Always show: `Times are shown in Brussels time (Europe/Brussels). Calendar hours: 08:00–22:00.`

Owner rules mirrored in the UI and enforced by the RPC:

- Sessions are 30 minutes to 2 hours, in 30-minute steps.
- A tutee may have at most 3 pending requests. Accepted sessions do not count toward this cap.
- The start must be at least 24 hours ahead and no more than 30 calendar days ahead, in Brussels time.
- There is no tutee note field and no email is sent to tutees. Tutor notification is outside this UI flow.
- Accepted sessions are anonymous striped `not available` intervals for other tutees.
- A tutee's own requests/sessions are distinct, non-striped `busy` blocks labelled `Pending` or `Accepted` (never a private tutor title or another user's identity).

## Tutee flow

### Availability grid and selection

1. An approved tutee opens **Availability**. The grid retains the existing 30-minute Brussels interaction model and shows anonymous unavailable intervals as diagonal-striped blocks labelled `Not available`.
2. Open time is selectable by click/tap or native pointer range selection. Selection is constrained to one local day and snaps to 30-minute boundaries. A selection never saves directly.
3. The selected range is visibly outlined and announced as `Selected: Tue 14:00–15:00.` The primary action is **Request this time**; **Cancel** clears the draft.
4. A range that includes a striped interval cannot be submitted. The UI explains the conflict without revealing who occupies it.
5. A selected range opens the confirmation dialog. The dialog rechecks the visible Brussels date/time and shows duration; it does not offer a title or note field.

### Confirm dialog

Dialog title: **Request this tutoring time?**

Body copy: `You are requesting Tue 14:00–15:00 (1 hour) in Brussels time. Your tutor must accept this request before it becomes a session.`

Actions:

- Primary: **Send request**
- Secondary: **Go back**

On submit, disable both actions, keep the selected values visible, set `aria-busy="true"`, and label the primary action `Sending…`. On success close the dialog, refresh the visible range, return focus to the originating selection, and announce: `Request sent. It is pending tutor approval.`

The dialog must not imply that a request is accepted, reserve time for the requester, or promise an email. If the range is no longer available, retain the dialog and show: `This time is no longer available. Choose another time.`

### Own requests and lifecycle

Own pending and accepted requests render as non-striped `busy` blocks, visually distinct from anonymous striped unavailable blocks:

- Pending block label: `Pending` (accessible name includes the local date/time).
- Accepted block label: `Accepted` (accessible name includes the local date/time).
- Declined and cancelled requests are not rendered as busy blocks in the availability grid; their history can appear in **My sessions**.

Each own block is actionable and opens its details. The details include local date/time, status, and **Cancel request** / **Cancel session**. Cancellation removes the active busy block after a successful refresh but retains history. Pending cancellation is immediate after the standard confirmation pattern; accepted cancellation requires confirmation:

- Title: **Cancel this session?**
- Body: `This accepted session will be cancelled and the time will become available again.`
- Actions: **Cancel session** / **Keep session**

### My sessions

Place **My sessions** in the tutee's authenticated navigation, directly after **Availability** on desktop and in the primary mobile navigation. Show a pending badge only when the tutee has pending requests, with an accessible label such as `My sessions, 2 pending`. The page is a chronological list grouped into **Pending**, **Accepted**, and **Past and closed**. Each row has date, local time, duration, status, and a cancel action where allowed. No tutor email, private event title, request id, or note is shown.

Empty copy: `You have no sessions or requests yet.` Include **Browse availability**.

## Tutor flow

Place **Requests** in the tutor/admin navigation immediately after **Calendar** and before secondary tools such as calendar import. Add a visible pending-count badge to **Requests** (`Requests, 2 pending`); do not rely on colour alone. The calendar remains the tutor's place to see accepted sessions alongside blocked events.

### Pending list

The page heading is **Session requests**. The pending view lists requester identity needed for the decision, local Brussels date/time, duration, and status. Each row has native buttons **Accept** and **Decline**. No note field is displayed because requests do not contain notes. Use the existing dialog/error patterns for decision confirmation only where needed; acceptance must always recheck conflicts on submit.

Acceptance success: `Request accepted.` Refresh the list and tutor calendar. The accepted session appears on the tutor calendar as a distinct non-striped `busy` block labelled `Accepted` and the tutee identity may be shown in the tutor-only view.

Decline success: `Request declined.` Refresh the list. If accepting a request automatically declines overlapping pending requests, announce the exact count: `N overlapping requests were declined.` Omit the sentence when N is zero. The declined requests remain in history but are removed from Pending.

A stale decision or schedule conflict keeps the request pending and shows: `This request can no longer be accepted because the time is unavailable. Review the request and try again.` The tutor can then decline it or refresh and retry.

## Validation and error copy

The client may prevent obviously invalid selections, but every rule is repeated by the server and mapped to stable, non-technical copy:

| Condition | Copy |
|---|---|
| Less than 24 hours' notice | `Requests must be made at least 24 hours in advance.` |
| More than 30 days ahead | `Requests can be made up to 30 days ahead.` |
| Shorter than 30 minutes | `Choose a session of at least 30 minutes.` |
| Longer than 2 hours | `Choose a session of no more than 2 hours.` |
| Not a 30-minute step | `Choose a start and end time on the 30-minute grid.` |
| Crosses a local day or calendar hours | `Choose a time on one day between 08:00 and 22:00.` |
| Conflict with unavailable time | `This time is no longer available. Choose another time.` |
| Four pending requests | `You already have 3 pending requests. Wait for a decision or cancel one before requesting another.` |
| Not approved or signed out | `You need an approved account to request a session.` |
| Load failure | `We couldn't load availability. Check your connection and try again.` |
| Submit/decision failure | `We couldn't send that request. Check your connection and try again.` / `We couldn't update this request. Check your connection and try again.` |

Raw database, identity, or authorization errors never reach the UI. Retain the draft and dialog values on submit errors where the selection remains meaningful.

## States

- **Loading:** First load shows `Loading availability…`; navigation keeps the previous grid and sets `aria-busy="true"`. My sessions and Requests use `Loading your sessions…` and `Loading session requests…` respectively.
- **Empty availability:** Show the open grid and `No available times are shown for this period.` with a clear week/day navigator. Do not label every open cell `Free`.
- **Empty pending list:** `There are no pending session requests.`
- **Empty My sessions:** `You have no sessions or requests yet.`
- **Error:** Keep navigation and retry available. Use the copy above plus a native **Try again** button. `role="alert"` is reserved for actionable errors.
- **Submitting/deciding/cancelling:** Disable only the relevant mutation controls, preserve context, expose `Sending…`, `Accepting…`, `Declining…`, or `Cancelling…`, and use `aria-busy="true"` on the dialog/row.
- **Success:** Use one persistent polite status region for `Request sent…`, `Request cancelled.`, `Request accepted.`, `Request declined.`, and overlap-count announcements.

## Responsive behaviour

Desktop keeps the seven-column week grid and time labels. Mobile (<40rem) uses the existing chronological one-day list with previous/next day controls and a clear week-range label. Each open 30-minute interval is a full-width native action target of at least 44px; a tap opens the confirmation flow for the snapped range and never saves directly. **Request this time**, dialog fields, list actions, and cancellation controls remain usable at 320px and 200% zoom without horizontal scrolling. Native scrolling is never hijacked. Calendar hours and Brussels timezone remain visible.

## Accessibility

Use native buttons, links, form controls, and the existing shared `Dialog`, `ConfirmDialog`, `ErrorSummary`, `Field`, and `Button` patterns only. Do not introduce a custom keyboard cursor, roving-focus grid, or arrow-key selection contract. Normal Tab order reaches actionable cells/blocks, list actions, navigation, and dialog controls; inactive presentation areas are not fake controls.

Dialogs have a labelled heading, initial focus, trapped modal focus, Escape-to-close without saving, and focus restoration to the originating cell/row. Invalid controls use `aria-invalid` and `aria-describedby`; loading uses `aria-busy`; status and errors use the persistent `role="status"` and `role="alert"` regions described above. Provide visible `--color-focus`, at least 44px targets, 4.5:1 text/control contrast, non-colour status cues, and a `prefers-reduced-motion` treatment with no required transition. Stripes and labels must remain understandable in high contrast. Names and statuses are available to screen readers without exposing another tutee's data.

## Numbered acceptance criteria (QA-testable)

1. An approved tutee can select a free, same-day range on the availability grid; it snaps to 30-minute boundaries and does not save before **Send request** is confirmed.
2. The confirmation dialog shows the exact title **Request this tutoring time?**, the selected Brussels date/time and duration, the exact body copy specified above, and **Send request** / **Go back** actions; it has no note field.
3. Requests shorter than 30 minutes, longer than 2 hours, or not aligned to 30-minute steps are blocked with the specified copy.
4. Requests starting less than 24 hours ahead or more than 30 days ahead are blocked with the specified copy, using Brussels time.
5. A tutee's fourth pending request is rejected with the 3-pending-cap copy; accepted sessions do not consume the cap.
6. A conflict at submit preserves context and shows `This time is no longer available. Choose another time.` without exposing another user's identity.
7. Pending and accepted own requests appear as distinct non-striped busy blocks labelled `Pending` or `Accepted`; declined/cancelled requests do not remain active blocks.
8. **My sessions** appears in the stated navigation position, lists statuses and local times, shows the pending badge, and offers cancellation; accepted cancellation uses the exact confirmation copy and retains history.
9. The tutor sees **Requests** after **Calendar**, a pending badge, pending rows with identity/range/status, and native **Accept**/**Decline** controls; no note field is shown.
10. Accepting a request places an accepted busy session on the tutor calendar and automatically declines overlaps; the UI announces `N overlapping requests were declined` with the actual count.
11. Tutor accept/decline conflicts and failures leave the request pending where appropriate, preserve the row context, and show the specified retryable error.
12. Anonymous striped `Not available` intervals include accepted sessions for other tutees, while no names, titles, ids, or boundaries attributable to another tutee enter the tutee projection.
13. Loading, empty, error, submitting, and success states match this specification and expose retry/status semantics to assistive technology.
14. At mobile width, 320px, and 200% zoom, the day-list flow, dialogs, cancellation, navigation, and list actions work without horizontal scrolling or hijacked native scrolling.
15. Keyboard QA verifies native Tab order, Enter/Space activation of native controls, dialog Escape, form keyboard behaviour, visible focus, and focus restoration; no custom arrow-key cursor is required or present.
16. Accessibility QA verifies WCAG 2.2 AA contrast, non-colour state cues, labelled controls, `aria-invalid`/`aria-describedby`, `aria-busy`, live announcements, reduced-motion support, and privacy-safe accessible names.
