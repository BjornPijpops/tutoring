import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration from '../../../supabase/migrations/20261124000000_calendar.sql?raw';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const TUTEE_ID = '00000000-0000-0000-0000-0000000000b2';
const UNCONFIRMED_ID = '00000000-0000-0000-0000-0000000000c3';

// Minimal stand-in for the parts of Supabase the migration relies on.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;

async function asRole(role: 'anon' | 'authenticated', userId?: string) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`,
  );
  await db.exec(`set role ${role};`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(migration);
  await db.exec(`
    insert into auth.users values
      ('${ADMIN_ID}', 'Admin@Example.test', now()),
      ('${TUTEE_ID}', 'tutee@example.test', now()),
      ('${UNCONFIRMED_ID}', 'admin@example.test', null);
    insert into public.admins (email) values ('admin@example.test');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('reset role; delete from public.calendar_events;');
  await db.exec(`
    insert into public.calendar_events (starts_at, ends_at, title, source, external_id) values
      ('2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z', 'Secret A', 'manual', null),
      ('2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z', 'Secret B', 'ics', 'uid#1'),
      ('2026-01-05T10:30:00Z', '2026-01-05T11:30:00Z', 'Secret C', 'manual', null),
      ('2026-01-07T09:00:00Z', '2026-01-07T10:00:00Z', 'Secret D', 'manual', null);
  `);
});

const BLOCKED = `select starts_at, ends_at from public.get_blocked_intervals('2026-01-05T00:00:00Z', '2026-01-08T00:00:00Z')`;

describe('calendar migration', () => {
  it('denies anonymous access to tables and functions', async () => {
    await asRole('anon');
    await expect(db.query('select * from public.calendar_events')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query('select * from public.admins')).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.is_admin()')).rejects.toThrow(/permission denied/);
    await expect(db.query(BLOCKED)).rejects.toThrow(/permission denied/);
  });

  it('shows a non-admin no rows and refuses writes', async () => {
    await asRole('authenticated', TUTEE_ID);
    expect((await db.query('select * from public.calendar_events')).rows).toHaveLength(0);
    await expect(
      db.query(
        `insert into public.calendar_events (starts_at, ends_at, source)
         values ('2026-01-09T10:00:00Z', '2026-01-09T11:00:00Z', 'manual')`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect((await db.query('select public.is_admin() as admin')).rows).toEqual([{ admin: false }]);
  });

  it('keeps admins unreachable for signed-in users', async () => {
    await asRole('authenticated', ADMIN_ID);
    await expect(db.query('select * from public.admins')).rejects.toThrow(/permission denied/);
  });

  it('does not treat an unconfirmed email as admin', async () => {
    await asRole('authenticated', UNCONFIRMED_ID);
    expect((await db.query('select public.is_admin() as admin')).rows).toEqual([{ admin: false }]);
  });

  it('lets a confirmed admin read and write events, matching email case-insensitively', async () => {
    await asRole('authenticated', ADMIN_ID);
    expect((await db.query('select public.is_admin() as admin')).rows).toEqual([{ admin: true }]);
    expect((await db.query('select * from public.calendar_events')).rows).toHaveLength(4);
    await db.query(
      `insert into public.calendar_events (starts_at, ends_at, title, source)
       values ('2026-01-09T10:00:00Z', '2026-01-09T11:00:00Z', 'New', 'manual')`,
    );
    await db.query(`delete from public.calendar_events where title = 'New'`);
  });

  it('enforces the table constraints', async () => {
    await asRole('authenticated', ADMIN_ID);
    const insert = (starts: string, ends: string, extra = `'x'`, source = 'manual') =>
      db.query(
        `insert into public.calendar_events (starts_at, ends_at, title, source)
         values ('${starts}', '${ends}', ${extra}, '${source}')`,
      );
    await expect(insert('2026-01-09T11:00:00Z', '2026-01-09T10:00:00Z')).rejects.toThrow(
      /calendar_events_order/,
    );
    await expect(insert('2026-01-09T10:00:00Z', '2026-03-09T10:00:00Z')).rejects.toThrow(
      /max_length/,
    );
    await expect(
      insert('2026-01-09T10:00:00Z', '2026-01-09T11:00:00Z', `repeat('x', 201)`),
    ).rejects.toThrow(/title_length/);
    await expect(
      insert('2026-01-09T10:00:00Z', '2026-01-09T11:00:00Z', `'x'`, 'other'),
    ).rejects.toThrow(/check/);
    await expect(
      db.query(
        `insert into public.calendar_events (starts_at, ends_at, source, external_id)
         values ('2026-01-09T10:00:00Z', '2026-01-09T11:00:00Z', 'ics', 'uid#1')`,
      ),
    ).rejects.toThrow(/source_external_unique/);
  });

  it('returns merged intervals without titles, ids or counts to an admin', async () => {
    await asRole('authenticated', ADMIN_ID);
    const result = await db.query<{ starts_at: Date; ends_at: Date }>(BLOCKED);
    expect(result.fields.map((field) => field.name)).toEqual(['starts_at', 'ends_at']);
    expect(
      result.rows.map((row) => [row.starts_at.toISOString(), row.ends_at.toISOString()]),
    ).toEqual([
      ['2026-01-05T10:00:00.000Z', '2026-01-05T12:00:00.000Z'],
      ['2026-01-07T09:00:00.000Z', '2026-01-07T10:00:00.000Z'],
    ]);
  });

  it('clips intervals to the requested range', async () => {
    await asRole('authenticated', ADMIN_ID);
    const result = await db.query<{ starts_at: Date; ends_at: Date }>(
      `select * from public.get_blocked_intervals('2026-01-05T10:30:00Z', '2026-01-05T11:15:00Z')`,
    );
    expect(
      result.rows.map((row) => [row.starts_at.toISOString(), row.ends_at.toISOString()]),
    ).toEqual([['2026-01-05T10:30:00.000Z', '2026-01-05T11:15:00.000Z']]);
  });

  it('refuses the RPC to non-admins (the approved-tutee stub is closed)', async () => {
    await asRole('authenticated', TUTEE_ID);
    await expect(db.query(BLOCKED)).rejects.toThrow(/calendar access denied/);
    expect((await db.query('select public.is_approved_tutee() as approved')).rows).toEqual([
      { approved: false },
    ]);
  });

  it.each([
    ['reversed', `'2026-01-08T00:00:00Z', '2026-01-05T00:00:00Z'`],
    ['equal', `'2026-01-08T00:00:00Z', '2026-01-08T00:00:00Z'`],
    ['over 100 days', `'2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'`],
    ['null', `null, '2026-06-01T00:00:00Z'`],
  ])('rejects a %s range', async (_name, args) => {
    await asRole('authenticated', ADMIN_ID);
    await expect(db.query(`select * from public.get_blocked_intervals(${args})`)).rejects.toThrow(
      /invalid calendar range/,
    );
  });
});
