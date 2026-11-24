# Tutoring

Personal tutoring website. Tutees sign in with a Google or Microsoft account and request access; the tutor approves them. Approved tutees see an availability calendar and request timeslots, which the tutor accepts or declines.

Live site: <https://bjornpijpops.github.io/tutoring/>

> Status: the tutor can sign in with Google and manage a blocked-time calendar (manual entries and `.ics` import) backed by Supabase with row-level security. The tutee availability view, access requests and session requests are not built yet.

## Stack

React 19, TypeScript (strict), Vite, React Router (`HashRouter`), TanStack Query, zod, CSS Modules with CSS variables, Vitest and Testing Library, ESLint and Prettier. Backend: Supabase (Postgres, Auth with Google PKCE, RLS). Dates: date-fns with `@date-fns/tz`; ICS import: `ical.js` (lazy-loaded). Hosting: GitHub Pages via GitHub Actions.

Decisions are recorded in [`docs/adr/`](docs/adr): [0001 backend](docs/adr/0001-backend-supabase-resend.md), [0002 frontend stack](docs/adr/0002-frontend-stack.md), [0003 app architecture](docs/adr/0003-app-architecture.md), [0004 availability calendar](docs/adr/0004-availability-calendar.md), [0005 admin identity and calendar access](docs/adr/0005-admin-identity-and-calendar-access.md).

## Prerequisites

Node.js 24 (see `.nvmrc`) and npm.

## Quick start

```bash
npm ci
cp .env.example .env.local   # optional; without Supabase values the app runs on in-memory fakes
npm run dev
```

The app is served at <http://localhost:5173/tutoring/> (Vite base path `/tutoring/`, override with `VITE_BASE_PATH`).

## Scripts

| Script                 | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | Start the dev server                           |
| `npm run build`        | Typecheck, then build to `dist/`               |
| `npm run preview`      | Serve the production build locally             |
| `npm run lint`         | ESLint (includes accessibility and boundaries) |
| `npm run format`       | Format with Prettier                           |
| `npm run format:check` | Check formatting                               |
| `npm run typecheck`    | `tsc -b`                                       |
| `npm test`             | Run tests once                                 |
| `npm run test:watch`   | Run tests in watch mode                        |

## Structure

```
src/
  app/             App, providers, routes, layout, skip link, focus handling
  core/            domain types, ports (interfaces), config validation
  infrastructure/  composition root (container.ts), in-memory and Supabase adapters, ICS parser
  features/        one folder per feature (home, auth, calendar, not-found)
  shared/          design tokens, global styles, reusable UI components
  test/            test setup and helpers
supabase/          migrations and backend notes
```

Dependency rules (enforced by ESLint where possible):

- `core` imports no React, Supabase or outer layers.
- `features` never import `infrastructure/` or `@supabase/*`; they get services through `useServices()`.
- `infrastructure` implements the ports in `core/ports`; `container.ts` picks the adapters.
- Authorization is enforced server-side (RLS); route guards are only UX.

## Testing

Vitest with jsdom and Testing Library; tests sit next to the code (`*.test.ts(x)`). Render components with in-memory services through `src/test/render-with-services.tsx`.

## CI/CD

Three workflows in `.github/workflows/`, with actions pinned to commit SHAs:

- `ci.yml`: on pull requests to `main`; lint, format check, typecheck, test, build.
- `deploy.yml`: on push to `main`; same checks, then deploys `dist/` to GitHub Pages.
- `supabase-keepalive.yml`: twice a week; pings Supabase so the free tier does not pause. No-op while its secrets are unset.

`main` is protected and every change reaches it through a pull request (squash merge) with green CI.

### One-time setup (repository owner)

1. Settings Ã¢â€ â€™ Pages Ã¢â€ â€™ Source: **GitHub Actions**.
2. Settings Ã¢â€ â€™ Secrets and variables Ã¢â€ â€™ Actions Ã¢â€ â€™ **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public values, optional for now).
3. Same page Ã¢â€ â€™ **Secrets**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (used only by the keep-alive workflow).
4. Protect `main` and require the CI check.
5. In Supabase, allow the redirect URLs listed in [`supabase/README.md`](supabase/README.md).

## Contributing

- One branch per change from an up-to-date `main`: `feature/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`. Never commit to `main` directly.
- Small [Conventional Commits](https://www.conventionalcommits.org/).
- Every change passes the agent workflow described in [`.github/copilot-instructions.md`](.github/copilot-instructions.md); hand-offs go in `docs/handoffs/`, designs in `docs/design/`.

## Security and privacy

The repository is public: no secrets, ever. Only public build-time values (`VITE_*`) reach the browser; service-role and email-provider keys live in Supabase secrets. Tutees may be minors, so personal data is kept to a minimum and GDPR applies.
