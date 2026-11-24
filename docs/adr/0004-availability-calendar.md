# 0004 – Availability calendar: data model, blocked-time computation, ICS import, rendering

**Status**: Accepted (2026-11-24)

## Context
The tutor (admin) needs a calendar that tutees will later use to see when they cannot book. Requirements:
1. The admin "uploads" events; tutees see them as **blocked**.
2. Tutoring happens only **08:00–22:00**; everything outside is **always blocked**.
3. Events are stored in Supabase and shared (not per-browser).
4. Tutees must never see event details (titles etc.), only that time is blocked.
5. Google sign-in now exists; access approval (tutee side) does not. See ADR 0005 for who may read/write.

Existing code to build on (ADR 0003): `core/domain`, `core/ports`, `infrastructure/{memory,supabase}`, `features/calendar` (placeholder), UTC ISO strings in the domain. `AvailabilityRepository`/`AvailabilitySlot` model *bookable slots* for the later booking feature and stay untouched.

## Decisions

### 1. "Upload" = ICS import **plus** manual add/remove
| Option | Verdict |
|---|---|
| Manual form only | Tedious: the owner already keeps a real calendar in Outlook/Google. Rejected as sole option. |
| **Import an `.ics` file** (Outlook/Google/Apple all export it) + manual add/remove form | Matches "upload", needs no server, no external setup, universal format. **Chosen.** |
| Subscribe to a calendar URL (live sync) | Needs a server-side fetch (Edge Function + secret URL) and ongoing sync. Out of scope; may be a later ADR. |
| CSV/JSON upload | Nobody has their calendar in that shape. Rejected. |

Import flow: choose file → parse in the browser → **preview** (number of events, date range, skipped items with reasons) → confirm → upsert. Re-importing the same file is idempotent. Individual events can be deleted; "remove all imported events" is available for cleanup.

### 2. Data model (Supabase, migration `…_calendar.sql`)
Table `public.calendar_events`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk, default `gen_random_uuid()` | |
| `starts_at`, `ends_at` | `timestamptz` not null | **UTC instants**; `check (ends_at > starts_at)` and a max length check (e.g. ≤ 31 days) |
| `title` | text not null default `''`, `check (char_length(title) <= 200)` | **admin-only**, optional |
| `source` | text not null, `check (source in ('manual','ics'))` | |
| `external_id` | text null | for ICS: `UID` + `#` + occurrence start (UTC); makes re-import idempotent |
| `created_at` | timestamptz default `now()` | |

`unique (source, external_id)` (nulls distinct, so manual events are unconstrained); index on `(starts_at, ends_at)`.
No description, location, attendees or organizer are ever stored (data minimisation; they are the most sensitive parts of an Outlook event).
Domain type `CalendarEvent { id, startsAt, endsAt, title, source }` with `IsoDateTime` strings; adapters map rows with zod.

Recurring events: the ICS adapter **expands** `RRULE` occurrences into individual rows within a bounded window (today − 7 days … + 12 months, max 2 000 occurrences per import; EXDATE/RECURRENCE-ID overrides honoured by the parser). We do not store rules: it keeps SQL and the blocked computation trivial. Consequence: recurring events need a re-import after ~12 months (shown in the UI as "imported until <date>").
Skipped on import: `STATUS:CANCELLED`, `TRANSP:TRANSPARENT` (shown as *free* in Outlook/Google), events entirely in the past, events longer than the max length (reported in the preview).
All-day events (`DATE` values) and floating times (no TZID) are interpreted in the tutor time zone: all-day = local midnight to next local midnight.

### 3. Time zone and opening hours are constants
`src/core/domain/tutoring-hours.ts`:
```ts
export const TUTOR_TIME_ZONE = 'Europe/Brussels';
export const TUTORING_HOURS = { openHour: 8, closeHour: 22 } as const; // local, every day of the week
```
Single place to change; no env var (not a secret, not per-deploy). The hours apply to **every** day including weekends (owner statement: "all hours outside 08:00–22:00"); a per-weekday table can replace the constant later without API change because consumers go through a function, not the numbers.
The UI always labels times with the tutor time zone ("times in Brussels time") and may additionally show the viewer's zone when it differs.

### 4. How blocked time is computed (pure functions in `core/domain`)
No I/O, fully unit-tested, no React:
- `closedHoursIntervals(range, hours, tz): Interval[]` – for each **local calendar day** overlapping the range, `[00:00, openHour)` and `[closeHour, 24:00)` converted to UTC using the tz database (so 23/25-hour DST days are correct; never fixed offsets).
- `mergeIntervals(intervals): Interval[]` – sort, merge overlapping **and touching** intervals, clip to range.
- `blockedIntervals({ range, eventIntervals, hours, tz }): Interval[]` = `mergeIntervals(closedHours ∪ eventIntervals)`.
- `isBlocked(interval, blocked)` / `freeIntervals(...)` helpers for the later booking feature.

Strategy: **union of "always closed" and "event" intervals, computed on the client**. The server only knows events; the opening-hours rule lives in one TypeScript constant and is never duplicated into SQL. Booking (later feature) must re-check hours/overlap server-side (constraint or RPC) – recorded as a requirement for that feature, not built now.

### 5. Date library: `date-fns` v4 + `@date-fns/tz`
`TZDate` gives tz-aware wall-clock arithmetic and DST correctness with tree-shakable functions and no polyfill. **Temporal** rejected for now: not available in all supported browsers, would need a polyfill. Date handling stays behind `shared/dates` and the pure domain functions.

### 6. ICS parsing: use **`ical.js`**, wrapped by our own adapter
| Option | Verdict |
|---|---|
| Hand-written parser | RRULE, EXDATE, VTIMEZONE, folding, escaping, Outlook's Windows time-zone names: high bug risk. Rejected. |
| `node-ical` | Node-only dependencies. Rejected. |
| **`ical.js`** (MPL-2.0, no runtime deps, browser-ready, RRULE expansion + VTIMEZONE) | **Chosen.** |

It is used only inside `infrastructure/ics/` behind a port `IcsParser.parse(text, options): PortResult<ParsedIcs>` (so core/features never import it), and loaded with dynamic `import()` only when the admin opens the import dialog (keeps the main bundle small). Input is untrusted: file size cap 1 MB, `.ics`/`text/calendar` only, parse errors become typed `PortError`s, titles are rendered as text (React escapes; never `dangerouslySetInnerHTML`). Unknown time zones fall back to the tutor zone and are listed as a warning in the preview.

### 7. Ports
Three small ports instead of widening `AvailabilityRepository`:
- `CalendarEventRepository` (admin): `listEvents(range)`, `addEvents(events)` (upsert on `source, external_id`), `removeEvent(id)`, `removeImportedEvents()`.
- `BlockedTimeRepository` (admin now, approved tutees later): `listBlockedIntervals(range): Interval[]` – **intervals only** (see 8).
- `IcsParser` (above).
Adapters: `infrastructure/supabase/*` and `infrastructure/memory/*` (tests, local dev when no Supabase config).

### 8. Exposing blocked time to tutees without leaking details
`calendar_events` is **not readable by tutees at all** (RLS: admin only). Tutees get an RPC:

`public.get_blocked_intervals(p_from timestamptz, p_to timestamptz) returns table (starts_at timestamptz, ends_at timestamptz)`
- `security definer`, `set search_path = ''`, schema-qualified names, `revoke all … from public, anon`, `grant execute … to authenticated`.
- The body first checks `public.is_admin() or public.is_approved_tutee()` and raises otherwise (ADR 0005), validates `p_to > p_from` and a **maximum range (≈ 100 days)** to prevent bulk scraping.
- Returns **merged** intervals (gaps-and-islands in SQL), so adjacent/overlapping events are indistinguishable and no titles, ids, counts or event boundaries leak.
Residual leak accepted: tutees can infer the tutor is busy at those times, which is the purpose.

### 9. Rendering: own accessible week view, no calendar library
| Option | Verdict |
|---|---|
| FullCalendar / react-big-calendar | Heavy, hard to restyle to our tokens, keyboard/screen-reader support is weak, features (drag/drop, resources) unused. Rejected. |
| **Own component** | Our need is a read-mostly week grid of "free / blocked" in a fixed 08–22 window. Full control over a11y and styling. **Chosen.** |

Design constraints (details for `ui-ux-designer`): semantic `<table>` (column headers = days, row headers = 30-minute rows 08:00–22:00; the closed hours are not rendered as rows but stated in a note) with each cell exposing text/icon **"Blocked" / "Partly blocked" / "Free"** (not colour alone); week navigation with buttons and visible focus; below 640 px an agenda list per day instead of the grid; admin mode additionally lists events (title, time, delete) and has the add-event form and import dialog; tutee mode is the same grid, read-only, fed only by `BlockedTimeRepository`. Layout/cell logic is derived from the pure functions above.

## Consequences
- Pure, well-tested core logic; swapping the backend or UI does not touch it.
- Tutee data exposure is minimal by construction (RPC, merged intervals).
- Two new dependencies (`date-fns` + `@date-fns/tz`, `ical.js`; the latter lazy-loaded).
- Recurring imports are snapshots (12 months); live sync is a possible later feature.
- Opening-hours rule is client-side only until booking adds server-side enforcement.
