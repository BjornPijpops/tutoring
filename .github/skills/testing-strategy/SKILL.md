---
name: testing-strategy
description: Test pyramid, tooling and edge cases for the tutoring website. Use when writing or running tests.
---

# Testing strategy

- **Unit** (Vitest): scheduling logic, status transitions, validators, services with fake repositories.
- **Component** (Testing Library): states and accessibility roles/labels.
- **E2E** (Playwright): sign-in via mocked provider, request access, approval, view calendar, request slot; run against the production build.
- **Security tests**: unapproved user cannot read calendar; tutee cannot approve or edit availability; double-booking rejected (backend rules emulator tests).
- Edge cases: DST changes, timezone differences, past slots, concurrent requests, empty/error/offline states.
- Accessibility: automated (axe) plus manual keyboard pass.
- Tests are deterministic (fixed clocks, no network), named by behaviour, and run in CI before deploy.
