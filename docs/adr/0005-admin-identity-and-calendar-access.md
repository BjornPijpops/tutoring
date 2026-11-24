# 0005 – Admin identity (Google) and calendar access control

**Status**: Accepted (2026-11-24). §4 stub and §5 "tutee view disabled" amended by ADR 0006 (access requests).

## Context
Google sign-in is configured in Supabase; Microsoft is deferred (no Azure account). The admin is one specific Google account. **The repository is public, so the admin's email address must never be committed** (code, SQL migrations, tests, docs, workflows). The access-approval feature (tutee requests, tutor approves) does not exist yet. Supabase's anon key is public by design, so the database must be safe against anyone holding it (ADR 0001: authorization lives in RLS).

## Decisions

### 1. Admin = row in an `admins` table, seeded once by the owner
Migration `…_calendar.sql` creates the (empty) table; the address exists only in the owner's database:
```sql
create table public.admins (email text primary key check (email = lower(email)));
alter table public.admins enable row level security;   -- no policies
revoke all on public.admins from anon, authenticated;  -- unreachable through the API
```
Owner seeds it once in the Supabase **SQL Editor** (documented in `docs/setup/external-setup.md` with a placeholder only):
```sql
insert into public.admins (email) values (lower('<ADMIN_GOOGLE_EMAIL>'));
```
Fail-closed: until seeded, nobody is admin. Tests and docs use `admin@example.test`.

### 2. `is_admin()` checks the verified identity, not client-editable claims
```sql
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
```
Why `auth.users` instead of the raw JWT `email`/`email_verified` claims: `user_metadata` (where `email_verified` is exposed in the JWT) is writable by the signed-in user, so a policy relying on it is spoofable; `auth.users.email` + `email_confirmed_at` are controlled by Supabase Auth (Google sets it confirmed). The JWT is still what identifies the caller (`auth.uid()`). Hardening (owner, dashboard / `config.toml`): **disable email+password sign-up and anonymous sign-ins** so nobody can register the admin address with a different method; only Google is enabled.
A future `profiles`/`roles` table may replace the allow-list; callers only use `is_admin()`, so that is a drop-in change.

### 3. RLS and privileges on `calendar_events`
```sql
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from anon, authenticated;
grant select, insert, update, delete on public.calendar_events to authenticated;
create policy calendar_events_admin_all on public.calendar_events
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
```
`anon` has no privileges at all. `authenticated` non-admins pass the grant but RLS returns zero rows / rejects writes. Tutees never read this table (ADR 0004 §8).

### 4. Tutee read path is a function that is closed by default
`get_blocked_intervals` (ADR 0004) allows `is_admin() or is_approved_tutee()`. This migration creates
```sql
create function public.is_approved_tutee() returns boolean
language sql stable security definer set search_path = '' as $$ select false; $$;
```
(same revokes/grants as `is_admin`). The access-approval feature will `create or replace` it to look up an approved request – **no calendar change needed**. So, **until that feature exists, signed-in non-admins get nothing** (an error from the RPC).

### 5. What visitors see until access approval exists
Options considered: (a) any signed-in user can read blocked intervals – rejected: any Google user on the internet could scrape the tutor's busy times; (b) public calendar – rejected, same reason; (c) **admin-only page now, tutee view disabled**. Chosen (c):
- `/calendar` signed out → short explanation + "Sign in with Google" button (the page leaks nothing).
- Signed in, not admin → "You don't have access yet" message (no data fetched).
- Admin → full calendar manager (grid + add/import/delete).
- The tutee read-only view is built from the same grid component but **not routed**; a single typed constant `TUTEE_CALENDAR_ENABLED = false` in `features/calendar` plus a `TODO(access-approval)` marks the switch-over. UI guards are UX only; RLS/RPC are the real enforcement, so flipping the flag early would still show nothing to unapproved users.

### 6. Minimal sign-in feature (in scope) – Supabase `AuthProvider` adapter
- Implements the existing port: `signIn('google')` → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })` with the PKCE flow; `signIn('azure')` returns a typed "not available yet" `PortError` (port and `SignInProvider` type unchanged, ready for Microsoft); `signOut`, `getSession`, `onSessionChange` map to `supabase.auth`.
- Role: after a session exists the adapter calls `rpc('is_admin')` and sets `User.role = 'tutor'` if true, else `'tutee'`. The email is **not** put in the domain `User` (existing rule: minimal personal data) and never read from the client to decide anything.
- Callback: `detectSessionInUrl` handles the redirect (ADR 0003, HashRouter). `redirectTo` = `${origin}${basePath}` so it works for localhost and Pages; both URLs must be in Supabase's allowed redirect list (owner says Google is set up; verify).
- UI in scope: the existing login page wired to the real provider (Google enabled, Microsoft button disabled with "coming soon" text), sign-out control in the layout, `RequireRole('tutor')` guard around the admin calendar. Nothing else of the auth/access features.
- Container: use Supabase adapters when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are present, otherwise memory adapters (dev/tests). Deployed builds need the two values as GitHub Actions **variables** (public values).

### 7. Verification expectations (QA)
With only the anon key via REST: `select` on `calendar_events` and `admins` fails/empty, insert fails, `rpc/get_blocked_intervals` and `rpc/is_admin` rejected. As a non-admin Google user: events table returns 0 rows, writes rejected, RPC raises. As admin: full CRUD and RPC works. No email address appears in `git grep`.

## Consequences
- The database is never open to the public; a leaked anon key grants nothing.
- Admin identity lives only in Supabase; rotating the admin = one SQL statement.
- Dependence on `auth.users` (Supabase-managed schema) inside a `security definer` function; stable and documented, covered by the QA checks above.
- Until access approval ships, tutees cannot use the calendar (intentional).
- Single-admin model; multiple tutors would need a different data model.
