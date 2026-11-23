# Tutoring Website – Project Rules

## Product
Personal website hosted on **GitHub Pages** (deployed via **GitHub Actions**, repo `BjornPijpops/tutoring`, branch `main`).
Tutees sign in with a **Microsoft or Google account** and request access. The owner (tutor) approves/denies.
Approved tutees see an **availability calendar** and can **request timeslots** for tutoring sessions; the tutor accepts/declines.

Hosting is static-only: anything needing a server (auth, data, authorization) must use a managed backend service
or serverless provider, and authorization must be enforced server-side (never only in client code).

## Mandatory workflow: every request goes through ALL agents
Every user request – feature, bug, refactor, doc change – passes through these agents **in this order**:

1. `architect` – scope, constraints, design/ADR impact
2. `ui-ux-designer` – flows, wireframes, accessibility (if no UI is touched, state "no UI impact" with a reason)
3. `tech-lead` – breaks work into tasks, picks patterns, defines acceptance criteria
4. `developer` – implements
5. `qa` – tests and verifies against acceptance criteria
6. `reviewer` – final review; approve or send back

Rules:
- No agent may be skipped. An agent with nothing to change must still report "no impact" with a reason.
- Each agent appends a short hand-off note to `docs/handoffs/<yyyy-mm-dd>-<slug>.md` (see skill `handoff-notes`).
- If `qa` or `reviewer` find problems, work returns to `developer` (or the earlier agent if the design is at fault) and then re-passes `qa` and `reviewer`.
- Only the `reviewer` can declare work done. Nothing is merged to `main` unreviewed.
- The main (orchestrating) agent invokes each agent in sequence via the `task` tool, passing the previous hand-off along.

## Quality standards (all agents)
- **Clean**: small functions, meaningful names, no dead code, no duplication, single responsibility.
- **Re-usable**: shared UI components, services, utilities; no copy-paste between features.
- **Documented**: TSDoc on public APIs, README kept current, ADRs in `docs/adr/` for significant decisions, comments only for non-obvious *why*.
- **Design patterns** where they fit (repository/adapter for data & auth providers, dependency injection, container/presentational components, strategy, observer). No patterns without a need.
- **Best tech stack for the job**: justify in an ADR; prefer mature, well-supported, free-tier-friendly options suited to static hosting.
- **TypeScript strict**; ESLint + Prettier; tests required for new logic.
- **Security & privacy**: no secrets in repo, least privilege, validate input, minimise personal data (tutees may be minors – GDPR applies).
- **Accessibility**: WCAG 2.2 AA, keyboard navigable, mobile first.
- Conventional Commits; CI (lint, typecheck, test, build) must pass before deploy.

## Repo conventions
- Agents: `.github/agents/*.agent.md`; skills: `.github/skills/<name>/SKILL.md`.
- Docs: `docs/adr/`, `docs/design/`, `docs/handoffs/`.

## Branching (enforced by `tech-lead`)
- `main` is protected and always deployable; **never commit directly to `main`** (the one-time agent/ADR bootstrap commits excepted).
- The tech lead creates one branch per request from an up-to-date `main`: `feature/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- Small Conventional Commits on the branch; open a Pull Request into `main` (squash merge) only after `qa` passes and `reviewer` is APPROVED; CI must be green.
- Delete the branch after merge. Release/hotfix branches are not needed (single environment).

## Deploy verification (mandatory)
After every merge to `main`, the work is **not done** until the deploy is verified:
1. The `Deploy to GitHub Pages` run for the merge commit completed with `success` (query `https://api.github.com/repos/BjornPijpops/tutoring/actions/runs`; the GitHub MCP tools point at another host and don't work for this repo).
2. The live site `https://bjornpijpops.github.io/tutoring/` returns 200, and its referenced `/tutoring/assets/*.js` loads.
3. For features, smoke-check the changed behaviour on the live site.
If anything fails, fix it (new `fix/<slug>` branch through the full agent pipeline) and re-verify **before** reporting done. The `reviewer` records the verification result in the hand-off note.
- No GitHub PRs for now: branches are squash-merged locally and pushed. Large changes are verified locally by the owner before merge.
