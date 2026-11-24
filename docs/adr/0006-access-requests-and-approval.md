# 0006 – Tutee access requests, approval and the tutee calendar route

**Status**: Accepted (2026-11-24). Replaces the stub in ADR 0005 §4 and the "tutee view disabled" part of ADR 0005 §5.

## Context
Any Google account can sign in (ADR 0005), but only the tutor and **approved tutees** may see blocked time (ADR 0004 §8). Scope of this feature: a signed-in non-approved user requests access and sees its status; the tutor lists, approves, denies and revokes; approved tutees get the read-only availability view; the tutor is emailed for each new request (ADR 0007). Timeslot requests are the next feature and must be able to reuse `is_approved_tutee()` in their own RLS. The repo is public; tutees may be minors (GDPR).

Existing code reused: domain `AccessRequest`/`AccessStatus`, port `AccessRequestRepository`, memory fake, `RequireRole`, unrouted `AvailabilityPage` behind `TUTEE_CALENDAR_ENABLED`, `get_blocked_intervals` (already `is_admin() or is_approved_tutee()`).

## Decisions

### 1. Schema (new migration `supabase/migrations/20261125000000_access_requests.sql`; applied migrations are never edited)
`public.access_requests` – **one row per user**:

| column | type | notes |
|---|---|---|
| `user_id` | `uuid primary key references auth.users(id) on delete cascade` | one row per user by construction; cascade = deletion path (§5). Domain `AccessRequest.id` = `userId`. |
| `status` | `text not null default 'pending'` | `check (status in ('pending','approved','denied'))` (matches domain `AccessStatus`) |
| `message` | `text not null default ''` | `check (char_length(message) <= 500)`; optional |
| `created_at` | `timestamptz not null default now()` | first request |
| `requested_at` | `timestamptz not null default now()` | latest (re)submission |
| `decided_at` | `timestamptz null` | `check ((status = 'pending') = (decided_at is null))` |
| `request_count` | `integer not null default 1` | Number of submissions, for audit/analytics only; no lifetime cap |
| `next_request_at` | `timestamptz null` | Server-enforced cooldown end after a denial; tutor allow-again clears it |
| notification state | - | Stored per event in `access_request_notifications` (ADR 0007) |

`public.access_request_notifications` is an outbox with one row per initial request or re-request (`id` UUID primary key, `user_id`, `requested_at`, `created_at`, `sent_at`, `attempts`). It contains no copied PII; `user_id` references `access_requests` with cascade. The unique event id makes retries and re-requests distinct.

**No name or email column.** Name and email already live in `auth.users` (Google profile). Duplicating them would double the PII and need a second deletion. The tutor-facing RPC joins `auth.users` live (§3). Display name = `raw_user_meta_data->>'full_name'` (fallback `'name'`, fallback the email local part), trimmed and cut to 100 characters on read; it is display-only and never used for authorization (`user_metadata` is user-editable, ADR 0005 §2). Email always comes from `auth.users.email`.

### 2. Status model and state machine
Three statuses; **revoking = approved → denied** (a separate `revoked` status adds no behaviour; add it only if an audit trail is ever needed).

| From → To | Who | Rule |
|---|---|---|
| (none) → pending | the user | `request_access(message)`; not for admins |
| pending → approved / denied | tutor | `decide_access_request` |
| approved → denied (revoke) | tutor | any time; takes effect on the next server call |
| denied → approved | tutor | tutor may change their mind |
| denied → pending (re-request) | the user | only if `next_request_at is null or next_request_at <= now()`; sets `requested_at = now()`, new `message`, `request_count + 1`, `decided_at = null`, `next_request_at = null`, and creates a new notification event |
| approved → pending, pending → pending | – | rejected; `request_access` on an existing pending/approved row returns it unchanged (no new event) |

Revoke and deny look identical to the tutee ("not approved at this time", plus the date they may ask again, or the cooldown end time). Transitions are enforced **only** inside the security-definer functions (§3); the table accepts no direct writes.

### 3. RLS, privileges and functions
- `alter table … enable row level security`; `revoke all … from public, anon, authenticated`; `grant select … to authenticated`.
- Policy `access_requests_select`: `for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()))`. **No insert/update/delete policies or grants**: a user cannot choose a status, another user's id or any timestamp, and cannot write at all except through the functions below. (Chosen over "insert policy + column grants + trigger": the re-request rule and the pending cap are multi-row/stateful and are atomic and testable in one function.)
- All functions: `security definer`, `set search_path = ''`, schema-qualified, `revoke all … from public, anon`, `grant execute … to authenticated`; each raises `42501` if `auth.uid()` is null.

| Function | Caller | Behaviour |
|---|---|---|
| `request_access(p_message text) returns public.access_requests` | any signed-in non-admin | validates length (≤ 500, trims), applies §2 and §4, upserts the caller's row, returns it |
| `decide_access_request(p_user_id uuid, p_decision text) returns public.access_requests` | `is_admin()` only | `p_decision in ('approved','denied')`; applies §2; sets `decided_at = now()` and, when denying/revoking, `next_request_at = now() + interval '8 hours'`; raises on an illegal transition |
| `allow_access_request_again(p_user_id uuid) returns public.access_requests` | `is_admin()` only | Tutor action "Allow to ask again now"; only denied rows; clears `next_request_at` server-side and returns the row |
| `list_access_requests(p_status text default null)` returns `(user_id, display_name, email, message, status, requested_at, decided_at)` | `is_admin()` only | joins `auth.users`; `null` = all; ordered pending first, then newest; hard limit 200 rows |
| `get_my_access() returns table(is_admin boolean, status text)` | any signed-in | one round trip for the session bootstrap; `status` is `null` when no request exists |
| `is_approved_tutee() returns boolean` (**`create or replace`** of the stub) | any signed-in; used inside other policies/functions | `select exists (select 1 from public.access_requests r where r.user_id = (select auth.uid()) and r.status = 'approved')`; same security-definer/revoke/grant as `is_admin()` |

`is_approved_tutee()` is the single reusable predicate: the timeslot feature will write `using ((select public.is_approved_tutee()))` / `with check (…)` on its own table. `get_blocked_intervals` is **not touched** and now works for approved tutees. Revocation is therefore effective immediately for all server-side reads.

### 4. Anti-abuse
Sign-in is Google-only and email sign-up/anonymous are disabled (ADR 0005), so every requester has a verified Google account.
- One row per user (primary key); no way to create more rows for the same account.
- Message ≤ 500 characters, constraint in the DB plus the same limit in the form (zod) and a visible counter.
- Re-request only after denial and an **8-hour cooldown** (`next_request_at`). The cooldown is set by the server on every denial; the tutor can use `allow_access_request_again` to clear it sooner. There is no lifetime attempt cap; `request_count` is audit data only. The cooldown and max-pending rule are enforced in SQL and mirrored in the UI text.
- **Pending cap**: `request_access` raises (`P0001`, message `access requests are temporarily closed`) when more than **50** rows are pending. This bounds the damage from mass-created Google accounts (queue size, emails) until the tutor clears the queue; tutor is unaffected.
- Email volume is bounded by the pending cap, the 8-hour cooldown and Resend's 100/day (ADR 0007).
- Messages are untrusted text: rendered as text only in the UI and HTML-escaped in the email.
- No IP-based limiting (not available on the free tier without extra services; not needed at this scale).

### 5. Privacy / GDPR
- **Stored**: Google user id (already in Auth), request status, optional message, timestamps. Name/email are *read from Auth*, not copied.
- **Who sees what**: the requester sees only their own row (status, message, dates). The tutor sees name, email, message and status of requesters (needed to recognise the person). Other tutees never see anything. Anonymous users: nothing (no grants).
- **Third party**: Resend (email processor) receives name, email and message in the notification email to the tutor; mention this in the form notice (below). Supabase hosts the data.
- **Notice on the request form** (short, plain language, from `ui-ux-designer`): what is sent (Google name, email, your message), who sees it (only the tutor), why (to decide on access), how long (until access is no longer needed or you ask for deletion), how to delete.
- **Deletion path**: on request (outside the app), the owner deletes the user in Supabase **Authentication → Users**; `on delete cascade` removes the request row. No other table keeps PII in this feature. Retention: rows are kept while the account is active; the owner reviews and deletes denied/old users from the dashboard (a self-service "delete my data" button is out of scope and can be added later as a security-definer function that deletes the caller's `auth.users` row via an Edge Function).
- **Minors**: the form asks for no age, school or contact details beyond the Google account; the optional message is free text, so the form says "do not include sensitive information".
- Logs never contain name, email or message (ADR 0007).

### 6. Client model and what it reads
Domain (`core/domain/user.ts`): keep `Role = 'tutor' | 'tutee'`; add
```ts
export type AccessState = AccessStatus | 'none'; // 'none' = signed in, never requested
interface User { id; displayName?; role; accessState: AccessState }
```
`SupabaseAuthProvider.getSession` replaces its `rpc('is_admin')` call with `rpc('get_my_access')` and fills `role` (`tutor` when `is_admin`) and `accessState`. For the tutor, `accessState` is irrelevant. Email is still not in the domain `User`.

Ports:
- `AccessRequestRepository` becomes: `requestAccess(message): PortResult<AccessRequest>` (renamed from `request`), `getMine(): PortResult<AccessRequest | null>` (RLS `select` of own row), `listRequests(status?): PortResult<readonly AccessRequestSummary[]>` (RPC; replaces `listPending`), `decide(userId, decision): PortResult<AccessRequest>`. `AccessRequest` gains `message`, `requestedAt`, `decidedAt: IsoDateTime | null`, `nextRequestAt: IsoDateTime | null`, `requestCount`; the tutor DTO exposes whether the allow-again action is available; `AccessRequestSummary` adds `displayName` and `email` (tutor-only DTO). The in-memory fake implements the same state machine so the UI and rules are testable without a database; a shared contract test runs against the fake and (via PGlite, as in ADR 0004 tests) the SQL functions.
- Server errors map to typed `PortError`s: `42501` → forbidden, `P0001` closed/cooldown → `conflict` with a stable code the UI turns into text (never show raw SQL messages).

### 7. Routes and guards
| Route | Guard | Content |
|---|---|---|
| `/access` | `RequireAuth` (signed in) | Not approved: request form (`none`), or status (`pending` / `denied` + retry date). Approved tutees and the tutor are redirected to `/availability` / `/calendar`. |
| `/availability` | new `RequireAccess` | Existing `AvailabilityPage` (tutee mode, intervals only) |
| `/calendar` | `RequireRole('tutor')` (unchanged) | Tutor manager |
| `/access-requests` | `RequireRole('tutor')` | Pending list with Approve/Deny; "All" tab with Revoke/Approve for decided ones; pending count badge in the nav |

`RequireAccess` allows `role === 'tutor'` **or** `accessState === 'approved'`; signed out → sign-in; signed in but not approved → redirect to `/access`. `TUTEE_CALENDAR_ENABLED` and its `TODO(access-approval)` are removed.
The client state is a UX cache; **the server stays the source of truth**:
- `get_my_access` is re-fetched on sign-in, on window focus/visibility and via a "Check again" button on the pending screen (no polling, no realtime: free tier, ~10 users).
- If `get_blocked_intervals` fails with `42501` (revoked while the page is open) the page refreshes the session state and the guard redirects to `/access` with a "your access ended" message.
- Flipping client state by hand shows an empty/denied page at worst: RLS and the RPC enforce access (QA verifies with REST calls).

## Consequences
- The request and tutor actions (`request_access`, `decide_access_request`, `allow_access_request_again`) are the only writes; everything else is read-only and RLS-checked. Policies are simple and testable; the state machine is in one place.
- PII is not duplicated; deleting the Auth user fully removes the request.
- A leaked anon key or any signed-in stranger can create at most one pending row (until the cap of 50 is hit) and read nothing but their own row.
- Revocation is immediate server-side; the client reflects it on the next fetch.
- Cost: one extra RPC per session bootstrap (replaces `is_admin`, same count).
- The 50-pending cap can lock out genuine newcomers during an attack; the tutor clears the queue by denying. Acceptable at this scale.
