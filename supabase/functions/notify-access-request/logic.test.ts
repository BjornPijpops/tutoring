import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEmail, escapeHtml, handleRequest, safeEqual, type NotifyConfig } from './logic';

const CONFIG: NotifyConfig = {
  supabaseUrl: 'https://project.example.test',
  serviceRoleKey: 'service-key',
  webhookSecret: 'hook-secret',
  resendApiKey: 'resend-key',
  tutorEmail: 'tutor@example.test',
};
const EVENT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function call(
  body: unknown,
  headers: Record<string, string> = { 'x-webhook-secret': 'hook-secret' },
  method = 'POST',
) {
  return handleRequest(
    new Request('https://fn.example.test/', {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    CONFIG,
  );
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function stubFetch(overrides: { event?: unknown; resend?: Response } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.includes('access_request_notifications') && init?.method === 'PATCH') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.includes('access_request_notifications')) {
      return Promise.resolve(
        json(overrides.event ?? [{ id: EVENT, user_id: USER, sent_at: null }]),
      );
    }
    if (url.includes('access_requests')) return Promise.resolve(json([{ message: 'Hi <b>' }]));
    if (url.includes('/auth/v1/admin/users/')) {
      return Promise.resolve(
        json({ email: 'asker@example.test', user_metadata: { full_name: 'Sam <Asker>' } }),
      );
    }
    return Promise.resolve(overrides.resend ?? json({ id: 'mail-1' }));
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('notify-access-request', () => {
  it('rejects other methods, wrong or missing secrets, and bad payloads', async () => {
    const calls = stubFetch();
    expect((await call({}, {}, 'GET')).status).toBe(405);
    expect((await call({ event_id: EVENT, user_id: USER }, {})).status).toBe(401);
    expect(
      (await call({ event_id: EVENT, user_id: USER }, { 'x-webhook-secret': 'nope' })).status,
    ).toBe(401);
    expect((await call({ event_id: 'x', user_id: USER })).status).toBe(400);
    expect((await call({ event_id: EVENT })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('sends one escaped e-mail with an idempotency key and marks the event', async () => {
    const calls = stubFetch();
    const response = await call({ event_id: EVENT, user_id: USER });
    expect(response.status).toBe(200);
    const mail = calls.find((c) => c.url.includes('resend.com'));
    expect(mail?.init?.headers).toMatchObject({ 'idempotency-key': `access-request-${EVENT}` });
    const sent = JSON.parse(mail?.init?.body as string) as Record<string, unknown>;
    expect(sent['to']).toEqual(['tutor@example.test']);
    expect(sent['subject']).toBe('New access request');
    expect(sent).not.toHaveProperty('reply_to');
    expect(String(sent['html'])).toContain('Sam &lt;Asker&gt;');
    expect(String(sent['html'])).not.toContain('<b>');
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true);
  });

  it('succeeds without sending when the event is unknown or already sent', async () => {
    let calls = stubFetch({ event: [] });
    expect((await call({ event_id: EVENT, user_id: USER })).status).toBe(200);
    expect(calls.some((c) => c.url.includes('resend.com'))).toBe(false);
    calls = stubFetch({ event: [{ id: EVENT, user_id: USER, sent_at: '2026-01-01T00:00:00Z' }] });
    expect((await call({ event_id: EVENT, user_id: USER })).status).toBe(200);
    expect(calls.some((c) => c.url.includes('resend.com'))).toBe(false);
  });

  it('rejects an event that belongs to another user', async () => {
    stubFetch({ event: [{ id: EVENT, user_id: EVENT, sent_at: null }] });
    expect((await call({ event_id: EVENT, user_id: USER })).status).toBe(400);
  });

  it('answers 502 and leaves the event unsent when the provider fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls = stubFetch({ resend: json({ message: 'no' }, 500) });
    expect((await call({ event_id: EVENT, user_id: USER })).status).toBe(502);
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('asker@example.test');
    expect(logged).not.toContain('resend-key');
  });
});

describe('helpers', () => {
  it('compares secrets', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('escapes HTML and keeps the name on one line', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(buildEmail('Sam\nEvil', 'a@example.test', '').text.split('\n')[0]).toContain('Sam Evil');
  });
});

describe('notify-access-request: hardening', () => {
  it('rejects every call when no webhook secret is configured, even with an empty header', async () => {
    const calls = stubFetch();
    const response = await handleRequest(
      new Request('https://fn.example.test/', {
        method: 'POST',
        headers: { 'x-webhook-secret': '' },
        body: JSON.stringify({ event_id: EVENT, user_id: USER }),
      }),
      { ...CONFIG, webhookSecret: '' },
    );
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('answers 400 for a body that is not JSON', async () => {
    stubFetch();
    const response = await handleRequest(
      new Request('https://fn.example.test/', {
        method: 'POST',
        headers: { 'x-webhook-secret': 'hook-secret' },
        body: 'not json',
      }),
      CONFIG,
    );
    expect(response.status).toBe(400);
  });

  it('answers 502 so the database retries when the sent event cannot be marked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls = stubFetch();
    const original = vi.mocked(fetch);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? Promise.resolve(new Response(null, { status: 500 }))
        : original(input, init),
    );
    expect((await call({ event_id: EVENT, user_id: USER })).status).toBe(502);
    expect(calls.some((c) => c.url.includes('resend.com'))).toBe(true);
  });

  it('logs no personal data or secrets on success', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    stubFetch();
    expect((await call({ event_id: EVENT, user_id: USER })).status).toBe(200);
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of ['asker@example.test', 'tutor@example.test', 'Sam', 'hook-secret']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('keeps CR/LF in name and message out of the subject, recipients and header lines', () => {
    const mail = buildEmail('Eve\r\nBcc: x@example.test', 'e@example.test', 'line1\r\nline2');
    expect(mail.subject).toBe('New access request');
    expect(mail.text.split('\n')[0]).not.toMatch(/[\r]/);
    expect(mail.text.split('\n')[0]).toContain('Eve Bcc: x@example.test');
    expect(mail.html).not.toContain('<script');
  });
});
