# 2026-11-23 keep-alive 401 fix

## architect – PASS
- **Summary**: Anon keys are rejected on `/rest/v1/` of newer projects. Use a `public.keepalive()` SQL function called through PostgREST RPC: real DB activity, no data exposure, `security invoker`, empty `search_path`.
- **Artifacts**: `supabase/migrations/20261123000000_keepalive.sql`

## ui-ux-designer – NO IMPACT
- **Summary**: No UI touched.

## tech-lead – PASS
- **Summary**: Branch `fix/keepalive-rpc` from `main`; change limited to migration, workflow request and README. Acceptance: with the migration applied, the workflow run is green; with secrets unset it still no-ops.

## developer – PASS
- **Summary**: Added migration, switched workflow to `POST /rest/v1/rpc/keepalive`, updated `supabase/README.md`.
- **Constraint**: The owner must apply the migration (SQL Editor or `supabase db push`) before the workflow can succeed.

## qa � PASS
- **Summary**: 151 tests pass; lint passes; format warnings are CRLF-only (local autocrlf), fixed by new .gitattributes. Live keep-alive run needs the migration applied by the owner.

## reviewer � APPROVED
- **Summary**: Function is read-free (select true), security invoker, empty search_path, execute limited to anon/authenticated. No issues.
