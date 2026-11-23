---
name: calendar-scheduling-ux
description: Domain knowledge for availability calendars and timeslot requests (timezones, slots, conflicts, statuses). Use for calendar design and logic.
---

# Calendar & scheduling

- Week view on desktop, day/agenda list on mobile; month view only for navigation.
- Slot states: available, requested (mine), pending (other), booked, unavailable. Distinguish with icon + text, not colour alone.
- Always show times with timezone; store UTC (ISO 8601); handle DST using a tested date library (e.g. date-fns/Temporal), never manual offsets.
- Request flow: choose slot → optional subject/note → confirm → status `pending` → tutor accepts/declines → tutee notified (in-app, optionally email).
- Rules to enforce: no past slots, no overlap/double-booking, cancellation window, max pending requests per tutee.
- Tutor view: manage recurring availability (rules + exceptions), inbox of requests, bulk accept/decline.
- Keep scheduling logic as pure functions (easily unit-tested), separate from UI.
