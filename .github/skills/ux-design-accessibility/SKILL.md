---
name: ux-design-accessibility
description: UX flows, wireframing, design tokens and WCAG 2.2 AA checks. Use when designing or verifying any user interface.
---

# UX & accessibility

- Start from user goals; map flows with Mermaid and list screens/states: empty, loading, error, success, pending approval, denied.
- Mobile first; touch targets ≥ 44px; clear primary action per screen.
- Define tokens (colours, spacing, type scale, radius) once; build reusable components (Button, Dialog, FormField, CalendarGrid, StatusBadge).
- Accessibility: semantic HTML, visible focus, contrast ≥ 4.5:1, labels for all inputs, ARIA only when needed, no colour-only meaning, `prefers-reduced-motion`, announce async status (`aria-live`).
- Microcopy: short, friendly, unambiguous; explain what happens next after each action.
- Save specs in `docs/design/<feature>.md`.
