---
name: architecture-decisions
description: Write ADRs and evaluate tech stack options for the tutoring website. Use when choosing frameworks, services, data models or patterns.
---

# Architecture decisions

1. State the problem and constraints (static GitHub Pages hosting, free tier, Microsoft/Google login, GDPR, single tutor).
2. List ≥2 realistic options; compare on: fit, maturity, cost, lock-in, complexity, security, testability.
3. Decide, and record in `docs/adr/NNNN-title.md`:
   `Status | Context | Options | Decision | Consequences`.
4. Define boundaries as interfaces (ports/adapters) so providers can be swapped: `AuthProvider`, `AvailabilityRepository`, `BookingRequestRepository`, `AccessRequestRepository`.
5. Model core entities: User, Role (tutor|tutee), AccessRequest (pending|approved|denied), AvailabilitySlot, SessionRequest (pending|accepted|declined|cancelled). Store times in UTC, display in the user's timezone.
6. Prefer the simplest design that meets requirements; revisit ADRs when they're superseded (mark as such, don't delete).
