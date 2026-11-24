/**
 * E-mails the tutor about a new access request (ADR 0007).
 *
 * Free of Deno APIs so Vitest can run it with a mocked `fetch`; `index.ts` only reads the
 * environment and calls `handleRequest`. Secrets and personal data are never logged.
 */

export interface NotifyConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  webhookSecret: string;
  resendApiKey: string;
  tutorEmail: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENDER = 'Tutoring <onboarding@resend.dev>';
const REQUESTS_URL = 'https://bjornpijpops.github.io/tutoring/#/access-requests';

interface EventRow {
  id: string;
  user_id: string;
  sent_at: string | null;
}

interface RequestRow {
  message: string;
}

interface AuthUser {
  email?: string;
  user_metadata?: { full_name?: unknown; name?: unknown };
}

function respond(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Compares without leaking where the first difference is. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

export function buildEmail(name: string, email: string, message: string) {
  const who = oneLine(name) || 'Someone';
  const text = [
    `${who} (${email}) asked for access to your availability.`,
    '',
    message === '' ? 'No message.' : `Message:\n${message}`,
    '',
    `Decide here: ${REQUESTS_URL}`,
  ].join('\n');
  const body =
    message === '' ? 'No message.' : `Message:<br>${escapeHtml(message).replaceAll('\n', '<br>')}`;
  const html =
    `<p>${escapeHtml(who)} (${escapeHtml(email)}) asked for access to your availability.</p>` +
    `<p>${body}</p>` +
    `<p><a href="${REQUESTS_URL}">Decide on the request</a></p>`;
  return { subject: 'New access request', text, html };
}

async function readJson<T>(response: Pick<Response, 'json'>): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Handles one webhook call from the database. */
export async function handleRequest(request: Request, config: NotifyConfig): Promise<Response> {
  if (request.method !== 'POST') return respond(405);
  const provided = request.headers.get('x-webhook-secret') ?? '';
  if (config.webhookSecret === '' || !safeEqual(provided, config.webhookSecret)) {
    return respond(401);
  }

  const payload = await readJson<{ event_id?: unknown; user_id?: unknown }>(request);
  const eventId = payload?.event_id;
  const userId = payload?.user_id;
  if (typeof eventId !== 'string' || typeof userId !== 'string') return respond(400);
  if (!UUID.test(eventId) || !UUID.test(userId)) return respond(400);

  const rest = {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
  };
  const base = config.supabaseUrl.replace(/\/$/, '');

  const eventResponse = await fetch(
    `${base}/rest/v1/access_request_notifications?id=eq.${eventId}&select=id,user_id,sent_at`,
    { headers: rest },
  );
  if (!eventResponse.ok) return respond(502);
  const events = (await readJson<EventRow[]>(eventResponse)) ?? [];
  const event = events[0];
  // Missing or already sent: nothing to do, and a retry must not fail.
  if (!event) return respond(200, { status: 'unknown_event' });
  if (event.user_id !== userId) return respond(400);
  if (event.sent_at !== null) return respond(200, { status: 'already_sent' });

  const [requestResponse, userResponse] = await Promise.all([
    fetch(`${base}/rest/v1/access_requests?user_id=eq.${userId}&select=message`, {
      headers: rest,
    }),
    fetch(`${base}/auth/v1/admin/users/${userId}`, { headers: rest }),
  ]);
  if (!requestResponse.ok || !userResponse.ok) return respond(502);
  const row = ((await readJson<RequestRow[]>(requestResponse)) ?? [])[0];
  const user = await readJson<AuthUser>(userResponse);
  if (!row || !user?.email) return respond(502);

  const meta = user.user_metadata;
  const rawName = meta?.full_name ?? meta?.name;
  const name = typeof rawName === 'string' ? rawName : '';
  const mail = buildEmail(name, user.email, row.message);

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      'content-type': 'application/json',
      'idempotency-key': `access-request-${eventId}`,
    },
    body: JSON.stringify({ from: SENDER, to: [config.tutorEmail], ...mail }),
  });
  if (!sent.ok) {
    console.error(`notify-access-request: event ${eventId} provider status ${String(sent.status)}`);
    return respond(502);
  }

  const marked = await fetch(`${base}/rest/v1/access_request_notifications?id=eq.${eventId}`, {
    method: 'PATCH',
    headers: { ...rest, 'content-type': 'application/json' },
    body: JSON.stringify({ sent_at: new Date().toISOString() }),
  });
  if (!marked.ok) {
    console.error(`notify-access-request: event ${eventId} sent but not marked`);
    return respond(502);
  }
  console.log(`notify-access-request: event ${eventId} sent`);
  return respond(200, { status: 'sent' });
}
