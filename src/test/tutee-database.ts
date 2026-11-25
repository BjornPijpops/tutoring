/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index rows they just inserted */
import { PGlite } from '@electric-sql/pglite';
import calendarMigration from '../../supabase/migrations/20261124000000_calendar.sql?raw';
import accessMigration from '../../supabase/migrations/20261125000000_access_requests.sql?raw';
import fixTypesMigration from '../../supabase/migrations/20261125000100_fix_list_access_requests_types.sql?raw';
import grantMigration from '../../supabase/migrations/20261125000200_grant_service_role_notifications.sql?raw';
import versionsMigration from '../../supabase/migrations/20261125000300_calendar_event_versions.sql?raw';
import sessionMigration from '../../supabase/migrations/20261125000400_timeslot_requests.sql?raw';
import tuteeMigration from '../../supabase/migrations/20261126000000_tutee_management.sql?raw';
import recurringMigration from '../../supabase/migrations/20261127000000_recurring_events.sql?raw';

export const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
export const tuteeId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

export const SUPABASE_STUB = `
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
  language plpgsql as $$ begin insert into net.calls values (url, headers, body); return 1; end $$;
  create schema cron;
  create table cron.jobs (name text, schedule text, command text);
  create function cron.schedule(name text, schedule text, command text) returns bigint
  language sql as $$ insert into cron.jobs values (name, schedule, command) returning 1::bigint $$;
`;

const withoutExtensions = (sql: string) => sql.replace(/create extension[^;]*;/g, '');

export const MIGRATIONS = {
  calendar: calendarMigration,
  access: accessMigration,
  fixTypes: fixTypesMigration,
  grant: grantMigration,
  versions: versionsMigration,
  session: sessionMigration,
  tutee: tuteeMigration,
  recurring: recurringMigration,
} as const;

export type DbRole = 'anon' | 'authenticated' | 'service_role';

export interface SeedTutee {
  readonly id: string;
  readonly name?: string;
  readonly email?: string;
  readonly status?: 'pending' | 'approved' | 'denied' | 'revoked' | 'blocked';
  /** SQL interval text relative to now(), for example `-2 days`. */
  readonly requestedAgo?: string;
  readonly nextRequestAt?: string | null;
  readonly requestCount?: number;
}

export interface SeedSession {
  readonly userId: string;
  readonly status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  /** Hours from now at which the session starts; sessions last 30 minutes. */
  readonly startsInHours: number;
}

export interface TuteeDatabase {
  readonly db: PGlite;
  asRole(role: DbRole, userId?: string): Promise<void>;
  reset(): Promise<void>;
  addTutee(seed: SeedTutee): Promise<void>;
  addSession(seed: SeedSession): Promise<string>;
  close(): Promise<void>;
}

/** PGlite with every migration up to and including recurring events, plus recurring events and an admin. */
export async function createTuteeDatabase(): Promise<TuteeDatabase> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(MIGRATIONS.calendar);
  await db.exec(withoutExtensions(MIGRATIONS.access));
  await db.exec(MIGRATIONS.fixTypes);
  await db.exec(MIGRATIONS.grant);
  await db.exec(MIGRATIONS.versions);
  await db.exec(withoutExtensions(MIGRATIONS.session));
  await db.exec(MIGRATIONS.tutee);
  await db.exec(MIGRATIONS.recurring);

  const seedAdmin = async () => {
    await db.exec(`
      insert into auth.users values
        ('${ADMIN_ID}', 'admin@example.test', now(), '{"full_name": "Tutor"}');
      insert into public.admins (email) values ('admin@example.test');
    `);
  };
  await seedAdmin();

  return {
    db,
    async asRole(role, userId) {
      await db.exec(
        `reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`,
      );
      await db.exec(`set role ${role};`);
    },
    async reset() {
      await db.exec(`
        reset role;
        delete from public.session_requests;
        delete from public.calendar_events;
        delete from public.calendar_event_series;
        delete from public.access_audit_log;
        delete from public.access_request_notifications;
        delete from public.tutor_notification_outbox;
        delete from public.access_requests;
        delete from auth.users where id <> '${ADMIN_ID}';
        delete from net.calls;
      `);
    },
    async addTutee(seed) {
      const status = seed.status ?? 'approved';
      const name = seed.name ?? `Tutee ${seed.id.slice(-4)}`;
      const email = seed.email ?? `tutee-${seed.id.slice(-4)}@example.test`;
      await db.query(`insert into auth.users values ($1, $2, now(), $3::jsonb)`, [
        seed.id,
        email,
        JSON.stringify({ full_name: name }),
      ]);
      await db.query(
        `insert into public.access_requests
           (user_id, status, requested_at, decided_at, next_request_at, request_count)
         values ($1, $2, now() + $3::interval,
           case when $2 = 'pending' then null else now() + $3::interval end,
           $4::timestamptz, $5)`,
        [
          seed.id,
          status,
          seed.requestedAgo ?? '-1 day',
          seed.nextRequestAt ?? null,
          seed.requestCount ?? 1,
        ],
      );
    },
    async addSession(seed) {
      const result = await db.query<{ id: string }>(
        `insert into public.session_requests (user_id, status, starts_at, ends_at, decided_at, cancelled_at)
         values ($1, $2, now() + $3::interval, now() + $3::interval + interval '30 minutes',
           case when $2 in ('accepted','declined') then now() end,
           case when $2 = 'cancelled' then now() end)
         returning id`,
        [seed.userId, seed.status, `${String(seed.startsInHours)} hours`],
      );
      return result.rows[0]!.id;
    },
    async close() {
      await db.close();
    },
  };
}
