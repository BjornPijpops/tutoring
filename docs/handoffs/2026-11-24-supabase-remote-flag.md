# 2026-11-24 supabase --remote docs fix

All six agents: docs-only correction; no code or UI impact.

## architect – NO IMPACT
- CLI v3 defaults to the local Docker stack; remote targets need `--remote`.

## ui-ux-designer – NO IMPACT
- No UI touched.

## tech-lead – PASS
- Branch `docs/supabase-remote-flag`; update three doc references.

## developer – PASS
- Updated `docs/setup/external-setup.md` and `supabase/README.md`.

## qa – PASS
- Docs only; no tests affected. Verified the error text from the owner matches the documented cause.

## reviewer – APPROVED
- Accurate and minimal.
