import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import baseMigration from '../../../supabase/migrations/20261124000000_calendar.sql?raw';
import versionMigration from '../../../supabase/migrations/20261125000300_calendar_event_versions.sql?raw';

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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(baseMigration);
  await db.exec(versionMigration);
});

afterAll(async () => {
  await db.close();
});

describe('calendar event versions migration', () => {
  it('is idempotent and preserves table privileges and RLS', async () => {
    await db.exec(versionMigration);
    const result = await db.query<{
      column_name: string;
    }>(`select column_name from information_schema.columns
             where table_schema = 'public' and table_name = 'calendar_events'
             and column_name = 'updated_at'`);
    expect(result.rows).toEqual([{ column_name: 'updated_at' }]);
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where schemaname = 'public' and tablename = 'calendar_events'`,
    );
    expect(policies.rows).toEqual([{ policyname: 'calendar_events_admin_all' }]);
    const grants = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'calendar_events' and grantee = 'authenticated'
       order by privilege_type`,
    );
    expect(grants.rows.map((row) => row.privilege_type)).toEqual([
      'DELETE',
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);
  });

  it('updates the version through the trigger', async () => {
    await db.exec(`
      insert into public.calendar_events (starts_at, ends_at, title, source)
      values ('2026-01-09T10:00:00Z', '2026-01-09T11:00:00Z', 'Before', 'manual');
    `);
    const before = await db.query<{ updated_at: string }>(
      `select updated_at from public.calendar_events where title = 'Before'`,
    );
    await db.exec(`update public.calendar_events set title = 'After' where title = 'Before'`);
    const after = await db.query<{ updated_at: string }>(
      `select updated_at from public.calendar_events where title = 'After'`,
    );
    expect(after.rows[0]?.updated_at).toBeTruthy();
    expect(after.rows[0]?.updated_at).not.toBe(before.rows[0]?.updated_at);
  });
});
