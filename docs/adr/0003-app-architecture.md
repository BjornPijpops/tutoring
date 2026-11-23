# 0003 – App architecture: feature folders, ports & adapters, config

**Status**: Accepted (2026-11-23)

## Context
ADR 0001 requires all Supabase access behind interfaces; ADR 0002 fixes the stack. We need a simple structure for a one-person project that keeps features cohesive, logic testable without a network, and the backend swappable.

## Options
| Option | Verdict |
|---|---|
| Layer-based folders (`components/`, `hooks/`, `services/`) | Scatters each feature across the tree; rejected. |
| **Feature folders + shared `core` with ports/adapters** | Cohesive features, testable via in-memory fakes. **Chosen.** |
| Full clean/hexagonal with use-case classes | Over-engineered for this size. Rejected. |

## Decision
```
src/
  main.tsx                 # entry: build container, mount <App/>
  app/                     # App, providers, router, layout, route guards
  core/
    domain/                # entities & types (User, Role, AccessRequest, AvailabilitySlot, SessionRequest), pure logic
    ports/                 # interfaces: AuthProvider, AccessRequestRepository,
                           #   AvailabilityRepository, SessionRequestRepository, Notifier(optional)
    config.ts              # reads & zod-validates import.meta.env (VITE_*)
  infrastructure/
    supabase/              # client factory + adapters implementing the ports
    memory/                # in-memory fakes for tests and local UI work
    container.ts           # composition root: picks adapters, returns Services
  features/
    auth/                  # login page, session hook, callback handling
    access/                # request access, tutor approval list
    calendar/              # availability calendar
    sessions/              # timeslot requests, tutor accept/decline
  shared/                  # ui components (Button, Field…), hooks, utils (dates)
  test/                    # setup, test render helper with fake container
supabase/migrations/       # SQL + RLS (ADR 0001)
```

Rules:
- Dependency direction: `features → core/ports`, `infrastructure → core`, `app` wires everything. `core` imports nothing from React or Supabase. Features never import `infrastructure` or `@supabase/*`.
- **Dependency injection** via a React Context `ServicesProvider` fed by `container.ts`; hooks like `useServices()` expose ports. Tests render with `memory` adapters.
- Ports return domain types and typed results/errors; adapters map DB rows to domain types and validate with zod.
- **Server-side authorization** stays in RLS; route guards (`RequireAuth`, `RequireRole`) are UX only.
- **Config**: only public values via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (+ optional `VITE_BASE_PATH`). Provided to CI via GitHub Actions variables (not secrets-in-bundle concerns, as they are public). `.env.example` is committed; `.env*.local` is gitignored. Missing/invalid config fails fast with a clear error screen. No service-role or Resend keys in the client, ever.
- **Routing on Pages**: `HashRouter`; Supabase OAuth `redirectTo` is `https://bjornpijpops.github.io/tutoring/` (and `http://localhost:5173/`), with `detectSessionInUrl` handling the callback before the router navigates. Add those URLs to the Supabase allowed redirects and the Google/Entra apps.
- Times are UTC ISO strings in domain/ports; conversion to local zone only in the UI via `shared/dates`.
- Colocate tests next to code (`*.test.ts(x)`); tests required for new logic.
- Skeleton scope: folders, ports (interfaces), config, container, in-memory adapters, placeholder routes (Home, Login, Calendar, Not found), a smoke test, CI and Pages deploy workflows. No real features.

## Consequences
- Backend swap or offline UI development only requires a new adapter.
- Small ceremony (ports + container) but fits the repo's mandated repository/adapter pattern; no use-case layer until logic justifies it.
- Hash routing means the Pages base path only matters for assets (Vite `base`).
