# Availability calendar implementation plan

**Status: BIG change — implementation plan for developer; owner verification gate applies.**
**Inputs:** ADRs 0001–0005, `docs/design/availability-calendar.md`, existing skeleton, and the 2026-11-24 architect/UI handoff.

## 0. Branch and scope gate

- Verified with Git: current branch is `feature/availability-calendar`; `main` and this branch currently point to `86ea924` (`docs: use --remote for supabase db push`); `git merge-base --is-ancestor main feature/availability-calendar` succeeds. No direct commit to `main` was made, and the working tree contains only the expected untracked design/ADR/handoff documents.
- This plan is docs-only for the tech-lead phase. Do not switch branches or commit during this phase.
- This is a **BIG change**. Developer implements only after reviewer approval of the plan. After developer + QA + reviewer approval, **STOP and ask the owner to verify locally** (including Supabase/RLS and the live-flow prerequisites) before any merge. No merge is allowed before that gate.

## 1. Patterns and non-negotiable boundaries

Use Ports & Adapters/Repository for Supabase and ICS, pure domain functions for all interval/date logic, a Factory + Dependency Injection composition root, and Container/Presentational React components. `core` has no React, Supabase, `ical.js`, or browser I/O. Features depend on ports, never infrastructure. Adapters validate all external rows with zod and map to domain types. Auth/route guards are UX only; RLS/RPC is authoritative. Store UTC ISO instants; convert wall-clock values only through timezone-aware helpers. Exported symbols receive TSDoc, use `readonly`, strict TypeScript, no `any`, typed `Result`/`PortError`, and colocated tests.

## 2. Target module/file tree

```text
src/
  app/
    app.tsx                         # providers and HashRouter
    routes.tsx                      # /login, /calendar, RequireAuth/RequireRole
    route-meta.ts
    layout.tsx                      # AuthControls/sign-out
    services-context.tsx
  core/
    config.ts                       # Supabase public config and base path
    domain/
      result.ts
      user.ts                        # existing User/Session/Role/SignInProvider
      interval.ts                    # Interval, TimeRange, invariants
      tutoring-hours.ts              # Brussels + 08:00–22:00 constants
      blocked-intervals.ts           # closed, merge, blocked, clipping helpers
      calendar-event.ts              # CalendarEvent/NewCalendarEvent/ICS preview types
      blocked-intervals.test.ts
      interval.test.ts
      calendar-event.test.ts
    ports/
      auth-provider.ts               # extend existing port without leaking email
      calendar-event-repository.ts
      blocked-time-repository.ts
      ics-parser.ts
      index.ts
  infrastructure/
    container.ts                      # Services and adapter selection
    supabase/
      client.ts                       # createClient, detectSessionInUrl, PKCE
      auth-provider.ts
      calendar-event-repository.ts
      blocked-time-repository.ts
      rows.ts                         # zod row schemas/mappers
      index.ts
    memory/
      in-memory-auth-provider.ts      # extend existing fake
      in-memory-calendar-event-repository.ts
      in-memory-blocked-time-repository.ts
      fake-ics-parser.ts
      index.ts
    ics/
      ical-js-parser.ts               # lazy ical.js adapter; only module importing it
      index.ts
  features/
    auth/
      login-page.tsx
      auth-provider.tsx               # session/role state hook/context if needed
      require-auth.tsx
      require-role.tsx
      callback.ts                     # PKCE query callback handling
    calendar/
      calendar-page.tsx
      calendar-manager.tsx
      week-view.tsx
      week-table.tsx
      day-list.tsx
      week-navigator.tsx
      calendar-legend.tsx
      timezone-note.tsx
      add-blocked-time-form.tsx
      import-panel.tsx
      event-list.tsx
      calendar-view-model.ts
      calendar-page.module.css
      *.test.ts(x)
  shared/
    dates/
      brussels.ts
      brussels.test.ts
    ui/
      field.tsx, field.test.tsx
      dialog.tsx, dialog.test.tsx
      confirm-dialog.tsx
      error-summary.tsx
      auth-controls.tsx
      (existing Button/ButtonLink/StatusMessage/Container)
    styles/global.css
supabase/
  migrations/20261124000000_calendar.sql

docs/setup/external-setup.md         # redirect URLs, owner-only seed, dashboard settings
```

Do not alter the existing `AvailabilityRepository`/`AvailabilitySlot` contract; calendar events are a separate concern.

## 3. Core ports and types

`src/core/domain/interval.ts`:

```ts
export type IsoDateTime = string;
export interface Interval { readonly startsAt: IsoDateTime; readonly endsAt: IsoDateTime; }
export interface TimeRange { readonly from: IsoDateTime; readonly to: IsoDateTime; }
```

Validate `endsAt > startsAt` at boundaries. `CalendarEvent` is `{ id, startsAt, endsAt, title, source: 'manual' | 'ics', externalId?: string }`; `NewCalendarEvent` omits `id` and permits `externalId` only for ICS. `IcsPreview` contains readonly occurrences, found/new/duplicate/skipped counts, skip reasons, warnings, and `importedUntil`. Use the existing `Result<T, PortError>` (`PortResult<T>`).

```ts
export interface CalendarEventRepository {
  listEvents(range: TimeRange): PortResult<readonly CalendarEvent[]>;
  addEvents(events: readonly NewCalendarEvent[]): PortResult<readonly CalendarEvent[]>;
  removeEvent(id: string): PortResult<void>;
  removeImportedEvents(): PortResult<void>;
}
export interface BlockedTimeRepository {
  listBlockedIntervals(range: TimeRange): PortResult<readonly Interval[]>;
}
export interface IcsParser {
  parse(text: string, options: { readonly from: IsoDateTime; readonly to: IsoDateTime }): PortResult<IcsPreview>;
}
```

Methods retain the repository's existing async `PortResult` convention. `CalendarEventRepository` is admin-only; `BlockedTimeRepository` returns intervals only. `IcsParser` must cap input at 1 MB, expand at most 12 months and 2,000 occurrences, and produce stable external IDs (`UID#occurrence-start-UTC`). Never persist description, location, attendees, organizer, or raw ICS.

### Pure functions (must be deterministic and unit-tested)

- `closedHoursIntervals(range, hours = TUTORING_HOURS, tz = TUTOR_TIME_ZONE): Interval[]`: enumerate each local Brussels date touching the range; emit local `[00:00,08:00)` and `[22:00, next local midnight)` converted using `TZDate`/`@date-fns/tz`, never fixed offsets. DST transition dates (2026-03-29 and 2026-10-25) must have correct UTC lengths.
- `clipInterval(interval, range): Interval | null`: intersect half-open intervals; reject empty intersections.
- `mergeIntervals(intervals, range?): Interval[]`: discard invalid/empty values, clip when a range is supplied, sort by start/end, merge overlap **and touching** intervals, and return canonical UTC intervals.
- `blockedIntervals({ range, eventIntervals, hours, tz }): Interval[]`: union `closedHoursIntervals` and event intervals, then merge/clip to the requested range. Closed hours are client-side policy and are not duplicated in SQL.
- `isBlocked`/`freeIntervals` support later booking and view-model tests.

The view model divides each day into closed-before, 28 half-hour open cells, and closed-after; closed wins for cell text while event titles remain in the admin event list.

## 4. Exact Supabase migration outline

Create `supabase/migrations/20261124000000_calendar.sql` in one transaction-compatible migration:

```sql
create extension if not exists pgcrypto;

create table public.admins (
  email text primary key,
  constraint admins_email_lower check (email = lower(email))
);
alter table public.admins enable row level security;
revoke all on table public.admins from public, anon, authenticated;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null default '',
  source text not null check (source in ('manual','ics')),
  external_id text null,
  created_at timestamptz not null default now(),
  constraint calendar_events_order check (ends_at > starts_at),
  constraint calendar_events_max_length check (ends_at <= starts_at + interval '31 days'),
  constraint calendar_events_title_length check (char_length(title) <= 200),
  constraint calendar_events_source_external_unique unique (source, external_id)
);
create index calendar_events_time_idx on public.calendar_events (starts_at, ends_at);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u join public.admins a on a.email = lower(u.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.calendar_events enable row level security;
revoke all on table public.calendar_events from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_events to authenticated;
create policy calendar_events_admin_all on public.calendar_events
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.is_approved_tutee() returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
revoke all on function public.is_approved_tutee() from public, anon;
grant execute on function public.is_approved_tutee() to authenticated;

create or replace function public.get_blocked_intervals(p_from timestamptz, p_to timestamptz)
returns table(starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
  begin
    if not (public.is_admin() or public.is_approved_tutee()) then
      raise exception using errcode = '42501', message = 'calendar access denied';
    end if;
    if p_from is null or p_to is null or p_to <= p_from
       or p_to > p_from + interval '100 days' then
      raise exception using errcode = '22023', message = 'invalid calendar range';
    end if;
    return query
      with ordered as (
        select greatest(e.starts_at, p_from) as starts_at,
               least(e.ends_at, p_to) as ends_at
        from public.calendar_events e
        where e.starts_at < p_to and e.ends_at > p_from
      ), numbered as (
        select *, max(ends_at) over (order by starts_at, ends_at
          rows between unbounded preceding and 1 preceding) as prior_end
        from ordered where ends_at > starts_at
      ), islands as (
        select *, sum(case when prior_end is null or starts_at > prior_end then 1 else 0 end)
          over (order by starts_at, ends_at) as island
        from numbered
      )
      select min(islands.starts_at), max(islands.ends_at)
      from islands group by island order by min(islands.starts_at);
  end;
$$;
revoke all on function public.get_blocked_intervals(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_blocked_intervals(timestamptz, timestamptz) to authenticated;
```

The developer must verify SQL syntax locally against the Supabase CLI/Postgres version and add SQL/RLS tests. No policy is created on `admins`; its table remains unreachable through the Data API. Confirm the function owner has only the required definer rights and all names are schema-qualified.

## 5. Ordered implementation tasks

Each task is a small Conventional Commit and must leave targeted tests green. The developer may combine only adjacent tasks when tests remain attributable.

### T1 — Add dependencies and shared date primitives (`feat(calendar): add timezone calendar foundations`)
**Files:** `package.json`, lockfile, `src/core/domain/{interval,tutoring-hours}.ts`, `src/shared/dates/*`, tests. Add exact versions checked 2026-11-24: `date-fns@^4.4.0`, `@date-fns/tz@^1.5.0`, `ical.js@^2.2.1`, `@supabase/supabase-js@^2.119.2` (verify `npm view` before install; update lockfile). Lazy-load ical.js.

- **Given** a Brussels local date on each DST transition, **When** interval conversion runs, **Then** UTC boundaries represent the actual 23/25-hour local day.
- **Given** invalid or reversed intervals, **When** validated, **Then** a typed validation error/result is returned and no NaN/empty interval escapes.

### T2 — Implement and test blocked-time pure domain (`feat(calendar): compute blocked intervals`)
**Files:** `blocked-intervals.ts`, view-model helpers, unit tests.

- **Given** overlapping or touching events and closed hours, **When** `blockedIntervals` runs, **Then** output is sorted, canonical, merged, and clipped to the range.
- **Given** an event crossing 08:00 or 22:00, **When** cell intervals are built, **Then** only the in-range portion is represented and wholly outside open time cannot make an open cell free.
- **Given** 2026-03-29/10-25, **When** closed hours are computed, **Then** no fixed-one-hour offset assumption is observable.

### T3 — Add calendar ports and in-memory fakes (`feat(calendar): add calendar ports and fakes`)
**Files:** domain event/preview types, three ports, memory adapters, tests, exports. Use deterministic injected ID generation and stable UID dedupe.

- **Given** repeated `addEvents` with the same `(source, externalId)`, **When** using the fake, **Then** one event remains.
- **Given** a range, **When** listing events/blocked intervals, **Then** only intersecting rows are returned and titles are absent from blocked intervals.
- **Given** delete/remove-all, **When** called, **Then** only the requested event/source is removed and errors are typed.

### T4 — Build Supabase migration and boundary mappers (`feat(calendar): secure calendar schema`)
**Files:** migration above, `rows.ts`, `docs/setup/external-setup.md`, `supabase/README.md` if needed, SQL/RLS test harness.

- **Given** anonymous or authenticated non-admin access, **When** table/API/RPC operations run, **Then** table reads/writes and admin RPC are rejected/empty according to RLS, and tutee RPC is closed by the stub.
- **Given** an admin with confirmed `auth.users.email` matching a lower-case `admins.email`, **When** CRUD/RPC runs, **Then** CRUD succeeds and RPC returns only merged intervals.
- **Given** RPC input over 100 days, reversed, null, or unauthorised, **When** invoked, **Then** it raises without returning data.
- **Given** malformed Supabase rows, **When** mapped, **Then** zod rejects them as typed unavailable/validation errors.

### T5 — Supabase client, auth adapter, and DI (`feat(auth): wire Google PKCE authentication`)
**Files:** `infrastructure/supabase/client.ts`, auth/event/blocked adapters, container, existing auth domain/port as necessary, auth tests.

Use `createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } })`; call `signInWithOAuth({ provider: 'google', options: { redirectTo } })`, where `redirectTo = origin + basePath` (Pages and localhost). `rpc('is_admin')` determines role; never inspect client-editable email/user metadata. `azure` returns typed unavailable. If config is absent, use memory adapters.

HashRouter warning/handling: OAuth must redirect to the base URL with a **query** `?code=...`, not `#/login` or a custom hash fragment; OAuth fragments conflict with HashRouter. Supabase's PKCE callback is consumed by `detectSessionInUrl` before routing. Add a callback effect that detects `code`, awaits session restoration, removes the query with `history.replaceState`, then lets `HashRouter` navigate to `/`; never put tokens in a hash. Test both a query callback and a normal hash route.

- **Given** Google sign-in on localhost/Pages, **When** clicked, **Then** the adapter sends the exact allow-listed `redirectTo` and PKCE options.
- **Given** a session, **When** role is loaded, **Then** `is_admin` is the only role decision; failure is typed and fail-closed.
- **Given** sign-out/session change, **When** provider callbacks fire, **Then** UI state updates and unsubscribe works.

### T6 — Route guards and login/layout states (`feat(auth): add guarded routes and controls`)
**Files:** `features/auth/*`, `app/routes.tsx`, layout/auth controls, component tests.

- **Given** signed out `/calendar`, **When** rendered, **Then** no repository fetch occurs and a Google sign-in action is shown.
- **Given** signed-in non-admin, **When** `/calendar` renders, **Then** no calendar data is fetched and “You don't have access yet” is shown.
- **Given** admin, **When** `/calendar` renders, **Then** the manager is available; route guards remain UX only.
- **Given** Microsoft button, **When** focused/clicked, **Then** it is focusable, `aria-disabled="true"`, described as coming soon, and makes no call.
- **Given** a sign-out error, **When** it occurs, **Then** the prescribed error is announced and no false signed-out state is shown.

### T7 — Calendar data adapters and ICS parser (`feat(calendar): import ICS and persist events`)
**Files:** `infrastructure/ics/ical-js-parser.ts`, Supabase/memory repositories, fixtures/tests.

- **Given** Outlook VTIMEZONE, Google, all-day, floating, RRULE, EXDATE, and RECURRENCE-ID input, **When** parsed, **Then** occurrences map to UTC correctly and all-day/floating values use Europe/Brussels.
- **Given** cancelled/transparent/past/over-31-day occurrences, **When** parsed, **Then** each is skipped with a reason and no sensitive fields are retained.
- **Given** recurring input, **When** expansion exceeds 12 months or 2,000 occurrences, **Then** it is capped with a warning and stable UID occurrence IDs dedupe re-imports.
- **Given** wrong MIME/extension, unreadable, malformed, or >1 MB input, **When** parsed, **Then** a typed error is returned without crashing.

### T8 — Accessible week view and admin tools (`feat(calendar): add calendar manager UI`)
**Files:** feature components/styles/tests plus shared `Field`, `Dialog`, `ConfirmDialog`, `ErrorSummary`.

- **Given** a loaded week, **When** viewport is >=40rem, **Then** a semantic table has seven day columns, closed rows, 28 half-hour rows, text states, and no colour-only meaning; below 40rem it becomes the chronological day list.
- **Given** add form input, **When** submitted, **Then** required/order/title/open-hours rules produce linked field errors; partly outside time is saved with the prescribed info; success resets and navigates to its week.
- **Given** an ICS preview, **When** confirmed, **Then** counts, skip reasons, duplicates, warnings, first-50 paging, and success/error states match the design; titles render as text.
- **Given** an event delete/remove-all action, **When** confirmed, **Then** only the intended imported/manual rows are removed and the list/week refreshes.
- **Given** keyboard and assistive technology use, **When** the page is exercised, **Then** headings, labels, live regions, focus, dialog semantics, 44px controls, reduced motion, and mobile list meet WCAG 2.2 AA.

### T9 — Tutee component (unrouted), integration wiring (`feat(calendar): compose calendar services`)
**Files:** `calendar-manager.tsx`, shared calendar view, container/provider tests, `TUTEE_CALENDAR_ENABLED = false`.

- **Given** tutee mode is constructed, **When** rendered, **Then** it accepts only blocked intervals, never titles/counts/event IDs, and is not reachable while the flag is false.
- **Given** a changing week, **When** requests overlap, **Then** the latest request wins, previous content remains during loading, and errors offer retry without focus theft.

### T10 — Test/quality gate and docs (`test(calendar): cover calendar and auth flows`)
Run unit, component, a11y, SQL/RLS, lint, typecheck, format, test, and build. Use deterministic clocks and no network. Append QA evidence to the handoff.

- **Given** `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`, **When** run on the feature branch, **Then** all pass.
- **Given** axe + keyboard checks on login/calendar/forms/dialogs, **When** run, **Then** there are no new WCAG violations.

## 6. QA test plan

- **Unit:** interval invariants; merge overlap/touch/clipping; Brussels DST; open-hours boundaries; cell/view model; local form validation; ICS RRULE/EXDATE/overrides, all-day/floating, cap/dedupe/skip reasons; zod row mapping; auth result mapping.
- **Component/integration:** signed-out/checking/non-admin/admin/error/loading states; no-fetch privacy assertions; route focus/title; week navigation; form live regions and error summary; import state machine; delete confirmation; latest-request-wins; Microsoft aria-disabled; reduced/mobile table/list.
- **A11y:** Testing Library + jest-dom + axe where available; keyboard-only pass for skip link, nav, dialogs, file/import controls, and focus order; screen-reader text for every cell/list status; 200% zoom and narrow viewport.
- **RLS/SQL:** apply migration to a disposable/local Supabase project; test anon, authenticated non-admin, confirmed admin, and unapproved tutee. Assert no `admins` policy, table CRUD denial for non-admin, admin CRUD success, merged RPC output, no title/id/count leakage, grants/revokes, range cap, and fail-closed `is_approved_tutee`.
- **Security/privacy:** `git grep` for the real owner address must be empty; only `admin@example.test` may appear in tests; no service-role key, raw ICS, email, descriptions, locations, attendees, or `dangerouslySetInnerHTML`.
- **Smoke:** after owner setup/deploy, visit live Pages URL, verify JS asset 200, sign-in redirect/callback, admin calendar load, manual add/delete/import preview, and sign-out. Verify the GitHub Pages deploy run is successful before declaring done.

## 7. Migration/application and owner actions

Developer validates locally first. After tests and owner approval, the owner (pre-authorised) may run `npx supabase db push --remote` against the linked project. Then, once and only once in the Supabase SQL Editor, owner runs:

```sql
insert into public.admins (email) values (lower('<ADMIN_GOOGLE_EMAIL>'));
```

The placeholder is intentional; the real email must never enter this repository, tests, fixtures, logs, or handoff. Owner must also verify Google provider configuration, allowed redirects `https://bjornpijpops.github.io/tutoring/` and `http://localhost:5173/`, disable email-password and anonymous sign-ins, and ensure GitHub public Variables `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are present. Do not push the migration or seed automatically from CI.

## 8. Commit and merge plan

1. `feat(calendar): add timezone interval domain`
2. `feat(calendar): add calendar ports and memory adapters`
3. `feat(calendar): secure Supabase calendar schema`
4. `feat(auth): wire Google PKCE authentication`
5. `feat(calendar): add ICS import and calendar manager`
6. `test(calendar): cover RLS and accessible calendar flows`
7. `docs(calendar): record setup and handoff`

Keep commits on `feature/availability-calendar`; no direct `main` commits and no GitHub PR. After QA passes and reviewer approves, **STOP for owner local verification**. Only after owner confirms, squash-merge locally to up-to-date `main`, push `main`, and verify the Deploy to GitHub Pages run, live URL HTTP 200, referenced `/tutoring/assets/*.js` HTTP 200, and live calendar smoke behaviour. Record verification in the final handoff.

## 9. Handoff focus

**For QA:** execute §6, especially DST, malformed/oversize ICS, no-fetch/non-admin privacy, RLS grants/policies, RPC merge/range cap, axe/keyboard/mobile checks, and live smoke prerequisites.

**For reviewer:** focus on dependency direction and no direct Supabase/ical imports in core/features; UTC/DST correctness; stable ICS UID dedupe and 12-month/2,000 caps; SQL definer/search-path/grants/RLS fail-closed behaviour; no title leakage; HashRouter + PKCE query callback; owner-email absence; exact scope/acceptance criteria; and confirmation that BIG-change owner verification occurred before merge.

