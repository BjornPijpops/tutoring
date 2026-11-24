import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import calendarMigration from '../../../supabase/migrations/20261124000000_calendar.sql?raw';
import accessMigration from '../../../supabase/migrations/20261125000000_access_requests.sql?raw';
import grantMigration from '../../../supabase/migrations/20261125000200_grant_service_role_notifications.sql?raw';
import sessionMigration from '../../../supabase/migrations/20261125000400_timeslot_requests.sql?raw';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const TUTEE_ID = '00000000-0000-0000-0000-0000000000b2';
const OTHER_ID = '00000000-0000-0000-0000-0000000000c3';
const STRANGER_ID = '00000000-0000-0000-0000-0000000000d4';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public to anon, authenticated, service_role;
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

const withoutExtensions = (sql: string) => sql.replace(/create extension[^;]*;/g, '');

let db: PGlite;

async function asRole(role: 'anon' | 'authenticated', userId?: string) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`,
  );
  await db.exec(`set role ${role};`);
}

/** Brussels wall-clock instant `days` from today, as a SQL expression. */
const at = (days: number, time: string) =>
  `((date_trunc('day', now() at time zone 'Europe/Brussels') + interval '${String(days)} days' + time '${time}') at time zone 'Europe/Brussels')`;
const slot = (days: number, start: string, end: string) => `${at(days, start)}, ${at(days, end)}`;
const create = (days: number, start: string, end: string) =>
  db.query<{ id: string; status: string }>(
    `select * from public.create_session_request(${slot(days, start, end)})`,
  );
const decide = (id: string, decision: string) =>
  db.query<{
    decide_session_request: { overlap_declined_count: number; request: { status: string } };
  }>(`select public.decide_session_request('${id}', '${decision}')`);
const scalar = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]?.n;
const statusOf = async (id: string) =>
  (
    await db.query<{ status: string }>(
      `select status from public.session_requests where id='${id}'`,
    )
  ).rows[0]?.status;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(calendarMigration);
  await db.exec(withoutExtensions(accessMigration));
  await db.exec(grantMigration);
  await db.exec(withoutExtensions(sessionMigration));
  await db.exec(`
    insert into auth.users values
      ('${ADMIN_ID}', 'admin@example.test', now(), '{"full_name": "Tutor"}'),
      ('${TUTEE_ID}', 'tutee@example.test', now(), '{"full_name": "Alex Example"}'),
      ('${OTHER_ID}', 'other@example.test', now(), '{"full_name": "Sam Other"}'),
      ('${STRANGER_ID}', 'stranger@example.test', now(), '{}');
    insert into public.admins (email) values ('admin@example.test');
    insert into public.access_requests (user_id, status, decided_at) values
      ('${TUTEE_ID}', 'approved', now()), ('${OTHER_ID}', 'approved', now());
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    reset role;
    set test.net_fails = 'off';
    delete from public.session_requests;
    delete from public.calendar_events;
    delete from net.calls;
    delete from vault.decrypted_secrets;
  `);
});

describe('timeslot requests migration: privileges', () => {
  it('has RLS, no client table grants, and pinned search_path on every definer function', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('session_requests','tutor_notification_outbox') order by relname`,
    );
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
    const grants = await db.query(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_name in ('session_requests','tutor_notification_outbox')
         and grantee in ('anon','authenticated','public')`,
    );
    expect(grants.rows).toEqual([]);
    const unpinned = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','private') and p.prosecdef
         and (p.proconfig is null or not 'search_path=""' = any(p.proconfig))`,
    );
    expect(unpinned.rows).toEqual([]);
  });

  it('lets only authenticated callers execute the RPCs and keeps private functions closed', async () => {
    const names = [
      'create_session_request',
      'list_my_session_requests',
      'list_session_requests_for_tutor',
      'decide_session_request',
      'cancel_session_request',
      'list_accepted_sessions_for_tutor',
    ];
    const rows = await db.query<{ proname: string; anon: boolean; authed: boolean; pub: boolean }>(
      `select proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              has_function_privilege('public', p.oid, 'execute') as pub
       from pg_proc p where proname = any($1::text[])`,
      [names],
    );
    expect(rows.rows).toHaveLength(names.length);
    for (const row of rows.rows)
      expect(row).toMatchObject({ anon: false, authed: true, pub: false });
    const closed = await db.query<{ authed: boolean }>(
      `select has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and proname like '%session%'`,
    );
    expect(closed.rows.length).toBeGreaterThan(0);
    expect(closed.rows.every((row) => !row.authed)).toBe(true);
  });

  it('gives service_role the same outbox access as the access-request outbox', async () => {
    const grants = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'service_role'
         and table_name in ('session_requests','tutor_notification_outbox')
       order by table_name, privilege_type`,
    );
    expect(grants.rows).toEqual([
      { table_name: 'session_requests', privilege_type: 'SELECT' },
      { table_name: 'tutor_notification_outbox', privilege_type: 'SELECT' },
      { table_name: 'tutor_notification_outbox', privilege_type: 'UPDATE' },
    ]);
  });

  it('denies anonymous, signed-out and unapproved callers', async () => {
    await asRole('anon');
    await expect(create(5, '10:00', '11:00')).rejects.toMatchObject({ code: '42501' });
    await asRole('authenticated');
    await expect(create(5, '10:00', '11:00')).rejects.toMatchObject({ code: '42501' });
    await asRole('authenticated', STRANGER_ID);
    await expect(create(5, '10:00', '11:00')).rejects.toMatchObject({ code: '42501' });
    await asRole('authenticated', TUTEE_ID);
    await expect(db.query('select * from public.session_requests')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query('select * from public.tutor_notification_outbox')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`insert into public.session_requests(user_id, starts_at, ends_at)
                values ('${TUTEE_ID}', now(), now() + interval '1 hour')`),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets only the tutor list pending requests with identity', async () => {
    await asRole('authenticated', TUTEE_ID);
    await create(5, '10:00', '11:00');
    await expect(
      db.query('select * from public.list_session_requests_for_tutor()'),
    ).rejects.toMatchObject({
      code: '42501',
    });
    await asRole('authenticated', ADMIN_ID);
    const rows = await db.query<{ requester_name: string; requester_email: string }>(
      'select * from public.list_session_requests_for_tutor()',
    );
    expect(rows.rows).toMatchObject([
      { requester_name: 'Alex Example', requester_email: 'tutee@example.test' },
    ]);
  });
});

describe('timeslot requests migration: creating requests', () => {
  it('creates a pending request for the caller only', async () => {
    await asRole('authenticated', TUTEE_ID);
    const made = await create(5, '10:00', '11:30');
    expect(made.rows[0]).toMatchObject({ status: 'pending' });
    await asRole('authenticated', OTHER_ID);
    const mine = await db.query(
      `select * from public.list_my_session_requests(now(), now() + interval '60 days')`,
    );
    expect(mine.rows).toEqual([]);
  });

  it.each([
    ['too short', 5, '10:00', '10:15', 'duration_too_short'],
    ['too long', 5, '10:00', '12:30', 'duration_too_long'],
    ['not on the 30-minute grid', 5, '10:15', '11:15', 'not_aligned'],
    ['crossing midnight', 5, '23:30', '24:00', 'not_aligned'],
    ['before opening', 5, '07:30', '08:30', 'outside_hours'],
    ['after closing', 5, '21:30', '22:30', 'outside_hours'],
    ['less than 24 hours ahead', 0, '20:00', '21:00', 'too_soon'],
    ['more than 30 days ahead', 31, '10:00', '11:00', 'too_far'],
    ['more than 30 calendar days ahead, even late in the day', 31, '08:00', '08:30', 'too_far'],
  ])('rejects a range that is %s', async (_name, days, start, end, message) => {
    await asRole('authenticated', TUTEE_ID);
    await expect(create(days, start, end)).rejects.toMatchObject({
      code: '22023',
      message: expect.stringContaining(message) as string,
    });
    await db.exec('reset role');
    expect(await scalar('select count(*)::int as n from public.session_requests')).toBe(0);
  });

  it('accepts the exact limits: 30 minutes, 2 hours, 08:00 and 22:00', async () => {
    await asRole('authenticated', TUTEE_ID);
    await create(5, '08:00', '08:30');
    await create(6, '20:00', '22:00');
    await create(30, '21:30', '22:00');
  });

  it('rejects the fourth pending request but not after an acceptance or cancellation', async () => {
    await asRole('authenticated', TUTEE_ID);
    const first = await create(5, '10:00', '11:00');
    await create(6, '10:00', '11:00');
    await create(7, '10:00', '11:00');
    await expect(create(8, '10:00', '11:00')).rejects.toMatchObject({ code: 'TR001' });
    await asRole('authenticated', ADMIN_ID);
    await decide(first.rows[0]?.id ?? '', 'accepted');
    await asRole('authenticated', TUTEE_ID);
    await create(8, '10:00', '11:00');
    await expect(create(9, '10:00', '11:00')).rejects.toMatchObject({ code: 'TR001' });
    await asRole('authenticated', OTHER_ID);
    await create(9, '10:00', '11:00');
  });

  it('rejects a range that overlaps a tutor block or an accepted session, but not adjacent ranges', async () => {
    await db.exec(`insert into public.calendar_events(starts_at, ends_at, source, title)
      values (${slot(5, '10:00', '11:00')}, 'manual', 'Dentist')`);
    await asRole('authenticated', TUTEE_ID);
    await expect(create(5, '10:30', '11:30')).rejects.toMatchObject({ code: 'TR002' });
    await create(5, '11:00', '12:00');
    await create(5, '09:00', '10:00');
    await asRole('authenticated', OTHER_ID);
    const taken = await create(6, '10:00', '11:00');
    await asRole('authenticated', ADMIN_ID);
    await decide(taken.rows[0]?.id ?? '', 'accepted');
    await asRole('authenticated', TUTEE_ID);
    await expect(create(6, '10:30', '11:30')).rejects.toMatchObject({ code: 'TR002' });
    await create(6, '11:00', '12:00');
  });

  it('serialises on the shared schedule advisory lock', async () => {
    await db.exec('begin');
    try {
      await db.exec(
        `set local role authenticated; select set_config('request.jwt.claim.sub', '${TUTEE_ID}', true);`,
      );
      await create(5, '10:00', '11:00');
      await db.exec('reset role');
      const locks = await db.query<{ n: number }>(
        `select count(*)::int as n from pg_locks where locktype = 'advisory' and granted`,
      );
      expect(locks.rows[0]?.n).toBe(1);
    } finally {
      await db.exec('rollback');
    }
  });
});

describe('timeslot requests migration: Brussels and DST rules', () => {
  const check = (start: string, end: string, now: string) =>
    db.query(
      `select private.validate_session_range('${start}'::timestamptz, '${end}'::timestamptz, '${now}'::timestamptz)`,
    );

  it('uses local wall-clock hours on both sides of a DST change', async () => {
    // Winter (UTC+1): 08:00-09:00 local is 07:00Z; summer (UTC+2): 06:00Z.
    await check('2027-03-20T07:00:00Z', '2027-03-20T08:00:00Z', '2027-03-01T12:00:00Z');
    await check('2027-03-30T06:00:00Z', '2027-03-30T07:00:00Z', '2027-03-01T12:00:00Z');
    await expect(
      check('2027-03-30T05:30:00Z', '2027-03-30T06:30:00Z', '2027-03-01T12:00:00Z'),
    ).rejects.toThrow(/outside_hours/);
    // 22:00 local closing in summer is 20:00Z.
    await check('2027-03-30T19:00:00Z', '2027-03-30T20:00:00Z', '2027-03-01T12:00:00Z');
    await expect(
      check('2027-03-30T19:30:00Z', '2027-03-30T20:30:00Z', '2027-03-01T12:00:00Z'),
    ).rejects.toThrow(/outside_hours/);
    // Autumn change, 2027-10-31.
    await check('2027-10-31T07:00:00Z', '2027-10-31T08:00:00Z', '2027-10-01T12:00:00Z');
  });

  it('applies the 30-day horizon as a local calendar-date check across the spring change', async () => {
    const now = '2027-03-01T12:00:00Z'; // 13:00 local on 1 March; day 30 is 31 March
    await check('2027-03-31T11:00:00Z', '2027-03-31T12:00:00Z', now);
    await check('2027-03-31T11:30:00Z', '2027-03-31T12:30:00Z', now);
    await check('2027-03-31T19:30:00Z', '2027-03-31T20:00:00Z', now); // 21:30 local
    await expect(check('2027-04-01T07:00:00Z', '2027-04-01T08:00:00Z', now)).rejects.toThrow(
      /too_far/,
    );
    // Late evening local (23:30) is still 1 March locally even though UTC is earlier.
    await check('2027-03-31T10:00:00Z', '2027-03-31T11:00:00Z', '2027-03-01T22:30:00Z');
    await expect(
      check('2027-04-01T07:00:00Z', '2027-04-01T08:00:00Z', '2027-03-01T22:30:00Z'),
    ).rejects.toThrow(/too_far/);
    // Autumn: from 1 October, day 30 is 31 October (the change day).
    await check('2027-10-31T09:00:00Z', '2027-10-31T10:00:00Z', '2027-10-01T12:00:00Z');
    await expect(
      check('2027-11-01T09:00:00Z', '2027-11-01T10:00:00Z', '2027-10-01T12:00:00Z'),
    ).rejects.toThrow(/too_far/);
  });

  it('rejects ranges whose elapsed and local durations disagree on the last Sundays of March and October', async () => {
    const spring = '2027-03-01T12:00:00Z';
    const autumn = '2027-10-01T12:00:00Z';
    // 2027-03-28: 01:30 CET -> 03:30 CEST is 2 local hours but 1 elapsed hour.
    await expect(check('2027-03-28T00:30:00Z', '2027-03-28T01:30:00Z', spring)).rejects.toThrow(
      /ambiguous_local_time/,
    );
    // 01:45 CET -> 04:15 CEST is 2.5 local hours but 1.5 elapsed hours.
    await expect(check('2027-03-28T00:45:00Z', '2027-03-28T02:15:00Z', spring)).rejects.toThrow(
      /ambiguous_local_time/,
    );
    // 2027-10-31: 02:30 CEST -> 02:30 CET is 0 local minutes but 1 elapsed hour.
    await expect(check('2027-10-31T00:30:00Z', '2027-10-31T01:30:00Z', autumn)).rejects.toThrow(
      /ambiguous_local_time/,
    );
    await expect(check('2027-10-31T00:00:00Z', '2027-10-31T02:00:00Z', autumn)).rejects.toThrow(
      /ambiguous_local_time/,
    );
    // Ranges away from the change are unaffected on the same days.
    await check('2027-03-28T08:00:00Z', '2027-03-28T10:00:00Z', spring);
    await check('2027-10-31T09:00:00Z', '2027-10-31T11:00:00Z', autumn);
  });

  it('judges duration and the 30-minute grid in local wall-clock time', async () => {
    const now = '2027-03-01T12:00:00Z';
    await check('2027-03-10T09:00:00Z', '2027-03-10T09:30:00Z', now);
    await expect(check('2027-03-10T09:00:00Z', '2027-03-10T09:15:00Z', now)).rejects.toThrow(
      /duration_too_short/,
    );
    await expect(check('2027-03-10T09:00:00Z', '2027-03-10T11:30:00Z', now)).rejects.toThrow(
      /duration_too_long/,
    );
    await expect(check('2027-03-10T09:15:00Z', '2027-03-10T10:15:00Z', now)).rejects.toThrow(
      /not_aligned/,
    );
  });

  it('applies the 24-hour notice to the exact instant', async () => {
    await check('2027-03-21T10:00:00Z', '2027-03-21T11:00:00Z', '2027-03-20T10:00:00Z');
    await expect(
      check('2027-03-21T09:30:00Z', '2027-03-21T10:30:00Z', '2027-03-20T10:00:00Z'),
    ).rejects.toThrow(/too_soon/);
  });
});

describe('timeslot requests migration: decisions', () => {
  it('lets only the tutor decide and validates the decision', async () => {
    await asRole('authenticated', TUTEE_ID);
    const made = await create(5, '10:00', '11:00');
    const id = made.rows[0]?.id ?? '';
    await expect(decide(id, 'accepted')).rejects.toMatchObject({ code: '42501' });
    await asRole('authenticated', ADMIN_ID);
    await expect(decide(id, 'cancelled')).rejects.toMatchObject({ code: '22023' });
    await expect(decide(id, 'pending')).rejects.toMatchObject({ code: '22023' });
    await db.exec('reset role');
    expect(await statusOf(id)).toBe('pending');
  });

  it('accepts one request and declines only overlapping pending requests, with the count', async () => {
    await asRole('authenticated', TUTEE_ID);
    const target = await create(5, '10:00', '11:00');
    const overlap = await create(5, '10:30', '11:30');
    const adjacent = await create(5, '11:00', '12:00');
    await asRole('authenticated', OTHER_ID);
    const overlapOther = await create(5, '09:30', '10:30');
    await asRole('authenticated', ADMIN_ID);
    const result = await decide(target.rows[0]?.id ?? '', 'accepted');
    expect(result.rows[0]?.decide_session_request).toMatchObject({
      overlap_declined_count: 2,
      request: { status: 'accepted' },
    });
    await db.exec('reset role');
    expect(await statusOf(overlap.rows[0]?.id ?? '')).toBe('declined');
    expect(await statusOf(overlapOther.rows[0]?.id ?? '')).toBe('declined');
    expect(await statusOf(adjacent.rows[0]?.id ?? '')).toBe('pending');
  });

  it('reports a count of zero when nothing overlaps and declines without side effects', async () => {
    await asRole('authenticated', TUTEE_ID);
    const first = await create(5, '10:00', '11:00');
    const second = await create(5, '10:30', '11:30');
    await asRole('authenticated', ADMIN_ID);
    const declined = await decide(first.rows[0]?.id ?? '', 'declined');
    expect(declined.rows[0]?.decide_session_request.overlap_declined_count).toBe(0);
    await db.exec('reset role');
    expect(await statusOf(second.rows[0]?.id ?? '')).toBe('pending');
  });

  it('keeps a stale or conflicting decision pending-safe', async () => {
    await asRole('authenticated', TUTEE_ID);
    const made = await create(5, '10:00', '11:00');
    const id = made.rows[0]?.id ?? '';
    await asRole('authenticated', ADMIN_ID);
    await decide(id, 'declined');
    await expect(decide(id, 'accepted')).rejects.toMatchObject({ code: 'TR003' });
    await expect(decide('00000000-0000-0000-0000-000000000999', 'accepted')).rejects.toMatchObject({
      code: 'TR003',
    });
    await asRole('authenticated', TUTEE_ID);
    const next = await create(6, '10:00', '11:00');
    await db.exec(`reset role; insert into public.calendar_events(starts_at, ends_at, source, title)
      values (${slot(6, '10:30', '11:00')}, 'manual', 'Late block')`);
    await asRole('authenticated', ADMIN_ID);
    await expect(decide(next.rows[0]?.id ?? '', 'accepted')).rejects.toMatchObject({
      code: 'TR002',
    });
    await db.exec('reset role');
    expect(await statusOf(next.rows[0]?.id ?? '')).toBe('pending');
  });

  it('enforces non-overlapping accepted sessions with the exclusion constraint', async () => {
    await db.exec(`insert into public.session_requests(user_id, starts_at, ends_at, status)
      values ('${TUTEE_ID}', ${slot(5, '10:00', '11:00')}, 'accepted')`);
    await expect(
      db.exec(`insert into public.session_requests(user_id, starts_at, ends_at, status)
        values ('${OTHER_ID}', ${slot(5, '10:30', '11:30')}, 'accepted')`),
    ).rejects.toMatchObject({ code: '23P01' });
    await db.exec(`insert into public.session_requests(user_id, starts_at, ends_at, status)
      values ('${OTHER_ID}', ${slot(5, '11:00', '12:00')}, 'accepted'),
             ('${OTHER_ID}', ${slot(5, '10:30', '11:30')}, 'pending')`);
  });

  it('never blocks the tutor: manual events, updates and bulk imports over an accepted session succeed', async () => {
    await db.exec(`insert into public.session_requests(user_id, starts_at, ends_at, status)
      values ('${TUTEE_ID}', ${slot(5, '10:00', '11:00')}, 'accepted')`);
    const triggers = await db.query(
      `select tgname from pg_trigger where tgrelid = 'public.calendar_events'::regclass
         and not tgisinternal and tgname like '%overlap%'`,
    );
    expect(triggers.rows).toEqual([]);
    await asRole('authenticated', ADMIN_ID);
    await db.exec(`insert into public.calendar_events(starts_at, ends_at, source)
      values (${slot(5, '10:30', '12:00')}, 'manual')`);
    await db.exec(`insert into public.calendar_events(starts_at, ends_at, source, external_id)
      values (${slot(5, '09:00', '10:30')}, 'ics', 'uid-1'),
             (${slot(5, '10:15', '10:45')}, 'ics', 'uid-2'),
             (${slot(5, '14:00', '15:00')}, 'ics', 'uid-3')`);
    await db.exec(`update public.calendar_events set starts_at = ${at(5, '10:15')}
      where source = 'manual'`);
    expect(await scalar('select count(*)::int as n from public.calendar_events')).toBe(4);
  });

  it('keeps the checks on the request side: a new request over the added event is rejected and accepting re-checks', async () => {
    await asRole('authenticated', TUTEE_ID);
    const pending = await create(5, '10:00', '11:00');
    await asRole('authenticated', ADMIN_ID);
    await db.exec(`insert into public.calendar_events(starts_at, ends_at, source)
      values (${slot(5, '10:30', '12:00')}, 'manual')`);
    await expect(decide(pending.rows[0]?.id ?? '', 'accepted')).rejects.toMatchObject({
      code: 'TR002',
    });
    await db.exec('reset role');
    expect(await statusOf(pending.rows[0]?.id ?? '')).toBe('pending');
    await asRole('authenticated', OTHER_ID);
    await expect(create(5, '11:00', '11:30')).rejects.toMatchObject({ code: 'TR002' });
  });

  it('lists accepted sessions for the tutor calendar only, without email or ids of users', async () => {
    await db.exec(`insert into public.session_requests(user_id, starts_at, ends_at, status)
      values ('${TUTEE_ID}', ${slot(5, '10:00', '11:00')}, 'accepted'),
             ('${OTHER_ID}', ${slot(5, '12:00', '13:00')}, 'pending'),
             ('${OTHER_ID}', ${slot(6, '12:00', '13:00')}, 'cancelled')`);
    const range = `${at(0, '00:00')}, ${at(30, '00:00')}`;
    await asRole('authenticated', TUTEE_ID);
    await expect(
      db.query(`select * from public.list_accepted_sessions_for_tutor(${range})`),
    ).rejects.toMatchObject({ code: '42501' });
    await asRole('anon');
    await expect(
      db.query(`select * from public.list_accepted_sessions_for_tutor(${range})`),
    ).rejects.toThrow(/permission denied/);
    await asRole('authenticated', ADMIN_ID);
    const rows = await db.query<Record<string, unknown>>(
      `select * from public.list_accepted_sessions_for_tutor(${range})`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ requester_name: 'Alex Example' });
    expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual([
      'ends_at',
      'id',
      'requester_name',
      'starts_at',
    ]);
  });
});

describe('timeslot requests migration: cancelling', () => {
  it('lets the owner cancel pending and accepted requests and keeps the history', async () => {
    await asRole('authenticated', TUTEE_ID);
    const pending = await create(5, '10:00', '11:00');
    const toAccept = await create(6, '10:00', '11:00');
    await asRole('authenticated', ADMIN_ID);
    await decide(toAccept.rows[0]?.id ?? '', 'accepted');
    await asRole('authenticated', TUTEE_ID);
    const cancelled = await db.query<{ status: string; cancelled_at: Date | null }>(
      `select * from public.cancel_session_request('${pending.rows[0]?.id ?? ''}')`,
    );
    expect(cancelled.rows[0]?.status).toBe('cancelled');
    expect(cancelled.rows[0]?.cancelled_at).not.toBeNull();
    await db.query(`select * from public.cancel_session_request('${toAccept.rows[0]?.id ?? ''}')`);
    const history = await db.query<{ status: string }>(
      `select status from public.list_my_session_requests(now(), now() + interval '60 days')`,
    );
    expect(history.rows.map((row) => row.status)).toEqual(['cancelled', 'cancelled']);
    await asRole('authenticated', OTHER_ID);
    await create(6, '10:00', '11:00');
  });

  it('refuses other users, the tutor, closed requests and unknown ids', async () => {
    await asRole('authenticated', TUTEE_ID);
    const made = await create(5, '10:00', '11:00');
    const id = made.rows[0]?.id ?? '';
    const cancel = (target: string) =>
      db.query(`select * from public.cancel_session_request('${target}')`);
    await asRole('authenticated', OTHER_ID);
    await expect(cancel(id)).rejects.toMatchObject({ code: '42501' });
    await asRole('authenticated', ADMIN_ID);
    await expect(cancel(id)).rejects.toMatchObject({ code: '42501' });
    await asRole('anon');
    await expect(cancel(id)).rejects.toMatchObject({ code: '42501' });
    await asRole('authenticated', TUTEE_ID);
    await cancel(id);
    await expect(cancel(id)).rejects.toMatchObject({ code: '42501' });
    await expect(cancel('00000000-0000-0000-0000-000000000999')).rejects.toMatchObject({
      code: '42501',
    });
    await asRole('authenticated', ADMIN_ID);
    await db.exec('reset role');
    expect(await statusOf(id)).toBe('cancelled');
  });
});

describe('timeslot requests migration: get_blocked_intervals privacy', () => {
  const blocked = () =>
    db.query<Record<string, unknown>>(
      `select * from public.get_blocked_intervals(now(), now() + interval '60 days')`,
    );

  it('merges tutor blocks with other tutees accepted sessions and returns only two columns', async () => {
    await db.exec(`
      insert into public.calendar_events(starts_at, ends_at, source, title)
        values (${slot(5, '09:00', '10:00')}, 'manual', 'Secret title');
      insert into public.session_requests(user_id, starts_at, ends_at, status) values
        ('${OTHER_ID}', ${slot(5, '10:00', '11:00')}, 'accepted'),
        ('${OTHER_ID}', ${slot(5, '12:00', '13:00')}, 'pending'),
        ('${TUTEE_ID}', ${slot(5, '14:00', '15:00')}, 'accepted'),
        ('${OTHER_ID}', ${slot(6, '10:00', '11:00')}, 'declined'),
        ('${OTHER_ID}', ${slot(7, '10:00', '11:00')}, 'cancelled');
    `);
    await asRole('authenticated', TUTEE_ID);
    const rows = await blocked();
    expect(rows.rows).toHaveLength(1);
    expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual(['ends_at', 'starts_at']);
    const [from, to] = [rows.rows[0]?.starts_at, rows.rows[0]?.ends_at] as Date[];
    expect((to?.getTime() ?? 0) - (from?.getTime() ?? 0)).toBe(2 * 3600_000);
    expect(JSON.stringify(rows.rows)).not.toMatch(/Secret|Sam|other@|00000000-/);
  });

  it('excludes the caller own accepted session and shows it to the other tutee instead', async () => {
    await db.exec(`insert into public.session_requests(user_id, starts_at, ends_at, status)
      values ('${TUTEE_ID}', ${slot(5, '14:00', '15:00')}, 'accepted')`);
    await asRole('authenticated', TUTEE_ID);
    expect((await blocked()).rows).toEqual([]);
    await asRole('authenticated', OTHER_ID);
    expect((await blocked()).rows).toHaveLength(1);
    await asRole('authenticated', ADMIN_ID);
    expect((await blocked()).rows).toHaveLength(1);
  });

  it('keeps the existing authorisation and range checks', async () => {
    await asRole('authenticated', STRANGER_ID);
    await expect(blocked()).rejects.toMatchObject({ code: '42501' });
    await asRole('anon');
    await expect(blocked()).rejects.toThrow();
    await asRole('authenticated', TUTEE_ID);
    await expect(
      db.query(`select * from public.get_blocked_intervals(now(), now() + interval '101 days')`),
    ).rejects.toMatchObject({ code: '22023' });
  });
});

describe('timeslot requests migration: tutor notification outbox', () => {
  const configureVault = () =>
    db.exec(`insert into vault.decrypted_secrets values
      ('access_webhook_secret', 's3cret'), ('access_webhook_url', 'https://fn.example.test/')`);

  it('queues exactly one outbox row keyed by the request id, with ids only', async () => {
    await asRole('authenticated', TUTEE_ID);
    const made = await create(5, '10:00', '11:00');
    await db.exec('reset role');
    const rows = await db.query<Record<string, unknown>>(
      'select * from public.tutor_notification_outbox',
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id: made.rows[0]?.id, user_id: TUTEE_ID, sent_at: null });
    expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual([
      'attempts',
      'created_at',
      'id',
      'sent_at',
      'user_id',
    ]);
    await asRole('authenticated', ADMIN_ID);
    const decision = await decide(made.rows[0]?.id ?? '', 'accepted');
    expect(decision.rows).toHaveLength(1);
    await db.exec('reset role');
    expect(await scalar('select count(*)::int as n from public.tutor_notification_outbox')).toBe(1);
  });

  it('posts a typed webhook payload and counts the attempt', async () => {
    await configureVault();
    await asRole('authenticated', TUTEE_ID);
    const made = await create(5, '10:00', '11:00');
    await db.exec('reset role');
    const calls = await db.query<{ body: Record<string, string>; headers: Record<string, string> }>(
      'select body, headers from net.calls',
    );
    expect(calls.rows).toHaveLength(1);
    expect(calls.rows[0]?.body).toEqual({
      event_id: made.rows[0]?.id,
      user_id: TUTEE_ID,
      event_type: 'session-requested',
    });
    expect(calls.rows[0]?.headers['x-webhook-secret']).toBe('s3cret');
    expect(await scalar('select attempts as n from public.tutor_notification_outbox')).toBe(1);
  });

  it('never rolls back the request when delivery fails and retries later', async () => {
    await configureVault();
    await db.exec(`set test.net_fails = 'on'`);
    await asRole('authenticated', TUTEE_ID);
    const made = await create(5, '10:00', '11:00');
    await db.exec('reset role');
    expect(await statusOf(made.rows[0]?.id ?? '')).toBe('pending');
    expect(await scalar('select count(*)::int as n from net.calls')).toBe(0);
    await db.exec(`set test.net_fails = 'off'; select private.retry_session_notifications();`);
    expect(await scalar('select count(*)::int as n from net.calls')).toBe(1);
    expect(await scalar('select attempts as n from public.tutor_notification_outbox')).toBe(1);
  });

  it('keeps the request when the webhook is not configured and skips sent or exhausted events', async () => {
    await asRole('authenticated', TUTEE_ID);
    await create(5, '10:00', '11:00');
    await create(6, '10:00', '11:00');
    await create(7, '10:00', '11:00');
    await db.exec('reset role');
    expect(await scalar('select count(*)::int as n from net.calls')).toBe(0);
    await configureVault();
    await db.exec(`
      update public.tutor_notification_outbox set sent_at = now()
        where id = (select id from public.tutor_notification_outbox order by created_at, id limit 1);
      update public.tutor_notification_outbox set attempts = 5
        where id = (select id from public.tutor_notification_outbox where sent_at is null order by id limit 1);
      select private.retry_session_notifications();
    `);
    expect(await scalar('select count(*)::int as n from net.calls')).toBe(1);
  });

  it('is compatible with the access-request outbox, trigger and retry function', async () => {
    await configureVault();
    await db.exec(`delete from public.access_requests where user_id = '${STRANGER_ID}';
      delete from public.access_request_notifications;`);
    await asRole('authenticated', STRANGER_ID);
    await db.exec(`select * from public.request_access('hello')`);
    await db.exec('reset role');
    expect(await scalar('select count(*)::int as n from public.access_request_notifications')).toBe(
      1,
    );
    const call = await db.query<{ body: Record<string, string> }>('select body from net.calls');
    expect(call.rows).toHaveLength(1);
    expect(call.rows[0]?.body).not.toHaveProperty('event_type');
    await db.exec(`delete from net.calls; select private.retry_access_notifications();
      select private.retry_session_notifications();`);
    const retried = await db.query<{ body: Record<string, string> }>('select body from net.calls');
    expect(retried.rows).toHaveLength(1);
    expect(retried.rows[0]?.body).not.toHaveProperty('event_type');
    const jobs = await db.query<{ name: string }>('select name from cron.jobs order by name');
    expect(jobs.rows.map((row) => row.name)).toEqual([
      'access-request-notification-retry',
      'session-request-notification-retry',
    ]);
  });
});
