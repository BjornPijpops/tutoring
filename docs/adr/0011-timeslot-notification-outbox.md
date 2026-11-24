# ADR 0011 – Reusing the tutor notification outbox for timeslot requests

**Status**: Accepted (2026-11-24)

## Context

ADR 0007 established the reliable-enough notification path for access requests: a database trigger creates an outbox event, `pg_net` invokes a secret-protected Edge Function, Resend sends only to the tutor, and `pg_cron` retries bounded failures. Timeslot requests need the same behaviour. Saving a request must remain independent of email delivery, retries must be idempotent, and no browser-held anon key may be able to send arbitrary mail.

The existing access notification implementation is event-specific and already has production setup expectations. Copying its SQL, retry logic, secret handling, and escaping rules into a second unrelated implementation would create drift; changing its established payload contract without a migration plan could break access-request notifications.

## Decision

Use one versioned tutor-notification delivery pattern for both workflows, while keeping event records and message builders explicitly typed by event kind.

### Outbox contract

Add a notification outbox abstraction for tutor events (the exact table name is chosen by the implementation migration; `tutor_notification_outbox` is the recommended name) with:

- `id` UUID primary key, generated server-side;
- `event_type` constrained to `access-requested` and `session-requested`;
- the owning request id and user id as UUIDs;
- `created_at`, `sent_at`, and non-negative `attempts`;
- a uniqueness/idempotency key per event, so a retry never collapses a distinct re-request or timeslot request.

The implementation may migrate the existing access outbox into this common shape or keep a compatibility view/adapter during rollout. It must not delete or silently rewrite already queued access events. The database trigger for a newly created timeslot request inserts one `session-requested` event and invokes the same private dispatch/retry mechanism. Cancellation, decline, and acceptance do not send a second tutor email unless a later product decision explicitly adds that behaviour.

### Delivery path

1. The session-request RPC commits the request and its outbox row in the same transaction. The asynchronous dispatch is best effort and cannot roll back the request.
2. A private, security-definer dispatcher reads the webhook URL and shared secret from Vault, sends only event/user/request ids through `pg_net`, and increments attempts. Missing Vault values or HTTP enqueue errors are warnings only.
3. A single Edge Function endpoint, or a backwards-compatible event-specific endpoint behind the same private dispatcher, validates the shared secret with constant-time comparison and validates UUIDs/event type. It loads current request data with the service role rather than trusting webhook payload fields.
4. The message builder selects a constant subject/body template by event type. A session-request email includes the requester’s current Auth display name, email, requested Brussels date/time, and a link to the tutor’s request view. It must not include another tutee’s data, arbitrary URLs, or user-controlled subject text. User text is HTML-escaped and line-broken safely.
5. Resend receives a stable per-event `Idempotency-Key` (for example `tutor-notification-<event-id>`), the fixed `onboarding@resend.dev` sender, and the single `TUTOR_EMAIL` recipient. No `reply-to` is taken from the requester.
6. After a successful provider response, the function marks that event sent using the service role. Lost responses are safe: an already-sent event returns success, and a later retry is harmless because of the provider idempotency key.
7. `pg_cron` retries only unsent events below the attempt limit and inside the existing age window. After the limit, the request remains visible in the tutor UI and the failed delivery is an operational concern, not a product-data failure.

The existing `notify-access-request` pure logic tests remain. New pure tests cover event validation, session-request message escaping, constant recipient enforcement, idempotency keys, and the no-PII/no-secret logging rule. The function remains excluded from the app TypeScript/ESLint program and uses its Deno-specific checks separately.

### Authorization, privacy, and cost

- The browser cannot insert/update outbox rows or call the dispatcher.
- The service role is used only inside the Edge Function and is never bundled or logged.
- The payload and logs contain ids and status codes, not names, emails, notes, or time ranges. The Edge Function loads current data only after authenticating the webhook.
- Only the tutor receives mail. There is intentionally no tutee email notification path; the app is the source of status for the tutee and Resend sandbox delivery is limited to the tutor.
- Pending-request caps and bounded retries keep the free Resend tier and Supabase free-tier workload acceptable. Request creation remains available if Resend, `pg_net`, Vault, or the Edge Function is unavailable.

## Alternatives rejected

- **Client-side email invocation:** an anon-key holder could spam the tutor, and a closing tab could lose the notification.
- **A second copy of the access implementation:** duplicates retry, secret, escaping, and idempotency logic and will drift.
- **Synchronous database HTTP as part of the request RPC:** increases latency and could make a provider outage reject a valid request.
- **Emailing tutees:** out of scope and incompatible with the current Resend sandbox/recipient decision; tutees can refresh their in-app state.

## Consequences

- Access and session notifications share one operational model and bounded retry policy.
- A migration and compatibility strategy are required because access-request notifications may already exist in production; deployment must preserve queued events.
- The Edge Function has two typed message paths and therefore needs event-specific unit tests, especially for current-data loading and HTML escaping.
- Notification failure is visible only operationally; the tutor UI remains the authoritative request list and must not claim that an email was delivered.
- Changing provider, sender, or recipient remains a backend-only change and never affects the public bundle.