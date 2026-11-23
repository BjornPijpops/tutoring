---
name: typescript-clean-code
description: Clean, reusable, documented TypeScript conventions for this project. Use when writing or reviewing code.
---

# TypeScript clean code

- `strict` mode; no `any` (use `unknown` + narrowing); prefer `readonly`, discriminated unions and branded/enum types for statuses.
- Small pure functions; one responsibility per module; dependency injection over globals/singletons.
- Feature-based folders (`src/features/<name>/{components,services,model}`) plus `src/shared/`.
- Validate external data at the boundary (e.g. zod); never trust client input.
- Errors: typed/explicit results, no swallowed exceptions.
- TSDoc on exported symbols; comments explain *why*. Keep README current.
- Naming: intention-revealing, no abbreviations; files kebab-case.
- ESLint + Prettier; Conventional Commits.
