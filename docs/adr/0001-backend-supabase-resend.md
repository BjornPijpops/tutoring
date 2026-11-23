# 0001 – Backend: Supabase (free) + Resend for email

**Status**: Accepted (2026-11-23)

## Context
- Static site on GitHub Pages: no trusted server code, so auth, data and authorization need a managed backend.
- Requirements: Google + Microsoft sign-in, approval-gated access, availability calendar, timeslot requests, **email notifications**, ~10 concurrent users, zero cost.

## Options
| Option | Verdict |
|---|---|
| Supabase Free + Resend | Free, instant email via DB webhook → Edge Function, Postgres RLS for authorization. Project pauses after 1 week inactivity. |
| Firebase Spark + GitHub Actions emails | Free, but emails delayed 5–15 min and more moving parts. |
| Firebase Blaze + Cloud Functions | Instant email, but needs a credit card (pay-as-you-go). |
| Firebase + EmailJS (client-side) | Abusable from the browser. Rejected. |

## Decision
Use **Supabase Free** for Auth (Google + Azure/Microsoft OAuth), Postgres with **row-level security** for authorization, and **Edge Functions** triggered by **database webhooks** to send email via **Resend** (free tier, 100 emails/day).

- A scheduled GitHub Action pings the project to prevent the inactivity pause.
- All access to Supabase goes through repository/adapter interfaces (`AuthProvider`, `AvailabilityRepository`, `SessionRequestRepository`, `AccessRequestRepository`, `Notifier`) to limit lock-in.
- Secrets (Resend API key, service role key) live only in Supabase/GitHub secrets, never in the bundle. Only the public anon key and URL ship to the client.
- Schema and RLS policies are versioned as SQL migrations in `supabase/migrations/`.

## Consequences
- Postgres relational model fits slots/requests; double-booking is prevented with a database constraint.
- Free-tier limits (500 MB DB, 100 emails/day, pausing) are acceptable at this scale.
- Email delivery to arbitrary tutees requires a verified sending domain in Resend; `onboarding@resend.dev` only works for testing/own address.
- Microsoft login requires a free Entra app registration.
