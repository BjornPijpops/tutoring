---
name: task-breakdown-patterns
description: Break requests into testable tasks with acceptance criteria and choose fitting design patterns. Use when planning implementation.
---

# Task breakdown & patterns

- Slice vertically: each task delivers a small, testable behaviour, ordered by dependency.
- Acceptance criteria in Given/When/Then; include negative and permission cases.
- Per task list: files/modules, public interfaces, tests required, docs to update.
- Pattern guide: Adapter (auth/data providers), Repository (persistence), Strategy (slot rules), Observer/hooks (state), Factory (config-based wiring), Dependency Injection (testability), Container/Presentational (UI).
- Look for existing reusable code first; extract shared code on the second use.
- Definition of done: lint, typecheck, tests, build pass; docs updated; hand-off note written.
