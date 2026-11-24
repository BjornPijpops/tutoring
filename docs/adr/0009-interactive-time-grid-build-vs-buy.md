# ADR 0009 – Build versus buy for the interactive time grid

**Status**: Accepted (2026-11-24). Owner decision: build in-house as proposed; the grid consumes only public `GridBlock` view models.

## Context

ADR 0004 selected an in-house read-only week table because the product needs a fixed 08:00–22:00 window, strong data minimisation, custom styling, and a future tutee mode. The new requirement adds click/drag creation, event activation, editing/deletion, keyboard equivalents, touch support, and reuse for tutee requests. The choice must fit a static GitHub Pages app and remain testable with Vitest and axe.

## Options considered

| Option | Fit and benefits | Costs, risks, and licence | Verdict |
|---|---|---|---|
| **FullCalendar** | Mature interaction model, selection, event editing, touch, and many views; less custom gesture code. | Larger bundle and more CSS/DOM than this fixed calendar needs; extensive configuration and adapter work to preserve our UTC/tutor-zone model and private event projection. Core is open source under GPLv3 (commercial licensing is relevant if GPL obligations are unacceptable); premium features are separately licensed and unnecessary. The accessible keyboard behavior still needs product-specific verification. | Rejected: too much surface area and licence/compliance complexity for one tutor and a later custom tutee mode. |
| **react-big-calendar** | React-oriented, MIT-licensed, supports week/day views, selection, drag/drop, and common date libraries; smaller conceptual footprint than FullCalendar. | Styling, keyboard semantics, touch selection, and screen-reader behavior require significant wrappers; it assumes a general event calendar rather than our stateful availability/request grid. Its event interaction model is not a reusable policy boundary for tutor versus tutee. Date/localizer integration adds another place to get DST/timezone behavior wrong. | Rejected: permissive licence, but insufficient accessibility/control advantage over a focused in-house component. |
| **Custom grid with pointer events** | Small incremental bundle (no calendar dependency), exact design/a11y control, reuse of existing pure week model and CSS tokens, no event-detail leakage, straightforward mode/strategy boundary, and tests can target our actual gestures and policies. | We own pointer capture, keyboard navigation, focus restoration, mobile fallback, virtualization decisions, and regression tests. Poorly designed hit targets or gesture handling could harm accessibility. | **Chosen**: extend the existing grid incrementally behind a generic selectable abstraction and keep all date/selection rules pure. |

## Decision

Build the interaction layer in-house. Keep third-party date handling (`date-fns`/`@date-fns/tz`) and the existing Supabase/React stack; do not add FullCalendar or react-big-calendar. Use pointer events for mouse/touch, with an explicit keyboard path and a non-drag mobile fallback. Implement the abstraction and strategy described in ADR 0008.

The first implementation should reuse the existing `DayModel`/week range computation rather than replacing the data layer. It should add a generic selection model, event projection, and repository update capability only where required. A future tutee request strategy must share rendering and selection but use a different command/validation policy; it must never be able to call tutor event mutation methods.

## Consequences

- No new calendar-library licence, bundle, or long-term upgrade dependency.
- Product-specific a11y and interaction behavior is our responsibility. Required tests include pure snapping/timezone boundaries, pointer click versus drag, keyboard navigation/selection, focus return, dialog validation/error retention, touch fallback, axe, and responsive rendering.
- The implementation is intentionally narrower than a general calendar: no resource columns, arbitrary timezones, month event editing, recurrence UI, or drag-to-move event positioning in the first release.
- Reconsider this decision if requirements expand to multi-resource scheduling, shared calendars, complex recurrence editing, or a full agenda ecosystem; record that change as a superseding ADR rather than introducing a library opportunistically.