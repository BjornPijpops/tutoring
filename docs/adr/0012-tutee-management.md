# 0012 – Tutor "Tutees" management area: lifecycle, revoke, audit trail

**Status**: Proposed (2026-11-24). Extends ADR 0006 (access requests) and ADR 0010 (session requests); the optional `revoked`/`blocked` statuses and the audit trail that ADR 0006 §2 deferred ("add it only if an audit trail is ever needed") are now needed. Email behaviour is unchanged (ADR 0007, ADR 0011).

## Context
The tutor wants general management of tutees: end access at any time, see who requested and who was denied (history), reset a cooldown instantly, and manage the rest in one place.

### Inventory: what already exists (do not rebuild)
| Need | Exists today | Gap |
|---|---|---|
| Request, approve, deny | `request_access`, `decide_access_request`, `/access-requests` page (tabs Pending / Approved / Declined, `RequestCard`, `RequestList`, nav badge via `pending-count`) | none |
| Revoke | "Revoke" button = `decide_access_request(…, 'denied')` (approved → denied) | indistinguishable from a denial; no history; starts an 8 h cooldown; nothing happens to the tutee's sessions |
| Reset cooldown | `allow_access_request_again` (denied rows only) and the "Allow to ask again" button | works; no audit; not available to any other state |
| Request count, dates | `request_count`, `created_at`, `requested_at`, `decided_at`, `next_request_at` columns, shown on the card | only latest decision is kept; no per-event history |
| Status lookup for the tutee | `get_my_access`, `/access` page | none |
| Tutor session decisions | `session_requests`, `decide_session_request`, `/session-requests` page (pending only) | no per-tutee view; no tutor cancel of an accepted session |
| Search / filter / detail / block / audit | **missing** | this ADR |

Latent defects in the current RPCs that this ADR fixes because they are tightly coupled to the new actions:
- `decide_access_request` re-applied to the same status silently rewrites `decided_at` and restarts the cooldown (deny twice = new 8 h; approve twice = new date). It must reject a no-op transition.
- Revoking leaves **pending and accepted `session_requests` untouched**. A revoked tutee keeps accepted sessions on the tutor calendar and can still call `cancel_session_request` / `list_my_session_requests` (neither checks approval).

## Decisions

### 1. Reuse and extend; one new area, no parallel feature
- Keep `access_requests` (one row per user) as the source of truth for current status; keep `/access-requests` as the **pending inbox** (nav badge unchanged) and `/session-requests` as the pending session inbox.
- Add a tutor-only **Tutees** area: `/tutees` (list) and `/tutees/:userId` (detail). "Tutees" lists everyone who ever requested access (a row in `access_requests`). People who signed in but never requested access have no row and are intentionally not listed.
- Reuse `FilterTabs`, `StatusBadge`, `StatusMessage`, `StatusAnnouncer`, `RequestCard` pieces and `formatMoment`. Add a `TuteeRepository` port (list, detail, act, allowAgain) next to `AccessRequestRepository`; a memory fake implements the same state machine and a shared contract test runs against it and the SQL functions via PGlite (as in ADR 0006). Features never import Supabase types.

### 2. Status model (migration `20261126…_tutee_management.sql`; applied migrations are never edited)
Statuses become `pending | approved | denied | revoked | blocked` (`access_requests_status` check replaced; `access_requests_decision_consistency` stays valid because only `pending` has a null `decided_at`).

- `revoked`: tutor ended previously granted access. Distinct from `denied` so the tutor can see "who was denied" vs. "who lost access" and so history is meaningful.
- `blocked`: permanent; the person cannot re-request until the tutor unblocks. Meant for abuse, not routine use.

| From → To | Action (tutor) | Rule |
|---|---|---|
| pending → approved | approve | sets `decided_at`, clears `next_request_at` |
| pending → denied | deny | sets `decided_at`, `next_request_at = now() + 8 h` |
| approved → revoked | revoke | any time; sets `next_request_at = now() + 8 h`; session policy (§4) |
| denied / revoked → approved | approve / restore | clears cooldown |
| denied / revoked → (cooldown cleared) | allow to ask again now | `next_request_at = null`; status unchanged; only for `denied`/`revoked` |
| any non-blocked → blocked | block | `next_request_at = null`; session policy (§4); tutee cannot re-request |
| blocked → denied | unblock | cooldown cleared so they may ask again |
| denied / revoked → pending | the tutee | `request_access`, only when `next_request_at is null or <= now()`; unchanged from ADR 0006 and also allowed from `revoked`; **rejected for `blocked`** (`P0001`, `access request blocked`) |
| same → same | – | rejected with stable code (stale state), never rewrites `decided_at`/cooldown |

The tutor row and non-existent users are rejected (`no_data_found`). A new-request notification event fires for denied/revoked → pending exactly as today (trigger condition extended to `old.status in ('denied','revoked')`).

**Tutee-facing projection.** `revoked` and `blocked` look like `denied` to the tutee ("not approved at this time", plus the retry date unless blocked, in which case no date and no suggestion to retry). `get_my_access` and the own-row read return `denied` for both; the tutee never learns the word "blocked". The client `AccessState` therefore does not gain new values.

### 3. Server API (all `security definer`, `set search_path = ''`, schema-qualified, `revoke all … from public, anon`, `grant execute … to authenticated`; each raises `42501` when `auth.uid()` is null and `42501 admin required` unless `is_admin()`)
| Function | Behaviour |
|---|---|
| `list_tutees(p_status text default null, p_search text default null, p_limit int default 50, p_offset int default 0)` | tutor-only; returns `user_id, display_name, email, status, created_at, requested_at, decided_at, next_request_at, request_count, pending_sessions, accepted_future_sessions` plus total count; search is a case-insensitive substring on display name **and** email with `%`, `_`, `\` escaped; limit capped at 100; order: pending first, then `requested_at desc` |
| `get_tutee_detail(p_user_id uuid)` | tutor-only; the summary above, `message`, the latest 20 session requests (range, status, timestamps – no free text exists) and the latest 50 audit events (§5) |
| `act_on_tutee(p_user_id uuid, p_action text, p_session_policy text default 'keep')` | tutor-only single entry point for `approve, deny, revoke, restore, block, unblock`; `p_action in (…)` and `p_session_policy in ('keep','cancel_all')` validated; locks the access row `for update` and, when sessions are touched, calls `private.lock_schedule()` first (same order everywhere to avoid deadlock); applies §2; applies §4; writes the audit row in the same transaction; returns the updated row |
| `allow_access_request_again(p_user_id)` | kept; extended to `revoked`, audited |
| `decide_access_request(p_user_id, p_decision)` | kept for the existing inbox; becomes a thin wrapper over the same private transition function (`approved`→approve, `denied`→deny, and revoke when the row is approved) so there is one state machine |
| `list_access_requests` | unchanged (inbox) |

Search runs in SQL, not in the browser: the list is paginated and the tutor email/name must not all be shipped to filter client-side once the count grows. For ≤ 200 tutees the client may still cache the current page.

### 4. What happens to the tutee's sessions
`act_on_tutee` for `revoke` and `block` takes `p_session_policy`:
- **Pending session requests are always ended** in the same transaction: `pending → declined`, `decided_at = updated_at = now()` (they can no longer be accepted anyway; reusing `declined` adds no new status or UI state).
- **Accepted sessions are kept by default** (`keep`): revoking access ends the right to *request and view*, not a lesson already agreed; silently removing it would surprise tutor and tutee, and no tutee notification exists (§6). The tutor may choose `cancel_all`, which sets future accepted sessions to `cancelled` (`cancelled_at = now()`), releasing the slot. Past sessions are never touched.
- To end a single accepted session without revoking, add `cancel_session_as_tutor(p_request_id)` (tutor-only, accepted/pending, same locking). The detail page lists the tutee's sessions with a Cancel action.
- A revoked/blocked tutee can no longer create requests (`is_approved_tutee()`), view availability (`get_blocked_intervals`), or **list/cancel** sessions: `list_my_session_requests` and `cancel_session_request` gain `public.is_approved_tutee()`; kept accepted sessions are visible to the tutor only. This is a behaviour change to existing RPCs and needs tests.
- `approve`/`restore` never resurrect declined or cancelled sessions.

### 5. Audit / history trail
New append-only table `public.access_audit_log`:

| column | type / rule |
|---|---|
| `id` | `bigint generated always as identity` primary key |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` (history is removed with the user) |
| `actor_id` | `uuid null` (tutor id for management actions, the user for their own requests; no foreign key so removing the tutor account never erases history) |
| `action` | `text not null` check in (`requested`, `re_requested`, `approved`, `denied`, `revoked`, `restored`, `blocked`, `unblocked`, `cooldown_reset`) |
| `from_status`, `to_status` | `text null`, same value set as the status check |
| `sessions_ended` | `integer not null default 0` (count of pending declined + accepted cancelled by this action) |
| `created_at` | `timestamptz not null default now()` |

- **No free text, no name, no email, no message** in the table; ids, enums, counts and timestamps only. That makes the trail safe to keep, export and show without extra personal-data handling. Names/emails are joined live from `auth.users` by the tutor-only RPCs.
- RLS enabled; `revoke all` from `public, anon, authenticated`; no policies and no grants: written only by the definer functions (`request_access`, `act_on_tutee`, `allow_access_request_again`, `decide_access_request`) in the same transaction as the change, read only through `get_tutee_detail`. Updates/deletes are never granted, so rows are append-only for clients.
- `request_count` stays as a cached counter; the audit log is the authoritative history. Existing rows are not backfilled (history starts at deployment); the detail page states "History starts <date>" when a tutee has no events.
- Index `(user_id, created_at desc)`.

### 6. Email policy
Unchanged and explicit: **email goes to the tutor only** (ADR 0007/0011; Resend sandbox limit). No email is sent to tutees for approve, deny, revoke, restore, block or allow-again, and no new email is sent to the tutor for actions the tutor performs. The tutee sees the new status the next time the app loads or refreshes (`get_my_access` on sign-in, focus, "Check again"; ADR 0006 §7). Tutee email addresses are exposed only by tutor-only RPCs and never logged or placed in URLs (`/tutees/:userId` uses the opaque auth uuid).

### 7. Authorization and security requirements
- Admin-only enforcement lives in each function via `public.is_admin()`; the route guard `RequireRole('tutor')` is UX only.
- Functions do not accept a role, actor or status from the client beyond the validated enum parameters; `actor_id` is always `auth.uid()`.
- Anonymous and non-admin callers get `42501`; a revoked tutee calling any tutee RPC gets `42501`.
- Hard caps: page size ≤ 100, search string ≤ 100 characters (trimmed, wildcard-escaped), detail lists bounded (20/50).
- Revocation is effective immediately for all server reads (`is_approved_tutee()`), as in ADR 0006; the open page of a revoked tutee redirects on the next failed call (existing `42501` handling).
- Errors map to typed `PortError`s with stable codes (`stale-state`, `blocked`, `forbidden`); raw SQL messages never reach the UI.
- Tests (tech-lead/QA): non-admin and anon calls; forged `p_user_id`/status/action; each transition incl. rejected no-ops; cooldown reset for denied and revoked; blocked cannot re-request; revoke with `keep` vs `cancel_all`; pending sessions declined; revoked tutee cannot list/cancel sessions; audit row per action and none containing PII; deletion cascade; search wildcard escaping; concurrency (revoke vs create_session_request, revoke vs accept).

### 8. UI scope for `ui-ux-designer` (summary)
List with search box, status filter tabs with counts (Pending, Approved, Denied, Revoked, Blocked, All), pagination ("Load more"); row shows name, email, status badge, request count, last activity, cooldown remaining. Detail page: facts, session summary, history timeline, actions with confirmation dialogs (revoke asks about accepted sessions; block states it is permanent until unblocked). Actions are keyboard accessible and announced via `StatusAnnouncer`; destructive actions never run on a single stray click.

## Alternatives rejected
- **Keep revoke = denied.** No distinction between "never approved" and "access ended", and no history; the owner explicitly asked for tracking.
- **Per-status columns / array of history in `access_requests`.** Unbounded rows in one row, awkward to query and to constrain; an append-only table is simple and cascade-deletable.
- **Direct table writes with RLS for admin.** Violates the single-state-machine rule of ADR 0006 and cannot cover session side effects atomically.
- **Delete the row to "reset".** Loses `request_count` and history; allow-again already solves it.
- **Triggers on status change instead of explicit audit inserts.** Hides the actor and session counts; functions already own every write.
- **Client-side search over an unbounded list.** Ships all PII to the browser and breaks at the 200-row list cap.
- **Emailing tutees.** Out of scope (Resend sandbox, minors, privacy posture).

## Consequences
- One additional migration adds statuses, the audit table, `list_tutees`, `get_tutee_detail`, `act_on_tutee`, `cancel_session_as_tutor`, and tightens `list_my_session_requests`, `cancel_session_request`, `decide_access_request`, `allow_access_request_again`, `request_access`. Existing UI keeps working; the inbox pages are not rewritten.
- The tutor gets complete tutee oversight without new infrastructure or cost; all new endpoints are RPCs on the free tier.
- Audit rows grow by a few per tutee; negligible. They are deleted with the user, which must be mentioned in the GDPR deletion procedure (ADR 0006 §5): deleting the Auth user removes `access_requests`, session requests and the audit trail.
- A revoked tutee with a kept accepted session cannot see or cancel it; the tutor must contact them (no email). This is an accepted trade-off and the first open question.
- Latent defects (idempotent re-decision, un-gated own-session RPCs) are fixed and covered by tests.
