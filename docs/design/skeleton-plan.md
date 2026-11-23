# Plan: project skeleton (tech-lead)

Inputs: ADR 0001-0003, `docs/design/skeleton.md`, handoff `2026-11-23-project-skeleton.md`. Scope is skeleton only: no real features, no real schema.

## 0. Branching verification

- `git branch --show-current` -> `feature/project-skeleton`.
- `git log --oneline -3` on branch and on `main` are identical (`772679c`, `4867b33`, `9622e7f`): the branch has no commits of its own yet, so it was created from the tip of `main`, and `main` has received no direct commits for this request.
- Working tree: the ADRs 0002/0003, design and handoff docs are untracked (not yet committed). They go in the first commit on this branch. Nothing was committed or switched by the tech lead.

## 1. Decisions and patterns

| Pattern | Where | Why |
|---|---|---|
| Ports & Adapters / Repository | `src/core/ports` + `src/infrastructure/*` | ADR 0001/0003: backend swappable, features testable offline |
| Dependency Injection | `ServicesProvider` + `useServices()`; `container.ts` composition root | Tests render with in-memory fakes |
| Factory | `createContainer(config)` picks adapters | Config-based wiring |
| Container/Presentational | pages compose `shared/ui` presentational components | Reuse, a11y in one place |
| Result type | `Result<T, E>` in `core/domain` | Explicit errors, no swallowed exceptions |

Rules: `core` imports no React/Supabase; `features` never import `infrastructure` or `@supabase/*` (enforce with ESLint `no-restricted-imports`); no `any`; TSDoc on exports; kebab-case files; tests colocated `*.test.ts(x)`; CSS uses only token variables.

Skeleton choice: **Supabase adapters are NOT implemented** (no `@supabase/supabase-js` dependency yet, no real schema). `container.ts` always wires the in-memory adapters in the skeleton; `infrastructure/supabase/` holds only a `README.md`/`.gitkeep` note. This keeps scope minimal; the first feature request adds the client + adapters. Config is still read and validated so the contract is fixed.

## 2. Target file structure

```
.editorconfig                       (optional, small)
.env.example
.gitignore                          (extend)
.prettierrc.json  .prettierignore
eslint.config.js
index.html                          (lang="en", viewport w/o user-scalable, <div id="root">, script src/main.tsx)
package.json  package-lock.json  README.md
tsconfig.json  tsconfig.app.json  tsconfig.node.json
vite.config.ts                      (also vitest config via vitest/config)
.github/workflows/ci.yml  deploy.yml  supabase-keepalive.yml
supabase/README.md  supabase/migrations/.gitkeep
src/
  main.tsx                          build container, mount <App/>, import styles
  vite-env.d.ts                     typed ImportMetaEnv (VITE_*)
  app/
    app.tsx                         providers (ServicesProvider, QueryClientProvider), HashRouter, routes
    layout.tsx  layout.module.css   SkipLink, header/nav, <main id="main" tabIndex=-1>, footer, Outlet
    skip-link.tsx
    route-focus.tsx                 on route change: focus main + set document.title "<Page> · Tutoring"
    config-error-screen.tsx         shown when config invalid
    services-context.tsx            ServicesProvider, useServices
    routes.tsx                      route table w/ page titles
  core/
    config.ts                       zod parse of import.meta.env -> AppConfig; parseConfig(env) pure
    domain/
      result.ts                     Result<T,E>, ok(), err()
      user.ts                       User, Role ('tutor'|'tutee'), AccessStatus
      access-request.ts  availability-slot.ts  session-request.ts
    ports/
      auth-provider.ts  access-request-repository.ts  availability-repository.ts
      session-request-repository.ts  notifier.ts  index.ts
  infrastructure/
    container.ts                    Services type + createContainer(config)
    memory/                         in-memory-auth-provider.ts, in-memory-*-repository.ts, in-memory-notifier.ts, index.ts
    supabase/README.md              "adapters land with first feature"
  features/
    home/home-page.tsx   auth/login-page.tsx   calendar/calendar-page.tsx   not-found/not-found-page.tsx
    (each + .module.css where needed; folders `auth/`, `calendar/` are the future feature homes)
  shared/
    styles/tokens.css  global.css   (tokens exactly per docs/design/skeleton.md section 2; global: focus ring, reduced motion, scroll-padding-top)
    ui/ button.tsx button-link.tsx container.tsx page-heading.tsx status-message.tsx (+ .module.css, + .test.tsx, index.ts)
  test/setup.ts  render-with-services.tsx
```
Deleted: `src/index.ts` (git rm).

## 3. Interfaces (ports, `src/core/ports`)

All times are UTC ISO-8601 strings (`type IsoDateTime = string`, branded optional). All async methods return `Promise<Result<T, PortError>>`.

```ts
type PortError = { kind: 'unauthenticated' | 'forbidden' | 'not-found' | 'conflict' | 'validation' | 'unavailable'; message: string };

interface AuthProvider {
  getSession(): Promise<Result<Session | null, PortError>>;
  signIn(provider: 'google' | 'azure'): Promise<Result<void, PortError>>;
  signOut(): Promise<Result<void, PortError>>;
  onSessionChange(listener: (s: Session | null) => void): Unsubscribe;
}
interface AccessRequestRepository {
  request(): Promise<Result<AccessRequest, PortError>>;           // for current user
  getMine(): Promise<Result<AccessRequest | null, PortError>>;
  listPending(): Promise<Result<readonly AccessRequest[], PortError>>;   // tutor
  decide(id: string, decision: 'approved' | 'denied'): Promise<Result<AccessRequest, PortError>>; // tutor
}
interface AvailabilityRepository {
  listSlots(range: { from: IsoDateTime; to: IsoDateTime }): Promise<Result<readonly AvailabilitySlot[], PortError>>;
  upsertSlot(slot: NewAvailabilitySlot): Promise<Result<AvailabilitySlot, PortError>>;   // tutor
  removeSlot(id: string): Promise<Result<void, PortError>>;                              // tutor
}
interface SessionRequestRepository {
  create(slotId: string): Promise<Result<SessionRequest, PortError>>;
  listMine(): Promise<Result<readonly SessionRequest[], PortError>>;
  listPending(): Promise<Result<readonly SessionRequest[], PortError>>;                  // tutor
  decide(id: string, decision: 'accepted' | 'declined'): Promise<Result<SessionRequest, PortError>>;
}
interface Notifier { notifyTutor(event: TutorNotification): Promise<Result<void, PortError>>; }  // tutor-only (ADR 0001)
```
Domain: `Role`, `User {id, displayName?, role}` (minimise personal data: no email in domain unless needed), `AccessRequest {id, userId, status: 'pending'|'approved'|'denied', createdAt}`, `AvailabilitySlot {id, startsAt, endsAt, status: 'open'|'booked'}`, `SessionRequest {id, slotId, userId, status: 'pending'|'accepted'|'declined', createdAt}`, `TutorNotification` discriminated union (`access-requested` | `session-requested`). Use discriminated unions/readonly; method lists may be trimmed by developer if unused, but ports must exist and be implemented by the in-memory fakes. Fakes: constructor takes optional seed data, deterministic ids via injected generator, no timers.

`core/config.ts`: `AppConfig { supabaseUrl: string(url); supabaseAnonKey: string(min 1); basePath: string }`; `parseConfig(env: Record<string, unknown>): Result<AppConfig, ConfigError>` (pure, tested). Skeleton behaviour: `main.tsx` renders `ConfigErrorScreen` when invalid **only if** `VITE_SUPABASE_*` are required; since skeleton uses in-memory adapters, make the Supabase vars optional in the schema (`.optional()`) with a TODO-free comment explaining that they become required when the Supabase adapter lands. Decision recorded here so CI builds pass without repo variables.

## 4. Scripts (`package.json`)

`dev` = `vite`; `build` = `tsc -b && vite build`; `preview` = `vite preview`; `lint` = `eslint .`; `format` = `prettier --write .`; `format:check` = `prettier --check .`; `typecheck` = `tsc -b --noEmit` (or `tsc -p tsconfig.app.json --noEmit`; pick whichever works with project refs); `test` = `vitest run`; `test:watch` = `vitest`. Add `"engines": {"node": ">=24"}` and `.nvmrc` = `24`. Remove `"main": "dist/index.js"`; set `"description"`. Keep `private: true`.
Dependencies: react, react-dom, react-router (v7), @tanstack/react-query, zod, date-fns, @date-fns/tz. Dev: vite (7+), @vitejs/plugin-react, typescript (keep ^6), vitest, jsdom, @testing-library/react, /jest-dom, /user-event, eslint 9, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-jsx-a11y, prettier, eslint-config-prettier, @types/react, @types/react-dom. Install latest compatible; commit `package-lock.json`. Do not add unused deps beyond those the skeleton uses: if `date-fns`/`@date-fns/tz` are unused, defer them (add with the calendar feature) to avoid dead dependencies.

## 5. tsconfig adjustments

- Replace CommonJS/`es2016`/`outDir: dist` config. `tsconfig.json` = solution file with `references` to `tsconfig.app.json` and `tsconfig.node.json`, `files: []`.
- App: `target ES2022`, `lib [ES2022, DOM, DOM.Iterable]`, `module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `noEmit`, `skipLibCheck`, `forceConsistentCasingInFileNames`, `types [vite/client, vitest/globals?, @testing-library/jest-dom]`, `include [src]`.
- Node: covers `vite.config.ts`, `eslint.config.js`; `module ESNext`, `moduleResolution bundler`, `noEmit`.
- No `any`; keep `strict: true`.

## 6. CI / CD workflows

Common: pin every third-party action to a **full commit SHA with a `# vX.Y.Z` comment** (developer resolves current SHAs for `actions/checkout`, `actions/setup-node`, `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`; do not guess SHAs). Top-level `permissions: contents: read`; elevate per job only. Node 24 via `actions/setup-node` with `cache: npm`; `npm ci`. `timeout-minutes` on jobs. Use `persist-credentials: false` on checkout.

**`ci.yml`** - trigger `pull_request` (targets `main`) and `workflow_dispatch`. Concurrency `group: ci-${{ github.ref }}`, `cancel-in-progress: true`. Single job: `npm ci` -> `npm run lint` -> `npm run format:check` -> `npm run typecheck` -> `npm test` -> `npm run build`. Permissions: `contents: read` only. No secrets.

**`deploy.yml`** - trigger `push` to `main` (and `workflow_dispatch`). Concurrency `group: pages`, `cancel-in-progress: false`. Job `build`: same checks as CI, then `actions/configure-pages`, build with `VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}` / `VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}` (repo **Variables**, public values only; may be empty in skeleton), `actions/upload-pages-artifact` with `path: dist`. Job `deploy` (`needs: build`): `permissions: pages: write, id-token: write`, `environment: name: github-pages, url: ${{ steps.deployment.outputs.page_url }}`, `actions/deploy-pages`. Deploy never runs on PRs. (One-time manual: repo Settings -> Pages -> Source: GitHub Actions; record in README.)

**`supabase-keepalive.yml`** - triggers `schedule` (cron twice weekly, off-peak non-:00 minute, e.g. `17 5 * * 1,4`) and `workflow_dispatch`. Top-level `permissions: {}` (no token scopes needed; no checkout). Concurrency group `supabase-keepalive`. Job: pass secrets via `env: SUPABASE_URL: ${{ secrets.SUPABASE_URL }}`, `SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}`. Shell step: if either is empty -> `echo "::notice::SUPABASE_URL / SUPABASE_ANON_KEY not set; skipping keep-alive"` and `exit 0` (safe no-op, job green). Otherwise `curl --fail --silent --show-error --max-time 30 --retry 3 -o /dev/null -H "apikey: $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/"`; never echo the secrets or URL (no `set -x`); fail the job on non-2xx so the owner is alerted. Validate `SUPABASE_URL` starts with `https://`. No `pull_request` trigger (secrets unavailable to forks anyway). Risk: GitHub disables scheduled workflows after 60 days of repo inactivity, and `/rest/v1/` with an anon key may be restricted on newer Supabase projects; if it returns 401/404 the follow-up must switch to a trivial table/RPC query (a `keepalive` migration in the first backend request). Document in `supabase/README.md`.

## 7. Supabase folder and docs

- `supabase/migrations/.gitkeep`; `supabase/README.md`: purpose (SQL migrations + RLS per ADR 0001, applied with Supabase CLI later), no schema yet, naming `<timestamp>_<description>.sql`, rule "no secrets; service-role/Resend/TUTOR_EMAIL live only in Supabase secrets", required redirect URLs (`https://bjornpijpops.github.io/tutoring/`, `http://localhost:5173/`), keep-alive explanation and the two repo secrets.
- `.env.example`: `VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`, `# VITE_BASE_PATH=/tutoring/` with comments: public values only; copy to `.env.local` (gitignored); never put service-role keys here.
- `.gitignore`: keep existing; add `dist/`, `coverage/`, `.env`, `.env.local`, `.env.*.local`, `*.tsbuildinfo`; do not ignore `.env.example`. Remove irrelevant `/tmp`, `/out-tsc` only if trivially clean (optional).
- `README.md`: project summary + live URL; stack list (link ADRs); prerequisites (Node 24); quick start (`npm ci`, `cp .env.example .env.local`, `npm run dev`); scripts table; folder structure + dependency rules; testing; CI/CD overview (three workflows, branch protection, squash merge); one-time setup (Pages source = GitHub Actions; repo Variables `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; repo Secrets `SUPABASE_URL`/`SUPABASE_ANON_KEY` for keep-alive; Supabase redirect URLs); contributing (branching, Conventional Commits, agent workflow, docs locations); security/privacy note (public repo, no secrets, tutees may be minors).

## 8. Ordered tasks with acceptance criteria

Each task = one small commit; every task leaves `npm run lint/typecheck/test/build` green once its tooling exists.

**T1 - Docs baseline** (`docs:`) Commit the untracked ADRs, design, plan, handoff files.
- Given the branch, When committed, Then only `docs/` files are added.

**T2 - Tooling & TS config** (`chore:`) package.json (scripts/deps/engines), `.nvmrc`, tsconfigs, `vite.config.ts`, `index.html`, `eslint.config.js`, Prettier files, `.gitignore`, `.env.example`, delete `src/index.ts`, add minimal `src/main.tsx` + `vite-env.d.ts`.
- Given a clean clone, When `npm ci && npm run build`, Then it succeeds and `dist/index.html` references assets under `/tutoring/`.
- Given `src/index.ts`, When T2 is done, Then it no longer exists and no config references `dist/index.js`.
- Given `any` or an unused variable, When `npm run lint`/`typecheck`, Then they fail (config really enforces).
- Given a `features/*` file imports from `infrastructure` or `@supabase/*`, When linted, Then error.

**T3 - Core domain, ports, config** (`feat(core):`) `Result`, domain types, ports, `parseConfig`.
- Given valid env, When `parseConfig`, Then `ok` with typed config; Given an invalid URL, Then `err` naming the field; Given no Supabase vars, Then ok with them undefined.
- Given `core/`, When searched, Then there are no imports from react/supabase/infrastructure.

**T4 - In-memory adapters + container** (`feat(infrastructure):`) fakes for every port; `createContainer`.
- Given a fake `AccessRequestRepository`, When `request()` then `listPending()`, Then it contains one pending request; When `decide(id,'approved')`, Then status `approved` and it leaves pending; Given unknown id, Then `err({kind:'not-found'})`.
- Given `SessionRequestRepository` with a booked slot, When `create(slotId)` again, Then `err({kind:'conflict'})`.
- Given `createContainer(config)`, Then it returns all services implementing the ports.

**T5 - Design tokens & global styles** (`feat(ui):`) `tokens.css`, `global.css`.
- Given tokens.css, Then every variable in design section 2 exists with the specified values for light and dark (`prefers-color-scheme`), `color-scheme: light dark` set.
- Given any `*.module.css`/`global.css`, Then no raw hex colours outside `tokens.css`.
- Given `:focus-visible`, Then 3px outline with `--color-focus`, offset 2px; Given `prefers-reduced-motion: reduce`, Then transitions/animations none.

**T6 - Base components** (`feat(ui):`) Button, ButtonLink, Container, PageHeading, StatusMessage, each with test.
- Button: Given no `type`, Then `type="button"`; Given `loading`, Then `aria-busy="true"`, disabled, label kept; Given `variant='secondary'`, Then secondary class; Given click when disabled, Then handler not called.
- ButtonLink: Given a `to`, Then role `link` with the name; styled like Button.
- PageHeading: Then exactly one `h1`; with `lead`, a paragraph follows.
- StatusMessage: Given `error`, Then `role="alert"`; Given info/success/warning, Then `role="status"`; Then a visually-hidden prefix ("Error:" etc.) is present and the icon is `aria-hidden`.

**T7 - App shell, routing, DI** (`feat(app):`) services-context, layout, skip link, route-focus, routes, `app.tsx`, wire `main.tsx`.
- Given the app, When the first Tab is pressed, Then the skip link is focused; When activated, Then focus moves to `main` and the URL hash is unchanged.
- Given the layout, Then landmarks: one banner, nav labelled "Main", one main, one contentinfo.
- Given navigation to `#/calendar`, Then `document.title` is "Calendar · Tutoring" and focus is on `main`; nav link has `aria-current="page"`.
- Given an unknown route, Then the Not found page with h1 "Page not found" and a "Back to home" link.
- Given a component calling `useServices()` outside a provider, Then it throws a clear error.

**T8 - Placeholder pages** (`feat(features):`) Home, Login, Calendar, Not found per design section 4.
- Home: Given `#/`, Then h1 "Tutoring" and a link "Sign in" to `#/login`.
- Login: Given `#/login`, When clicking "Continue with Google" (or Microsoft), Then an info StatusMessage "Sign-in is not available yet." appears; no network call, no throw.
- Calendar: Then h1 "Calendar" and info "The availability calendar is coming soon."

**T9 - Test harness + smoke test** (`test:`) `test/setup.ts`, `render-with-services.tsx`, `app.test.tsx` smoke covering routes. (May be committed alongside T7/T8; keep tests with their code.)
- Given `npm test`, Then all pass; Given the smoke test, Then Home renders in the app with the fake container.

**T10 - Workflows** (`ci:`) `ci.yml`, `deploy.yml`, `supabase-keepalive.yml` per section 6.
- Given a PR to `main`, Then only CI runs, with `contents: read`, and the checks run in the order lint -> format -> typecheck -> test -> build.
- Given a push to `main`, Then build then deploy run, deploy has `pages: write` + `id-token: write` and `environment: github-pages`; concurrency group `pages`.
- Given any workflow, Then every `uses:` is a 40-char SHA with a version comment; no workflow has write permissions beyond the above.
- Given keep-alive with secrets unset, When it runs, Then it exits 0 with a notice; Given set secrets and a 5xx/timeout, Then it fails; Then secrets are never printed.
- Validate YAML (e.g. `actionlint` if available, or `npx yaml` parse); runs on GitHub can only be verified after pushing.

**T11 - Supabase placeholder & README** (`docs:`/`chore:`) `supabase/README.md`, `migrations/.gitkeep`, root `README.md`, `infrastructure/supabase/README.md`.
- Given the README, When a new dev follows quick start, Then `npm run dev` serves the app at `http://localhost:5173/tutoring/`.
- Given the README, Then it lists scripts, structure, one-time GitHub/Supabase setup and branching/commit rules; no secrets or tutor email.

**T12 - Handoff & final verification** Developer appends handoff; run the full pipeline locally.
- Given the branch, When running `npm ci && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`, Then all pass.

## 9. Commit plan (Conventional Commits, small, on `feature/project-skeleton`)

1. `docs: add ADRs 0002-0003, skeleton design and plan, handoffs`
2. `chore: set up Vite, React, strict TypeScript, ESLint and Prettier` (removes `src/index.ts`)
3. `feat(core): add domain types, ports and config validation`
4. `feat(infrastructure): add in-memory adapters and container`
5. `feat(ui): add design tokens, global styles and base components`
6. `feat(app): add app shell, hash routing and services provider`
7. `feat(features): add placeholder pages with smoke tests`
8. `ci: add CI, Pages deploy and Supabase keep-alive workflows`
9. `docs: add README, .env.example and supabase folder notes`

Each with trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`. No commits to `main`.

**PR / merge step** (after `qa` PASS and `reviewer` APPROVED): push branch, open PR `feature/project-skeleton` -> `main` titled `feat: project skeleton (React, Vite, ports & adapters, CI/CD)` with summary, ADR links, manual setup checklist; wait for green CI; **squash merge** (title = Conventional Commit); delete branch. Post-merge: confirm the deploy run succeeded and `https://bjornpijpops.github.io/tutoring/` loads (requires Pages source = GitHub Actions); trigger keep-alive via `workflow_dispatch` once secrets are set.

## 10. QA test plan outline

- **Automated** (`npm test`): config parsing (valid/invalid/missing); `Result` helpers; every in-memory adapter (happy, not-found, conflict, forbidden/negative); `createContainer`; each base component (roles, names, states); app shell (landmarks, skip link, focus move, title, aria-current); each page content; not-found route; `useServices` outside provider.
- **Pipeline**: clean `npm ci`; lint, format:check, typecheck, test, build all green; `dist/` assets use `/tutoring/` base; `npm run preview` serves the app; no `src/index.ts`; build output contains no secrets (grep bundle for `service_role`, `RESEND`).
- **Static checks**: no raw hex outside `tokens.css`; no `any`; boundary lint rule works (create a deliberate violation locally, confirm failure, revert); workflow lint (SHA-pinned, permissions, concurrency, triggers).
- **Keep-alive**: simulate script with env unset (exit 0 + notice) and set to an unreachable `https://invalid.example` (non-zero); confirm no secret echo.
- **Manual a11y** (design section 6 checklist): keyboard only (skip link first tab stop, focus ring visible both themes, Enter/Space), 320px and 200% zoom no horizontal scroll, `prefers-reduced-motion`, dark mode, screen reader spot check of titles/alerts, tap targets >= 44px.
- **Negative**: unknown hash route; invalid env values; disabled/loading Button does not fire.

## 11. Reviewer focus list

1. Branching: all commits on `feature/project-skeleton`, none to `main`; Conventional Commit messages; PR squash merge only.
2. Architecture boundaries (ADR 0003): `core` framework-free; features never import `infrastructure`/`@supabase`; lint rule exists and works; no dead or speculative code/deps.
3. Ports match ADR 0001 names; `Notifier` tutor-only; Result-based errors; no `any`; TSDoc on exports.
4. No secrets or tutor email in repo; `.env.example` only public vars; `.gitignore` covers `.env*.local`, `dist`, `coverage`; bundle contains only public config.
5. Workflows: SHA-pinned actions, least-privilege `permissions`, concurrency, correct triggers (CI on PR; deploy on main push only), keep-alive no-op safety, no secret leakage, Node 24, `npm ci`.
6. Vite `base`, HashRouter, Pages setup documented; `src/index.ts` removed; tsconfig strict and modern (no CommonJS/`dist/index.js` leftovers).
7. Accessibility: tokens match design values and contrast; landmarks, skip link, focus management, titles, StatusMessage roles, tap targets, reduced motion; jsx-a11y active.
8. Tests are meaningful (roles/names, negative cases), not snapshot-only; coverage of every acceptance criterion above.
9. README accuracy (commands actually work); handoff notes from every agent present.

## 12. Open items (non-blocking)

- Keep-alive endpoint may need a real table/RPC later (see section 6 risk).
- SHA resolution for pinned actions is done by developer at implementation time.
- Branch protection / required status checks on `main` are repo settings to be configured by the owner (cannot be done from the repo files).
