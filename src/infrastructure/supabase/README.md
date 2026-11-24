# Supabase adapters

Adapters implementing the ports in `src/core/ports` with Supabase: `SupabaseAuthProvider` (Google, PKCE; role and access state come from the server-side `get_my_access` RPC; `getIdentity` returns the Google name and email for the request form), `SupabaseCalendarEventRepository` and `SupabaseBlockedTimeRepository` (`get_blocked_intervals` RPC) and `SupabaseAccessRequestRepository` (RPCs `request_access`, `decide_access_request`, `allow_access_request_again`, `list_access_requests`; rows mapped in `access-rows.ts`). `container.ts` selects them when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set; otherwise (and for features not built yet) it wires the in-memory adapters from `../memory`.

`calendar-migration.test.ts` runs `supabase/migrations/20261124000000_calendar.sql` in PGlite and checks the RLS rules and RPC; `access-requests-migration.test.ts` does the same for `20261125000000_access_requests.sql`.

Only this folder (and `container.ts`) may import `@supabase/*`.
