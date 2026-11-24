# 2026-11-24 Supabase CLI

## architect – PASS
- **Summary**: Winget/Scoop have no Supabase package; the CLI is installed as an npm dev dependency (officially supported), pinned via lockfile, used with `npx supabase`.

## ui-ux-designer – NO IMPACT
- **Summary**: No UI touched.

## tech-lead – PASS
- **Summary**: Branch `chore/supabase-cli`; scope: devDependency, `supabase init` config, docs.

## developer – PASS
- **Summary**: Added `supabase@^3.3.0`, `supabase/config.toml` and `supabase/.gitignore`, updated setup guide and README.
- **Note**: `supabase db push` and `link` need the owner's login and database password; not done here.

## qa � PASS
- **Summary**: lint, typecheck, 151 tests, build pass.

## reviewer � APPROVED
- **Summary**: No secrets in config; lockfile valid; CI unaffected.
