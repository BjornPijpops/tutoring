# ADR 0010 – Timeslot requests, authorization and overlap integrity

**Status**: Accepted (2026-11-24)

## Context

Approved tutees need to select a future tutoring range on the existing `SelectableTimeGrid`. The grid already renders anonymous blocked intervals and has a `GridBlock` view-model boundary; it must now also render a tutee’s own pending/accepted requests as a distinct, non-striped `busy` kind. A tutee must never receive another tutee’s identity, request, title, or event id.

The browser is an untrusted client. Availability, authorization, range validation, cancellation, acceptance, and conflict handling therefore belong in Supabase security-definer RPCs and database constraints. Existing `calendar_events` contains tutor-owned blocked events and is readable only by the tutor; `get_blocked_intervals` is the privacy-preserving read path for approved tutees. Times are stored as UTC instants and displayed in `Europe/Brussels` (08:00–22:00).

## Decision

Add a dedicated session-request model and keep it separate from `calendar_events` and from the access-request workflow. The client uses a `SessionRequestRepository` port; features do not import Supabase types. The tutee grid strategy can select only a future free range and maps the result to `create_session_request`; it cannot call calendar-event mutation methods.

### Lifecycle and data model

Create `public.session_requests` with:

| Column | Type / rule |
|---|---|
| `id` | `uuid` primary key, generated server-side |
| `user_id` | `uuid` not null, references `auth.users(id)` on delete cascade |
| `starts_at`, `ends_at` | `timestamptz` not null; persisted UTC instants |
| `status` | `pending`, `accepted`, `declined`, or `cancelled` |
| `created_at`, `updated_at` | server timestamps |
| `decided_at` | nullable; set by tutor decisions |
| `cancelled_at` | nullable; set by the owning tutee |

Use a half-open interval `[starts_at, ends_at)` so adjacent sessions are valid. Do not copy name or email into this table. An optional note is **not** part of the initial schema; add a bounded, text-only field only if the owner accepts the product question in the handoff.

Allowed transitions are enforced in RPCs, not client state or direct table writes:

- approved tutee → `pending` via `create_session_request`;
- tutor → `accepted` or `declined` via `decide_session_request`;
- owning tutee → `cancelled` from `pending` or `accepted` via `cancel_session_request`.

A cancelled accepted request releases its interval. Historical rows remain for audit but are not exposed to other tutees. Tutor views may include the requester’s Auth display name and email because the tutor must identify the request; this is a tutor-only projection.

### Server-side validation and authorization

Every RPC is `security definer`, uses `set search_path = ''`, schema-qualifies all names, rejects anonymous callers, and has execute granted only to `authenticated`. There are no client insert/update/delete grants. `is_approved_tutee()` is the single reusable access predicate.

`create_session_request` validates, in the tutor timezone:

- the requested range is on one local Brussels day;
- start and end are aligned to 30-minute boundaries and fall within 08:00–22:00;
- the range ends in the future, starts at least 24 hours from now (exact instant), and its local Brussels start date is at most 30 calendar days after the current Brussels date (a calendar-date check, independent of time of day and DST);
- the range has a minimum of 30 minutes and a maximum of 2 hours, measured, like the 30-minute grid, on local Brussels wall-clock times;
- the caller is approved and has not exceeded the pending-request cap;
- the range does not overlap a tutor `calendar_events` block or an accepted session.

The server repeats all validation even when the grid has already applied the same rules. RPC errors map to stable typed client errors; raw SQL messages never reach the UI.

**Clock changes.** Local times on the last Sundays of March and October can be nonexistent (spring) or ambiguous (autumn). Rule: a range whose elapsed duration differs from its local wall-clock duration (end local minus start local) is rejected with `ambiguous_local_time` (SQLSTATE 22023; client code `ambiguous-local-time`, shown as "This time range spans a clock change. Choose a different time."). No attempt is made to resolve such times. Because bookable hours are 08:00–22:00 this only affects malformed or hostile requests, and the client pure rules (`validateSessionRequestRange`) mirror the same checks so the UI and server agree. The table constraint on elapsed duration stays as a backstop.

`list_my_session_requests` returns only the caller’s own ranges and statuses. The approved tutee view projects those rows as `GridBlock` values with `kind: 'busy'`, a generic label such as `Your requested session`/`Your session`, and no tutor event metadata. Pending and accepted blocks are visually distinct from striped anonymous `blocked` blocks. `get_blocked_intervals` must be amended to union tutor blocked events with accepted session intervals, merge touching/overlapping ranges, and continue returning intervals only; other tutees see no names, request ids, or boundaries attributable to a person.

`list_session_requests_for_tutor` is tutor-only and returns the request id, range, status, and the minimum Auth identity fields needed for the decision UI. `list_accepted_sessions_for_tutor(p_from, p_to)` is tutor-only and returns accepted sessions (id, range, display name) for the read-only blocks on the tutor calendar. `decide_session_request` rechecks the request state and all conflicts at the moment of acceptance. A stale or conflicting acceptance returns a typed conflict and leaves the request pending for the tutor to resolve.

### Race-free overlap integrity

Use both database-level and transaction-level protection:

1. Add a GiST exclusion constraint on `tstzrange(starts_at, ends_at, '[)')` for rows whose status is `accepted`, preventing concurrent accepted-session overlap.
2. Add a shared transaction advisory lock for the tutoring schedule. `create_session_request` and `decide_session_request` acquire it before checking `calendar_events` and accepted sessions, so two tutee writes cannot pass each other.
3. Reject overlaps with blocked events and accepted sessions at the request boundary (on creation and again on acceptance), rather than relying on client refreshes. The lock and the exclusion constraint together cover double-booking races between two tutees.

**Owner decision (2026-11-24, supersedes the earlier trigger design):** the tutor must never be blocked from adding manual events or importing ICS files because of an accepted session. There is therefore **no trigger or constraint on `calendar_events`**, and writes to it do not take the lock. The tutor's calendar wins: if a blocked event is added over an accepted session, the session stays accepted and both are shown on the tutor calendar (the session as a read-only block, listed by the tutor-only `list_accepted_sessions_for_tutor`). Tutees see the merged anonymous interval. Acceptance of a pending request over a newer blocked event fails with the stable conflict and the request stays pending. A race between the tutor adding an event and acceptance of an overlapping request is accepted: the worst case is an overlapping, tutor-visible session that the tutor can cancel through the owner or reschedule outside the app.

The lock key is a fixed, documented application constant and is held only for the transaction. Existing calendar RLS remains tutor-only. Closed hours are a validation rule, not rows in the event table.

### Grid and UI boundary

Reuse `SelectableTimeGrid`, `GridBlock`, `GridBlockKind`, `time-grid-selection`, and the existing Brussels conversion helpers. The tutee strategy receives only public blocked intervals and the current user’s own request projection. It uses read-only anonymous `blocked` blocks plus non-striped `busy` blocks; it never receives `calendar_events.title`, `calendar_events.id`, or another user’s request data. The tutor continues to see titled/imported blocks and request decisions in a separate admin view.

Tutees can cancel their own pending or accepted request from the own-session view. Cancellation is an explicit action with a confirmation for an accepted session; it does not delete history. The UI refreshes the visible range after success and retains form values on conflict/error. The grid remains selection-capable only in the tutee-request strategy and stays read-only for anonymous blocked blocks.

## Consequences

- Authorization and conflict safety remain server-authoritative and testable without trusting the SPA.
- Accepted sessions become anonymous unavailable time for every other approved tutee without exposing personal data.
- The advisory-lock path on the request side is more deliberate than a client-side availability check; the tutor's calendar write path is intentionally left untouched (owner decision), so tutor writes can never fail because of a session.
- Product limits must be chosen before the migration is finalized; they are constants in the RPC contract and mirrored in the UI.
- Cancelled and declined history is retained in Supabase and must be included in the owner’s GDPR retention/deletion procedure.
- The existing `SessionRequestRepository` interface needs range-based create, own-list, tutor-list, decision, and cancellation operations; the placeholder `slotId` contract is superseded by this range-based model.

## Security and privacy requirements

- RLS is enabled on `session_requests`; direct client writes are revoked.
- Other tutees can obtain only merged anonymous unavailable intervals and their own requests.
- Names, emails, notes, and request ids are never placed in public grid blocks, URLs, logs, or notification payloads sent from the browser.
- User-authored text is length-limited, rendered as text, and escaped in any email.
- Tests must cover non-approved callers, cross-user reads, forged status/user ids, cancellation ownership, concurrent acceptance, blocked-event races, and the absence of private fields in the tutee projection.