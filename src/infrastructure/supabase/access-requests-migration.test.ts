import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import calendarMigration from '../../../supabase/migrations/20261124000000_calendar.sql?raw';
import accessMigration from '../../../supabase/migrations/20261125000000_access_requests.sql?raw';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const TUTEE_ID = '00000000-0000-0000-0000-0000000000b2';
const OTHER_ID = '00000000-0000-0000-0000-0000000000c3';
const UNKNOWN_ID = '00000000-0000-0000-0000-0000000000d4';

// Minimal stand-in for the parts of Supabase the migrations rely on.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  create schema net;
  create table net.calls (url text, headers jsonb, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint
  language plpgsql as $$
  begin
    if current_setting('test.net_fails', true) = 'on' then raise exception 'boom'; end if;
    insert into net.calls values (url, headers, body);
    return 1;
  end $$;
  create schema cron;
  create table cron.jobs (name text, schedule text, command text);
  create function cron.schedule(name text, schedule text, command text) returns bigint
  language sql as $$ insert into cron.jobs values (name, schedule, command) returning 1::bigint $$;
`;

// PGlite has none of these extensions; the stub schemas above replace pg_net and pg_cron.
const withoutExtensions = (sql: string) => sql.replace(/create extension[^;]*;/g, '');

let db: PGlite;

async function asRole(role: 'anon' | 'authenticated', userId?: string) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`,
  );
  await db.exec(`set role ${role};`);
}

const requestAccess = (message = 'hi') =>
  db.query<{ status: string; request_count: number }>(
    `select * from public.request_access('${message}')`,
  );
const decide = (userId: string, decision: string) =>
  db.query<{ status: string; next_request_at: Date | null }>(
    `select * from public.decide_access_request('${userId}', '${decision}')`,
  );
const count = async (table: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0]?.n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(calendarMigration);
  await db.exec(withoutExtensions(accessMigration));
  await db.exec(`
    insert into auth.users values
      ('${ADMIN_ID}', 'admin@example.test', now(), '{"full_name": "Tutor"}'),
      ('${TUTEE_ID}', 'tutee@example.test', now(), '{"full_name": "Alex Example"}'),
      ('${OTHER_ID}', 'other@example.test', now(), '{}');
    insert into public.admins (email) values ('admin@example.test');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    reset role;
    set test.net_fails = 'off';
    delete from public.access_requests;
    delete from net.calls;
    delete from vault.decrypted_secrets;
  `);
});

describe('access requests migration: privileges', () => {
  it('denies anonymous callers everything', async () => {
    await asRole('anon');
    await expect(db.query('select * from public.access_requests')).rejects.toThrow(
      /permission denied/,
    );
    await expect(requestAccess()).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from public.get_my_access()')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query('select public.is_approved_tutee()')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('has no client write grants and keeps the outbox and private schema closed', async () => {
    await asRole('authenticated', TUTEE_ID);
    await requestAccess();
    await expect(db.query(`update public.access_requests set status = 'approved'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(`delete from public.access_requests`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`insert into public.access_requests (user_id) values ('${OTHER_ID}')`),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from public.access_request_notifications')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query('select private.retry_access_notifications()')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('lets a user read only the own row and the admin read all', async () => {
    await asRole('authenticated', TUTEE_ID);
    await requestAccess();
    await asRole('authenticated', OTHER_ID);
    await requestAccess();
    expect((await db.query('select * from public.access_requests')).rows).toHaveLength(1);
    await asRole('authenticated', ADMIN_ID);
    expect((await db.query('select * from public.access_requests')).rows).toHaveLength(2);
  });

  it('refuses tutor RPCs to tutees', async () => {
    await asRole('authenticated', TUTEE_ID);
    await expect(decide(TUTEE_ID, 'approved')).rejects.toThrow(/admin required/);
    await expect(db.query('select * from public.list_access_requests()')).rejects.toThrow(
      /admin required/,
    );
    await expect(
      db.query(`select * from public.allow_access_request_again('${TUTEE_ID}')`),
    ).rejects.toThrow(/admin required/);
  });

  it('refuses calls without a user id', async () => {
    await asRole('authenticated');
    await expect(requestAccess()).rejects.toThrow(/authentication required/);
    await expect(decide(TUTEE_ID, 'approved')).rejects.toThrow(/authentication required/);
  });

  it('does not let admins request access', async () => {
    await asRole('authenticated', ADMIN_ID);
    await expect(requestAccess()).rejects.toThrow(/admins cannot request access/);
  });
});

describe('access requests migration: constraints', () => {
  it('rejects inconsistent rows, long messages and bad statuses', async () => {
    const insert = (columns: string, values: string) =>
      db.query(
        `insert into public.access_requests (user_id, ${columns}) values ('${TUTEE_ID}', ${values})`,
      );
    await expect(insert('status', `'approved'`)).rejects.toThrow(/decision_consistency/);
    await expect(insert('message', `repeat('x', 501)`)).rejects.toThrow(/message_length/);
    await expect(insert('status, decided_at', `'other', now()`)).rejects.toThrow(
      /access_requests_status/,
    );
    await expect(insert('request_count', '0')).rejects.toThrow(/request_count/);
  });

  it('keeps one row per user', async () => {
    await db.exec(`insert into public.access_requests (user_id) values ('${TUTEE_ID}')`);
    await expect(
      db.query(`insert into public.access_requests (user_id) values ('${TUTEE_ID}')`),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe('access requests migration: request_access', () => {
  beforeEach(async () => {
    await asRole('authenticated', TUTEE_ID);
  });

  it('creates a pending row and one outbox event, idempotently while pending', async () => {
    const first = await requestAccess('hello');
    expect(first.rows[0]).toMatchObject({ status: 'pending', request_count: 1 });
    await requestAccess('again');
    await db.exec('reset role');
    expect(await count('access_requests')).toBe(1);
    expect(await count('access_request_notifications')).toBe(1);
    const row = await db.query<{ message: string }>('select message from public.access_requests');
    expect(row.rows[0]?.message).toBe('hello');
  });

  it('trims the message and rejects one over 500 characters', async () => {
    await requestAccess('  padded  ');
    await db.exec('reset role');
    const row = await db.query<{ message: string }>('select message from public.access_requests');
    expect(row.rows[0]?.message).toBe('padded');
    await db.exec(`delete from public.access_requests`);
    await asRole('authenticated', TUTEE_ID);
    await expect(requestAccess('x'.repeat(501))).rejects.toThrow(/message too long/);
    expect((await requestAccess('x'.repeat(500))).rows).toHaveLength(1);
  });

  it('does not create an event for an approved user', async () => {
    await requestAccess();
    await asRole('authenticated', ADMIN_ID);
    await decide(TUTEE_ID, 'approved');
    await asRole('authenticated', TUTEE_ID);
    expect((await requestAccess()).rows[0]?.status).toBe('approved');
    await db.exec('reset role');
    expect(await count('access_request_notifications')).toBe(1);
  });

  it('closes new requests at 50 pending but still serves existing users', async () => {
    await db.exec('reset role');
    await db.exec(`
      insert into auth.users (id, email)
        select gen_random_uuid(), 'u' || g || '@example.test' from generate_series(1, 50) g;
      insert into public.access_requests (user_id)
        select id from auth.users where email like 'u%@example.test';
    `);
    await asRole('authenticated', TUTEE_ID);
    await expect(requestAccess()).rejects.toThrow(/temporarily closed/);
    await db.exec(`reset role; delete from public.access_requests where user_id in (
      select user_id from public.access_requests limit 1)`);
    await asRole('authenticated', TUTEE_ID);
    expect((await requestAccess()).rows).toHaveLength(1);
    await db.exec(`reset role; delete from auth.users where email like 'u%@example.test'`);
  });
});

describe('access requests migration: decisions and cooldown', () => {
  beforeEach(async () => {
    await asRole('authenticated', TUTEE_ID);
    await requestAccess();
    await asRole('authenticated', ADMIN_ID);
  });

  it('approves, then revokes with an eight hour cooldown', async () => {
    const approved = await decide(TUTEE_ID, 'approved');
    expect(approved.rows[0]).toMatchObject({ status: 'approved', next_request_at: null });
    const denied = await decide(TUTEE_ID, 'denied');
    const row = await db.query<{ hours: number }>(
      `select extract(epoch from (next_request_at - decided_at)) / 3600 as hours
       from public.access_requests`,
    );
    expect(denied.rows[0]?.status).toBe('denied');
    expect(Number(row.rows[0]?.hours)).toBe(8);
  });

  it('lets the tutor approve a denied request and clears the cooldown', async () => {
    await decide(TUTEE_ID, 'denied');
    expect((await decide(TUTEE_ID, 'approved')).rows[0]).toMatchObject({
      status: 'approved',
      next_request_at: null,
    });
  });

  it('rejects invalid decisions and unknown users', async () => {
    await expect(decide(TUTEE_ID, 'pending')).rejects.toThrow(/invalid decision/);
    await expect(decide(UNKNOWN_ID, 'approved')).rejects.toThrow(/not found/);
  });

  it('blocks a re-request during the cooldown and allows it at the exact boundary', async () => {
    await decide(TUTEE_ID, 'denied');
    await asRole('authenticated', TUTEE_ID);
    await expect(requestAccess()).rejects.toThrow(/cooldown active/);

    await db.exec(
      `reset role; update public.access_requests set next_request_at = now() + interval '1 second'`,
    );
    await asRole('authenticated', TUTEE_ID);
    await expect(requestAccess()).rejects.toThrow(/cooldown active/);

    await db.exec(`reset role; update public.access_requests set next_request_at = now()`);
    await asRole('authenticated', TUTEE_ID);
    expect((await requestAccess('retry')).rows[0]).toMatchObject({
      status: 'pending',
      request_count: 2,
    });
    await db.exec('reset role');
    expect(await count('access_request_notifications')).toBe(2);
  });

  it('allows asking again at once only for denied requests', async () => {
    await expect(
      db.query(`select * from public.allow_access_request_again('${TUTEE_ID}')`),
    ).rejects.toThrow(/denied access request not found/);
    await decide(TUTEE_ID, 'denied');
    await db.query(`select * from public.allow_access_request_again('${TUTEE_ID}')`);
    await asRole('authenticated', TUTEE_ID);
    expect((await requestAccess()).rows[0]?.status).toBe('pending');
  });
});

describe('access requests migration: reading state', () => {
  it('get_my_access reports admin, none, pending, approved and denied', async () => {
    const mine = async (userId: string) => {
      await asRole('authenticated', userId);
      return (await db.query('select * from public.get_my_access()')).rows;
    };
    expect(await mine(ADMIN_ID)).toEqual([{ is_admin: true, status: null }]);
    expect(await mine(TUTEE_ID)).toEqual([{ is_admin: false, status: null }]);
    await requestAccess();
    expect(await mine(TUTEE_ID)).toEqual([{ is_admin: false, status: 'pending' }]);
    await asRole('authenticated', ADMIN_ID);
    await decide(TUTEE_ID, 'approved');
    expect(await mine(TUTEE_ID)).toEqual([{ is_admin: false, status: 'approved' }]);
    await asRole('authenticated', ADMIN_ID);
    await decide(TUTEE_ID, 'denied');
    expect(await mine(TUTEE_ID)).toEqual([{ is_admin: false, status: 'denied' }]);
  });

  it('is_approved_tutee follows approval and revocation, which also gates the calendar', async () => {
    const blocked = `select * from public.get_blocked_intervals('2026-01-05T00:00:00Z', '2026-01-08T00:00:00Z')`;
    await asRole('authenticated', TUTEE_ID);
    await requestAccess();
    await expect(db.query(blocked)).rejects.toThrow(/calendar access denied/);

    await asRole('authenticated', ADMIN_ID);
    await decide(TUTEE_ID, 'approved');
    await asRole('authenticated', TUTEE_ID);
    expect((await db.query('select public.is_approved_tutee() as ok')).rows).toEqual([
      { ok: true },
    ]);
    expect((await db.query(blocked)).fields.map((field) => field.name)).toEqual([
      'starts_at',
      'ends_at',
    ]);

    await asRole('authenticated', ADMIN_ID);
    await decide(TUTEE_ID, 'denied');
    await asRole('authenticated', TUTEE_ID);
    await expect(db.query(blocked)).rejects.toMatchObject({ code: '42501' });
  });

  it('lists requests for the admin: pending first, filtered, with a display name fallback', async () => {
    await asRole('authenticated', TUTEE_ID);
    await requestAccess('mine');
    await asRole('authenticated', OTHER_ID);
    await requestAccess();
    await asRole('authenticated', ADMIN_ID);
    await decide(TUTEE_ID, 'approved');

    const all = await db.query<{ display_name: string; status: string }>(
      'select * from public.list_access_requests()',
    );
    expect(all.rows.map((row) => [row.display_name, row.status])).toEqual([
      ['other', 'pending'],
      ['Alex Example', 'approved'],
    ]);
    const approved = await db.query(`select * from public.list_access_requests('approved')`);
    expect(approved.rows).toHaveLength(1);
    await expect(db.query(`select * from public.list_access_requests('bogus')`)).rejects.toThrow(
      /invalid status/,
    );
  });

  it('caps the admin list at 200 rows', async () => {
    await db.exec('reset role');
    await db.exec(`
      insert into auth.users (id, email)
        select gen_random_uuid(), 'bulk' || g || '@example.test' from generate_series(1, 210) g;
      insert into public.access_requests (user_id, status, decided_at)
        select id, 'approved', now() from auth.users where email like 'bulk%@example.test';
    `);
    await asRole('authenticated', ADMIN_ID);
    expect((await db.query('select * from public.list_access_requests()')).rows).toHaveLength(200);
    await db.exec(`reset role; delete from auth.users where email like 'bulk%@example.test'`);
  });
});

describe('access requests migration: notification outbox', () => {
  const secrets = `insert into vault.decrypted_secrets values
    ('access_webhook_secret', 'secret-value'), ('access_webhook_url', 'https://x.test/fn')`;

  it('posts ids only, with the secret header, when Vault is filled', async () => {
    await db.exec(secrets);
    await asRole('authenticated', TUTEE_ID);
    await requestAccess('private message');
    await db.exec('reset role');
    const calls = await db.query<{ url: string; headers: Record<string, string>; body: unknown }>(
      'select * from net.calls',
    );
    expect(calls.rows).toHaveLength(1);
    const call = calls.rows[0];
    expect(call?.url).toBe('https://x.test/fn');
    expect(call?.headers['x-webhook-secret']).toBe('secret-value');
    expect(Object.keys(call?.body as object).sort()).toEqual(['event_id', 'user_id']);
    const outbox = await db.query<Record<string, unknown>>(
      'select * from public.access_request_notifications',
    );
    expect(Object.keys(outbox.rows[0] ?? {}).sort()).toEqual([
      'attempts',
      'created_at',
      'id',
      'requested_at',
      'sent_at',
      'user_id',
    ]);
    expect(outbox.rows[0]?.['attempts']).toBe(1);
  });

  it('still commits the request and event without Vault entries', async () => {
    await asRole('authenticated', TUTEE_ID);
    await requestAccess();
    await db.exec('reset role');
    expect(await count('access_requests')).toBe(1);
    expect(await count('access_request_notifications')).toBe(1);
    expect((await db.query('select * from net.calls')).rows).toHaveLength(0);
  });

  it('still commits the request when the HTTP call fails', async () => {
    await db.exec(secrets);
    await db.exec(`set test.net_fails = 'on'`);
    await asRole('authenticated', TUTEE_ID);
    await requestAccess();
    await db.exec('reset role');
    expect(await count('access_requests')).toBe(1);
    expect(await count('access_request_notifications')).toBe(1);
  });

  it('still commits the request when queueing itself fails', async () => {
    await db.exec('alter table public.access_request_notifications rename to broken_outbox');
    try {
      await asRole('authenticated', TUTEE_ID);
      await requestAccess();
      await db.exec('reset role');
      expect(await count('access_requests')).toBe(1);
    } finally {
      await db.exec(
        'reset role; alter table public.broken_outbox rename to access_request_notifications',
      );
    }
  });

  it('retries only unsent, recent events with fewer than five attempts', async () => {
    await db.exec(secrets);
    await db.exec(`
      insert into public.access_requests (user_id) values ('${TUTEE_ID}'), ('${OTHER_ID}');
      delete from public.access_request_notifications;
      delete from net.calls;
      insert into public.access_request_notifications (user_id, requested_at, sent_at, attempts, created_at) values
        ('${TUTEE_ID}', now(), null, 1, now()),
        ('${TUTEE_ID}', now(), now(), 1, now()),
        ('${TUTEE_ID}', now(), null, 5, now()),
        ('${OTHER_ID}', now(), null, 0, now() - interval '25 hours');
    `);
    await db.exec('select private.retry_access_notifications()');
    expect((await db.query('select * from net.calls')).rows).toHaveLength(1);
  });

  it('schedules the retry job under its own name', async () => {
    const jobs = await db.query<{ name: string; schedule: string }>('select * from cron.jobs');
    expect(jobs.rows).toEqual([
      expect.objectContaining({
        name: 'access-request-notification-retry',
        schedule: '*/10 * * * *',
      }),
    ]);
  });
});
