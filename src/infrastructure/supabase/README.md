# Supabase adapters

Adapters implementing the ports in `src/core/ports` with Supabase: `SupabaseAuthProvider` (Google, PKCE; the role comes from the server-side `is_admin()` RPC), `SupabaseCalendarEventRepository` and `SupabaseBlockedTimeRepository` (`get_blocked_intervals` RPC). `container.ts` selects them when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set; otherwise (and for features not built yet) it wires the in-memory adapters from `../memory`.

`calendar-migration.test.ts` runs `supabase/migrations/20261124000000_calendar.sql` in PGlite and checks the RLS rules and RPC.

Only this folder (and `container.ts`) may import `@supabase/*`.
