# 0002 – Frontend stack: React + Vite + TypeScript

**Status**: Accepted (2026-11-23)

## Context
- Static SPA on GitHub Pages under the base path `/tutoring/`, built and deployed by GitHub Actions.
- Backend is Supabase (ADR 0001); the client talks to it through `@supabase/supabase-js`.
- Features: OAuth login, role-gated views, availability calendar, request forms. One developer, ~10 users, mobile first, WCAG 2.2 AA, strict TypeScript.
- Needs: fast CI, good testability, mature ecosystem, minimal config.

## Options
| Concern | Options considered | Chosen | Why |
|---|---|---|---|
| Framework | **React**, Vue, Svelte, Angular, Astro/Next (SSG) | **React 19** | Largest ecosystem (calendar, a11y, form libs), best AI/tooling support, first-class TS. Vue/Svelte equally viable but smaller component ecosystems; Angular too heavy; SSR frameworks add nothing for an auth-gated SPA. |
| Bundler | **Vite**, webpack, Parcel | **Vite** | Zero-config, fast, native `base` option for Pages, shares config with Vitest. |
| Router | **React Router (HashRouter)**, TanStack Router, `404.html` fallback | **React Router v7 (declarative mode) with `HashRouter`** | Pages cannot rewrite URLs; hash routing needs no `404.html` hack and works with OAuth redirects to a single known URL. |
| Styling | **CSS Modules + design tokens (CSS variables)**, Tailwind, MUI, CSS-in-JS | **CSS Modules + CSS variables** | No runtime, no extra dependency, scoped, easy to keep accessible and mobile-first. Tailwind is a fair alternative; rejected to avoid build plugin and utility-class noise for few screens. Headless a11y primitives (e.g. Radix) may be added when needed. |
| Server state | **TanStack Query**, SWR, hand-rolled hooks | **TanStack Query** | Caching, loading/error states, mutation invalidation; works with any repository port. |
| Client state | Redux, Zustand, **React Context** | **React Context** | Only auth session and DI container are global; everything else is server state or local. |
| Forms/validation | **react-hook-form + zod**, hand-rolled | **zod** (validation at the adapter boundary) + plain controlled forms; add react-hook-form only if forms grow | Input validation is mandatory; zod schemas double as TS types. |
| Date/time | **date-fns + @date-fns/tz**, Luxon, Day.js, Temporal | **date-fns v4 with `@date-fns/tz`** | Tree-shakeable, immutable, TS-native, timezone support. Store UTC (ISO strings), display in the user's zone. Temporal not yet universally supported. |
| Unit/component tests | **Vitest + Testing Library**, Jest | **Vitest + React Testing Library + jest-dom + jsdom** | Same config as Vite, fast. |
| E2E | Playwright, Cypress, none | **Defer** (Playwright when real flows exist) | Skeleton has nothing to e2e yet. |
| A11y checks | **eslint-plugin-jsx-a11y**, axe in tests | **eslint-plugin-jsx-a11y** now; `vitest-axe` for key pages later | Cheap WCAG guardrail in lint. |
| Lint/format | ESLint+Prettier, Biome | **ESLint 9 (flat config, typescript-eslint, react-hooks, jsx-a11y) + Prettier** | Mandated by project rules. |
| Package manager | **npm**, pnpm | **npm** | Already available, fewer moving parts; commit `package-lock.json`. |

## Decision
React 19 + TypeScript (strict) built by Vite 7+, hash routing via React Router, CSS Modules, TanStack Query, date-fns + `@date-fns/tz`, zod, Vitest + Testing Library, ESLint 9 + Prettier, npm.

- Vite `base: '/tutoring/'` (overridable by env for local dev/previews).
- Scripts expected in `package.json`: `dev`, `build` (`tsc -b && vite build`), `preview`, `lint`, `format`, `typecheck`, `test`.
- CI (`.github/workflows`): `npm ci` → lint → typecheck → test → build on PRs; on `main`, upload `dist` with `actions/upload-pages-artifact` and deploy with `actions/deploy-pages`. Pin Node 24.
- The existing bare `src/index.ts` stub is replaced by `src/main.tsx`.

## Consequences
- Large, well-supported ecosystem; low lock-in (hooks and ports are framework-light).
- Hash URLs (`/tutoring/#/calendar`) are slightly less pretty but remove SPA-fallback complexity on Pages and the OAuth redirect issue.
- Bundle includes React + Query + Supabase client (~150–200 KB gzipped); fine for this audience.
- Without Tailwind or a UI kit, a small set of shared accessible components (Button, Field, Dialog…) must be written by us.
- Revisit if the UI grows large (consider a component library) or if pretty URLs become important (move to a `404.html` fallback).
