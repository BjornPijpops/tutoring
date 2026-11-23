# Project skeleton

## architect – PASS
- **Summary**: Frontend stack decided: React 19 + TypeScript strict + Vite, React Router with `HashRouter` (Pages has no rewrites; simplest OAuth redirect), CSS Modules + CSS variables, TanStack Query for server state, Context for session/DI, zod for validation, date-fns + `@date-fns/tz` (UTC stored, local display), Vitest + Testing Library, ESLint 9 flat config (+ react-hooks, jsx-a11y) + Prettier, npm. Architecture: feature folders, `core/ports` interfaces (AuthProvider, AccessRequest/Availability/SessionRequest repositories), Supabase adapters in `infrastructure/`, in-memory fakes for tests, composition root `container.ts` injected via `ServicesProvider`, zod-validated public `VITE_*` config.
- **Artifacts**: `docs/adr/0002-frontend-stack.md`, `docs/adr/0003-app-architecture.md`
- **Constraints / risks for next agent**:
  - Skeleton only: placeholder routes (Home, Login, Calendar, Not found); no real features.
  - Vite `base: '/tutoring/'`; Supabase redirect URLs must include `https://bjornpijpops.github.io/tutoring/` and `http://localhost:5173/`.
  - Only public anon key/URL in the bundle; route guards are UX only, RLS enforces authorization.
  - CI: `npm ci` → lint → typecheck → test → build; deploy via `upload-pages-artifact` + `deploy-pages` on `main`; Node 24; replace the `src/index.ts` stub with `src/main.tsx`.
  - Features must not import `infrastructure/` or `@supabase/*`; `core` must stay framework-free.
- **Open questions**: None. E2E (Playwright) and `vitest-axe` deferred until real flows exist.

## ui-ux-designer – PASS
- **Summary**: Designed skeleton UI: app shell (skip link, banner, labelled nav, main, footer), placeholder pages (Home, Login with Google/Microsoft buttons, Calendar placeholder, Not found), tokens (light + dark via `prefers-color-scheme`, all AA contrast verified), base components Button/ButtonLink, Container/Layout, PageHeading, StatusMessage. Future flow outlined in Mermaid only.
- **Artifacts**: `docs/design/skeleton.md`
- **Constraints / risks for next agent**:
  - Tokens live in one `tokens.css` (CSS variables); components use only variables, no raw hex. Media-query breakpoints (40rem, 64rem) are hard-coded.
  - HashRouter: skip link cannot use `href="#main"`; focus `main` via script. Move focus to main and update `document.title` on route change.
  - Nav stays a visible list (no hamburger); `aria-current="page"` plus underline.
  - StatusMessage: `error` uses `role="alert"`, others `role="status"`; sign-in buttons are no-ops showing an info message.
  - Tests should assert roles/names; jsx-a11y lint must pass.
- **Open questions**: None (provider logos on login buttons deferred; text labels only).

## tech-lead – PASS
- **Summary**: Branch verified: `feature/project-skeleton` is at the same commit as `main` (772679c), no direct commits to `main`; ADR/design/handoff docs are still untracked and go in commit 1. Plan has 12 ordered tasks with Given/When/Then criteria, 9 Conventional Commits, then PR and squash merge after qa PASS and reviewer APPROVED. Patterns: ports and adapters, DI via `ServicesProvider`, factory `createContainer`, Result type. Skeleton wires in-memory adapters only; Supabase adapters and schema are deferred, so Supabase env vars are optional in the config schema. Workflows: `ci.yml` (PR), `deploy.yml` (push to main, Pages), `supabase-keepalive.yml` (cron, no-op if secrets unset).
- **Artifacts**: `docs/design/skeleton-plan.md` (tasks, file tree, port signatures, scripts, tsconfig, CI, README/.env.example, QA plan, reviewer focus)
- **Constraints / risks for next agent**:
  - Pin actions to full commit SHAs resolved at implementation time (do not guess); least-privilege `permissions`; concurrency groups `ci-<ref>`, `pages`, `supabase-keepalive`.
  - Delete `src/index.ts`; replace the CommonJS tsconfig with project references (ESNext, bundler resolution, `jsx react-jsx`); no unused dependencies.
  - Enforce the boundary rule (features do not import `infrastructure` or `@supabase/*`) with ESLint.
  - Keep-alive `/rest/v1/` may be rejected for anon keys; follow up with a trivial table or RPC. Scheduled workflows also pause after 60 days of repo inactivity.
  - Manual owner steps: Pages source = GitHub Actions, repo Variables and Secrets, branch protection, Supabase redirect URLs.
- **Open questions**: None blocking.

## developer – PASS
- **Summary**: Implemented all tasks T1–T12 on `feature/project-skeleton` (nothing pushed, no PR, `main` untouched): Vite 8 + React 19 + strict TS project, ports and in-memory adapters, zod config, HashRouter, tokens and CSS Modules, five base components, app shell with skip link and route focus/title handling, four placeholder pages, 121 tests in 16 files, ESLint (strict type-checked, jsx-a11y, boundary rules) and Prettier, three SHA-pinned workflows, README, `.env.example`, `supabase/` placeholder. `src/index.ts` removed; tsconfig replaced by project references. Results: `npm run lint`, `format:check`, `typecheck`, `test` (121 passed) and `build` all green; `dist/index.html` references `/tutoring/assets/...` and `vite preview` serves the app at `http://127.0.0.1:4173/tutoring/` (200 for html, js, css); bundle contains no `service_role`/`RESEND`. The boundary rule was verified with a deliberate violation (removed).
- **Artifacts**: 8 commits on top of the docs commit (Conventional Commits with Copilot trailer); `src/`, `.github/workflows/{ci,deploy,supabase-keepalive}.yml`, `README.md`, `supabase/README.md`, `.env.example`.
- **How to run**: `npm ci && npm run dev` (http://localhost:5173/tutoring/); full check: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.
- **Deviations from the plan**:
  - `.env.example` was committed with the tooling commit (not the README commit); commit 6 message reads "app shell, skip link, focus management and services provider" and routes/`App`/`main.tsx` wiring landed in commit 7 so every commit stays green.
  - ESLint 9 (not 10) because `eslint-plugin-jsx-a11y` 6.10 only supports up to ESLint 9, as the ADR specifies; `@eslint/js` pinned to 9 as well. TypeScript `^6.0.3` kept (works with typescript-eslint 8.74, Vite 8, Vitest 5). Installed latest majors otherwise: Vite 8.3, Vitest 5.1, react-router 8.5 (plan said v7), jsdom 31, zod 4.
  - `.prettierignore` excludes `docs/`, `.github/agents`, `.github/skills`, `.github/copilot-instructions.md` (existing agent docs are not reformatted); `package-lock.json` too.
  - Action versions (SHA = tag, lightweight tags verified): checkout v7.0.1 `3d3c42e5…`, setup-node v7.1.0 `949feb24…`, configure-pages v6.0.0 `45bfe019…`, upload-pages-artifact v5.0.0 `fc324d35…`, deploy-pages v5.0.1 `368f8252…`.
  - Test class names are non-scoped (`css.modules.classNameStrategy`) so tests can assert variant classes.
  - Extra small files: `.editorconfig`, `route-meta.ts` (titles + main id), `button-styles.ts`, `memory/support.ts` (ids, clock, actor helpers). Default in-memory actor is a tutor so one repo instance can exercise all operations; tutee actor returns `forbidden`. Accepting a session request books the slot (a repeat accept conflicts).
  - `date-fns` / `@date-fns/tz` not installed (unused), as the plan allowed.
- **Known limitations / for qa**:
  - Keep-alive shell script could not be executed locally (no bash on this machine); logic is plain POSIX sh, please verify on first `workflow_dispatch`. Workflow YAML only syntax-checked via Prettier; real runs need a push.
  - `QueryClientProvider` is wired but unused until the first data feature.
  - Manual a11y checks (contrast in browser, 320px/200% zoom, screen reader) not performed; automated tests cover roles, names, landmarks, skip link, focus and titles.
  - Sticky header was not implemented (header scrolls with the page); `scroll-padding-top` is set for when it becomes sticky.
  - CRLF/LF: files are written LF; git warns about CRLF conversion on this Windows machine (no `.gitattributes` added).
- **Open questions**: Add `.gitattributes` (`* text=auto eol=lf`)? Left to tech-lead.

## qa – PASS
- **Summary**: All acceptance criteria of `skeleton-plan.md` verified; no blocking defects. Clean `npm ci` then lint, format:check, typecheck, test (151 passed in 17 files after my additions) and build all green. Added `src/shared/styles/contrast.test.ts` (computes WCAG ratios from `tokens.css`: text ≥4.5:1, borders/focus ≥3:1, light and dark), committed as `test: ...`. No product code changed.
- **Verified (PASS)**:
  - Branch/commits: on `feature/project-skeleton`; `main` still at `772679c` (no direct commits); all 10 commits are Conventional Commits with the Copilot trailer; nothing pushed.
  - Build: `dist/index.html` references `/tutoring/assets/...`; `VITE_BASE_PATH=/x/` overrides base; bundle has no `service_role`, `RESEND`, `TUTOR_EMAIL` or `supabase.co`. `src/index.ts` is gone; only `.env.example` is tracked among env files.
  - `vite preview`: `/tutoring/`, JS and CSS return 200; `/` redirects (302) to `/tutoring/`; unknown path falls back to index.html (HashRouter handles routes client-side; on Pages a deep path would be a 404, but all links use hashes).
  - ESLint boundaries: a deliberate `features` -> `infrastructure` import and `core` -> `react` import fail; `any` fails; violation files removed.
  - Config: unit tests cover valid, missing, empty, invalid URL (names field) and bad base path; `ConfigErrorScreen` renders an alert. Invalid env values do not fail the build, they show the error screen at runtime (by design).
  - Routing/a11y: tests cover landmarks, skip link first tab stop and focus on main without hash change, title and focus on route change, `aria-current`, not-found page, `useServices` outside provider, StatusMessage roles, Button disabled/loading, reduced-motion and focus-ring CSS, no raw hex outside tokens; token contrast now tested.
  - Workflows: YAML parses; all five action SHAs match `git ls-remote` for the stated tags; permissions are `contents: read` (CI, deploy build), `pages: write` + `id-token: write` only on deploy, `{}` on keep-alive; concurrency groups `ci-<ref>`, `pages`, `supabase-keepalive`; triggers correct (CI on PR, deploy on main push, cron `17 5 * * 1,4`); Node 24, `npm ci`, `persist-credentials: false`.
  - Keep-alive script executed with Git's `sh` (extracted from the YAML): secrets unset -> notice and exit 0; `http://` URL -> error, exit 1; unreachable `https://invalid.example` with `sh -e` (Actions default) -> exit 6; the key is never printed.
  - `.gitignore` covers `node_modules`, `dist`, `.env`, `.env.local`, `.env.*.local`, `coverage`, `*.tsbuildinfo`.
- **Defects / observations** (none blocking):
  - Low: on curl failure the keep-alive log shows the Supabase hostname in curl's error message (GitHub masks the secret value, so low risk).
  - Low: `typecheck` is `tsc -b` rather than `--noEmit`; harmless because tsconfigs set `noEmit`, and `git status` stayed clean.
  - Info: git warns about LF/CRLF on Windows; a `.gitattributes` (`* text=auto eol=lf`) is recommended (tech-lead decision).
- **Not verified (needs real environment)**: GitHub-hosted runs of the workflows, Pages deployment, browser checks of 320px/200% zoom, screen reader and 44px tap targets (token `--tap-target: 2.75rem` exists).
- **Hand off to**: `reviewer`.

## reviewer – APPROVED
- **Summary**: Full branch diff reviewed against the checklist; lint, format, typecheck, 151 tests and build pass. No blocking issues.
- **Non-blocking follow-ups**: keep-alive endpoint `/rest/v1/` may need a trivial table/RPC once Supabase exists (verify on first `workflow_dispatch`); optional `.gitattributes` (`* text=auto eol=lf`).
- **Open questions**: none.
