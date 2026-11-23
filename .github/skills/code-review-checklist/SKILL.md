---
name: code-review-checklist
description: Final review checklist for correctness, security, cleanliness, documentation and process compliance. Use when reviewing changes.
---

# Review checklist

1. **Process**: all five prior agents left hand-off notes in `docs/handoffs/`; ADRs updated if needed.
2. **Correctness**: meets every acceptance criterion; edge cases handled.
3. **Security/privacy**: server-side authorization, no secrets, input validated, minimal PII.
4. **Design**: respects ADRs; patterns fit (not excessive); modules cohesive; no duplication.
5. **Code quality**: strict types, clear names, small functions, no dead code, errors handled.
6. **Tests**: new logic covered; deterministic; CI green.
7. **UX/a11y**: matches design spec; keyboard and screen-reader friendly.
8. **Docs**: README, TSDoc, ADRs current.
9. **Delivery**: Conventional Commits; Pages build/deploy unaffected.

Output: `APPROVED` or `CHANGES REQUESTED` with a list of {issue, location, severity, owner agent}.
