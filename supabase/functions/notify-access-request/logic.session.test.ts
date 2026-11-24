import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSessionEmail, handleRequest, type NotifyConfig } from './logic';

const CONFIG: NotifyConfig = {
  supabaseUrl: 'https://project.example.test',
  serviceRoleKey: 'service-key',
  webhookSecret: 'hook-secret',
  resendApiKey: 'resend-key',
  tutorEmail: 'tutor@example.test',
};
const EVENT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function call(body: unknown) {
  return handleRequest(
    new Request('https://fn.example.test/', {
      method: 'POST',
      headers: { 'x-webhook-secret': 'hook-secret' },
      body: JSON.stringify(body),
    }),
    CONFIG,
  );
}

function stubFetch(event: unknown = [{ id: EVENT, user_id: USER, sent_at: null }]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      if (url.includes('tutor_notification_outbox') && init?.method === 'PATCH')
        return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('tutor_notification_outbox')) return Promise.resolve(json(event));
      if (url.includes('session_requests'))
        return Promise.resolve(
          json([
            {
              starts_at: '2026-12-01T13:00:00Z',
              ends_at: '2026-12-01T14:30:00Z',
              status: 'pending',
            },
          ]),
        );
      if (url.includes('/auth/v1/admin/users/'))
        return Promise.resolve(
          json({ email: 'tutee@example.test', user_metadata: { full_name: 'Sam <Tutee>' } }),
        );
      return Promise.resolve(json({ id: 'mail-1' }));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SESSION = { event_id: EVENT, user_id: USER, event_type: 'session-requested' };

describe('notify-access-request: session-requested events', () => {
  it('loads current data server-side and sends one tutor-only, escaped e-mail', async () => {
    const calls = stubFetch();
    expect((await call(SESSION)).status).toBe(200);
    expect(calls.some((c) => c.url.includes('access_request_notifications'))).toBe(false);
    expect(calls[0]?.url).toContain(`tutor_notification_outbox?id=eq.${EVENT}`);
    const mail = calls.filter((c) => c.url.includes('resend.com'));
    expect(mail).toHaveLength(1);
    expect(mail[0]?.init?.headers).toMatchObject({ 'idempotency-key': `session-request-${EVENT}` });
    const sent = JSON.parse(mail[0]?.init?.body as string) as Record<string, unknown>;
    expect(sent['to']).toEqual(['tutor@example.test']);
    expect(sent['subject']).toBe('New tutoring session request');
    expect(String(sent['text'])).toContain('14:00-15:30 Brussels time');
    expect(String(sent['text'])).toContain('#/session-requests');
    expect(String(sent['html'])).toContain('Sam &lt;Tutee&gt;');
    expect(JSON.stringify(sent)).not.toContain('tutee@example.test');
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toContain(`tutor_notification_outbox?id=eq.${EVENT}`);
  });

  it('does not trust range or recipient data in the webhook body', async () => {
    const calls = stubFetch();
    await call({ ...SESSION, starts_at: '2000-01-01T00:00:00Z', to: 'evil@example.test' });
    const mail = calls.find((c) => c.url.includes('resend.com'));
    const sent = JSON.parse(mail?.init?.body as string) as Record<string, unknown>;
    expect(sent['to']).toEqual(['tutor@example.test']);
    expect(String(sent['text'])).not.toContain('2000');
  });

  it('is safe for unknown, already-sent and foreign-user events', async () => {
    let calls = stubFetch([]);
    expect((await call(SESSION)).status).toBe(200);
    expect(calls.some((c) => c.url.includes('resend.com'))).toBe(false);
    calls = stubFetch([{ id: EVENT, user_id: USER, sent_at: '2026-01-01T00:00:00Z' }]);
    expect((await call(SESSION)).status).toBe(200);
    expect(calls.some((c) => c.url.includes('resend.com'))).toBe(false);
    stubFetch([{ id: EVENT, user_id: EVENT, sent_at: null }]);
    expect((await call(SESSION)).status).toBe(400);
  });

  it('answers 502 and leaves the outbox row unsent when the provider fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls = stubFetch();
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('resend.com')) return Promise.resolve(json({}, 500));
      return original?.(input, init) ?? Promise.resolve(json({}));
    });
    expect((await call(SESSION)).status).toBe(502);
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
  });

  it('keeps access events on the access outbox and ignores unknown event types', async () => {
    const calls = stubFetch();
    await call({ event_id: EVENT, user_id: USER, event_type: 'something-else' });
    expect(calls[0]?.url).toContain('access_request_notifications');
  });
});

describe('buildSessionEmail', () => {
  it('formats Brussels time on both sides of the DST change and never uses newlines in names', () => {
    expect(buildSessionEmail('A', '2027-03-20T07:00:00Z', '2027-03-20T08:00:00Z').text).toContain(
      '08:00-09:00',
    );
    expect(buildSessionEmail('A', '2027-03-30T06:00:00Z', '2027-03-30T07:00:00Z').text).toContain(
      '08:00-09:00',
    );
    expect(
      buildSessionEmail('Sam\nEvil', '2027-03-20T07:00:00Z', '2027-03-20T08:00:00Z').text,
    ).toContain('Sam Evil');
    expect(buildSessionEmail('', '2027-03-20T07:00:00Z', '2027-03-20T08:00:00Z').text).toContain(
      'Someone',
    );
  });
});
