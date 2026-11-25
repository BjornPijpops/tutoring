# Tutee management ? tutor UI/UX specification

**Scope:** tutor-only `/tutees` and `/tutees/:userId`, extending the existing access-request and session-request patterns. Mobile-first, WCAG 2.2 AA, native controls only. Reuse `Container`, `PageHeading`, `FilterTabs`, `StatusBadge`, `StatusMessage`, `StatusAnnouncer`, `EmptyState`, `ConfirmDialog`, `RequestCard`, `formatMoment`, and existing tokens. No private notes, no new email flow, and no custom keyboard machinery.

## 1. Tutor navigation

Add **Tutees** to the tutor/admin primary navigation immediately after **Calendar** and before **Requests** (the existing access/session request inboxes). The link is visible for tutors only and uses the opaque user id only in detail URLs. Keep the existing **Requests** pending badge and distinguish its accessible name, for example `Requests, 3 pending`; do not move or remove the existing request inbox. On mobile, the same links appear in the native wrapping primary navigation; do not introduce a hamburger or custom menu keyboard model.

The legacy access **Requests** inbox keeps **Approve** and **Deny** for pending requests only. Revoking is not offered there, because it must carry the **Also cancel accepted future sessions** choice; approved tutees get a **Manage** link to `/tutees/:userId` instead, and session request cards get a **View tutee** link to the same page.

`Tutees` has no badge: its status counts belong to the page filter chips. The detail breadcrumb/back link is native **Back to Tutees** and must preserve the current search, filter, and pagination when possible.

## 2. `/tutees` list

### Heading and controls

- `h1`: **Tutees**
- Lead: **People who have asked to see your availability.**
- Search label: **Search tutees**; native text input with placeholder **Name or email** and a native **Search** button. Search is server-side, case-insensitive, and retains the submitted query while paging. Do not put email or names in the URL.
- Status filter chips are native buttons in a `FilterTabs`-style `role="group"` labelled **Filter tutees**. They use `aria-pressed`, not ARIA tabs or arrow-key behaviour:
  - **All**
  - **Pending (n)**
  - **Approved (n)**
  - **Denied (n)**
  - **Revoked (n)**
  - **Blocked (n)**
- Default filter: **All**, with pending rows first, then most recently requested/activity first. Counts are returned by the list request and are not inferred from the current page.
- Results are paginated server-side. Use a native **Load more** button after the list, retaining filters and search. Hide it when all results are loaded. Announce `Showing {shown} of {total} tutees.` after loading more.

Each result is a link/card to `/tutees/:userId` with:

- display name as the card heading and email on its own wrapping line;
- `StatusBadge`: **Pending**, **Approved**, **Denied**, **Revoked**, or **Blocked**;
- **{n} access requests** (singular **1 access request**);
- **Last requested {date}** and, where applicable, **Can ask again after {date}**;
- session summary: **{n} pending session requests ? {n} accepted future sessions**.

Names and messages are rendered as text, never HTML. Long email/name strings use `overflow-wrap: anywhere`; nothing is truncated without an accessible full value. Each card's link accessible name includes the visible name and status, such as `Alex Example, Approved`.

### List states

- **Loading:** keep heading and controls; results region has `aria-busy="true"` and `StatusMessage info`: **Loading tutees?**. Do not use shimmer. Counts are omitted until loaded.
- **Initial empty:** `EmptyState` heading **No tutees yet** and copy **People appear here after they ask to see your availability.**
- **Filtered/search empty:** **No tutees match these filters.** with native **Clear filters**; if a search was submitted, say **No tutees match ?{query}?.** (quote text safely).
- **Error:** `StatusMessage error`: **We couldn?t load tutees. Check your connection and try again.** plus native **Try again**. Focus the alert on first failure and the button after an explicit retry.
- **Load-more error:** keep existing rows, inline error **We couldn?t load more tutees. Try again.** and native **Try again**; do not reset the list.
- **Search failure:** keep the previous results until the new request succeeds; announce **We couldn?t search tutees. The previous results are still shown.**
- **Stale/conflict response:** reload the current query and announce **The tutee list changed. It has been refreshed.**

### Responsive layout

At desktop widths, cards may use a compact two-column fact layout, but the name/status and action/link remain prominent. Below 40rem, every result is a stacked card: heading, status, facts, sessions, then the full-width **View tutee** link target. Filter chips wrap; search input and button stack without horizontal scrolling. The list is never a table. 320px width and 200% zoom must remain usable.

## 3. `/tutees/:userId` detail

- `h1`: display name; immediately beside it (and in text) the current `StatusBadge`.
- Native **Back to Tutees** link above the heading.
- Lead/status copy is tutor-facing and must not expose internal database errors.

### Summary facts

Use a labelled `dl`/definition list, not disabled inputs:

- **Status:** Pending / Approved / Denied / Revoked / Blocked
- **Email:** current email
- **Access requested:** `{date}`
- **Last decision:** `{date}` or **Not decided yet**
- **Access requests:** `{n}`
- **Can ask again:** `{date}` or **Now**; for Blocked: **No ? blocked until unblocked**
- **History:** **History starts {date}.** when there are no audit events, otherwise **{n} events shown**

Dates use the existing formatter and explicitly include the browser/tutor timezone label used elsewhere. Do not include an email address or user id in the URL or in announcements.

### Session summary and session rows

`h2` **Sessions**. Summary line: **{n} pending requests ? {n} accepted future sessions**. Show the latest session requests in chronological groups or a compact list with date/time, duration, and status (**Pending**, **Accepted**, **Declined**, **Cancelled**, **Past**). No note field exists or is displayed.

Each cancellable row has native **Cancel session**. A tutor cancellation uses the existing dialog pattern:

- title: **Cancel this session?**
- body: **This session will be cancelled and the time will become available again.**
- confirm: **Cancel session**
- cancel: **Keep session**

Past sessions cannot be cancelled. A revoked/blocked tutee?s kept accepted sessions remain visible to the tutor here; they are not silently removed.

### Decision history

`h2` **Decision history**. Render an ordered, newest-first timeline. Each event shows action (**Requested**, **Asked again**, **Approved**, **Denied**, **Access revoked**, **Restored**, **Blocked**, **Unblocked**, **Cooldown reset**), date/time, and session consequence where non-zero, e.g. **2 session requests ended**. There is no free-text note, name, email, or raw id in an event. If history is empty, state **History starts {date}; no decisions have been recorded yet.** The timeline is read-only and has no custom keyboard interaction.

## 4. Actions by status

Actions appear in a labelled `section` **Access actions**. The primary action is first; destructive actions are separated visually and never run from a single stray click. Buttons use visible text that is a prefix of their accessible name, including the tutee name where needed.

| Current status | Actions and exact visible labels |
|---|---|
| Pending | **Approve**, **Deny**, **Block** |
| Approved | **Revoke access**, **Block** |
| Denied | **Approve**, **Allow to ask again now**, **Block** |
| Revoked | **Restore access**, **Allow to ask again now**, **Block** |
| Blocked | **Unblock** |

`Restore access` is the approving transition from Revoked. `Approve` from Denied clears cooldown. `Allow to ask again now` only clears the retry cooldown; it does not approve access. The button is absent when the cooldown is already clear and the tutee is not blocked; show muted **Can ask again now** instead. `Block` is available for every non-blocked status and is permanent until the tutor chooses **Unblock**.

Immediate, low-risk actions (**Approve**, **Deny**, **Restore access**, **Allow to ask again now**, **Unblock**) show a loading label, keep the page context, then refresh the summary/timeline. They do not use a confirmation dialog. Errors stay beside the action: **We couldn?t update access. Try again.**

### Revoke confirmation

Clicking **Revoke access** opens a native `ConfirmDialog`:

- title: **Revoke access for {Name}?**
- body: **{Name} will no longer see your availability or request new sessions. Pending session requests will be declined. Accepted future sessions will stay in place unless you choose to cancel them below.**
- checkbox (unchecked by default): **Also cancel accepted future sessions**
- checkbox help: **This cancels all of {Name}?s accepted sessions after now and releases those times. Past sessions are unchanged.**
- confirm: **Revoke access**
- cancel: **Keep access**

The confirm button remains available with either checkbox choice. On success, announce **Access for {Name} was revoked. Pending session requests were declined.** If checked, append **{n} accepted future sessions were cancelled.** If zero, append **No accepted future sessions were cancelled.** Focus returns to the access-actions heading or the current status after the dialog closes. On failure, keep the dialog and show **We couldn?t revoke access. Try again.**

### Block confirmation

- title: **Block {Name}?**
- body: **{Name} will lose access. Pending session requests will be declined, accepted future sessions will stay in place unless cancelled below, and they will not be able to ask for access again until you unblock them.**
- checkbox (unchecked): **Also cancel accepted future sessions**
- checkbox help: **This cancels all accepted sessions after now. Past sessions are unchanged.**
- confirm: **Block tutee**
- cancel: **Keep access**

Success announcement: **{Name} was blocked. They cannot ask for access again until you unblock them.** Add the pending/accepted cancellation counts using the same wording as revoke. The tutee sees no retry date. Failure: **We couldn?t block {Name}. Try again.**

### Cooldown reset confirmation and outcomes

**Allow to ask again now** is immediate and announces **{Name} can ask for access again now. Access is not granted.** If the state changed, reload and announce **This tutee changed elsewhere. The page has been refreshed.**

All successful actions announce the new status and retain the decision timeline. No action sends an email to the tutee. No action adds a private note.

## 5. What the tutee sees

The tutor-facing statuses map to the existing tutee access view:

| Tutor status | Tutee-facing result |
|---|---|
| Pending | **Waiting for the tutor**; request date and **Check again**. |
| Approved | **You have access** and availability. |
| Denied | **Not approved at this time**; show **You can ask again after {date}** while cooldown is active, otherwise offer the normal fresh request form. |
| Revoked | **Not approved at this time**; same 8-hour retry date/cooldown as a denial. No word ?revoked? is shown. |
| Blocked | **Not approved at this time**; no retry date and no suggestion that asking again will work. |

There are no tutee emails for approve, deny, revoke, restore, block, unblock, or cooldown reset. The tutee learns the current state when opening the app or using **Check again**. A revoked/blocked tutee cannot view availability or list/cancel sessions; a kept accepted session remains a tutor-visible record. Existing tutee copy remains privacy-safe and does not reveal the tutor?s reason.

## 6. Accessibility and interaction requirements

- Use native links, buttons, input, checkbox, `dialog`, and form controls. No custom keyboard cursor, roving focus, arrow-key grid, or `tabindex`-based menu.
- Every filter chip and action has a visible label, `aria-pressed` where applicable, and a name containing its visible text. Touch targets are at least 44px.
- Use one persistent polite `StatusAnnouncer` per page for successful transitions, search/load-more results, and stale refreshes. Use `role="alert"` only for actionable errors.
- Loading regions expose `aria-busy="true"`; busy buttons retain context with labels such as **Revoking?**, **Blocking?**, **Saving?**, and **Loading?**.
- Dialogs have a labelled heading, initial focus on **Keep access**, Escape closes without saving, focus returns to the invoking button, and the checkbox is associated with its help text.
- On a detail action, focus moves to the updated status/summary heading. On list changes, focus moves to the relevant next card or list heading, never to a removed node.
- Status is conveyed by text and shape/label, never colour alone. Maintain 4.5:1 text contrast, visible focus, high-contrast compatibility, and reduced-motion support.
- Names/emails are text-only and escaped. Timeline and cards remain readable at 320px, 200% zoom, keyboard-only use, and with long unbroken strings.

## 7. Numbered acceptance criteria

1. A tutor sees **Tutees** immediately after **Calendar**, can open `/tutees`, and can return from a detail page with **Back to Tutees**.
2. The list provides native search, server-side results, filter chips **All**, **Pending**, **Approved**, **Denied**, **Revoked**, **Blocked**, accurate counts, and a native **Load more** flow.
3. A list card exposes name, email, status, request count, relevant dates/cooldown, and pending/accepted session counts, and opens the correct opaque-id detail route.
4. Initial empty, filtered empty, loading, search/load-more error, stale refresh, and loaded states match the specified copy and announcements.
5. At 320px and 200% zoom, filters wrap, cards stack, links/actions remain usable, and there is no horizontal scrolling or table layout.
6. Detail shows status, email, request count, request/decision dates, retry state, session summary, session rows, and a read-only decision timeline with no private notes or PII audit fields.
7. Pending actions are exactly **Approve**, **Deny**, and **Block**; approved actions are exactly **Revoke access** and **Block**; denied/revoked actions expose the specified restore/reset/block actions; blocked exposes only **Unblock**.
8. Revoke opens a confirmation titled **Revoke access for {Name}?**, defaults **Also cancel accepted future sessions** off, always declines pending requests, and explains that accepted future sessions are kept unless the checkbox is selected.
9. Block opens the specified permanent-block confirmation, declines pending requests, supports the same optional accepted-session cancellation, and communicates that unblocking is required before another request.
10. Revoke/block with the checkbox off keeps accepted future sessions; with it on cancels only accepted future sessions after now; past sessions are never cancelled. The UI announces actual counts.
11. **Allow to ask again now** clears only the 8-hour cooldown, announces that access is not granted, and never appears for Blocked.
12. All success/error/stale outcomes preserve context, use the exact user-facing messages, refresh the summary and timeline, and move focus to a valid heading or control.
13. Tutees see Pending, Approved, denial, revoked, and blocked states exactly through the existing projection: revoked is indistinguishable from denial except for the retry timing, and blocked has no retry date.
14. No action emails the tutee; no screen offers or stores a private note; history remains until account deletion.
15. Keyboard and screen-reader QA verifies native Tab/Enter/Space behaviour, labelled controls, `aria-pressed`, `aria-busy`, dialog Escape/focus restoration, live announcements, visible focus, non-colour status cues, and WCAG 2.2 AA contrast.
