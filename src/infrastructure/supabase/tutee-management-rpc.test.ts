/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index rows they just inserted */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_ID,
  createTuteeDatabase,
  tuteeId,
  type TuteeDatabase,
} from '../../test/tutee-database';

const T1 = tuteeId(1);
const T2 = tuteeId(2);
const T3 = tuteeId(3);

let t: TuteeDatabase;

beforeAll(async () => {
  t = await createTuteeDatabase();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const q = <R extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
  t.db.query<R>(sql, params);
const asAdmin = () => t.asRole('authenticated', ADMIN_ID);
const asUser = (id: string) => t.asRole('authenticated', id);
const code = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
};
const message = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};
const reset = () => q(`reset role`);
const row = async (id: string) =>
  (
    await q<{
      status: string;
      decided_at: string | null;
      next_request_at: string | null;
      request_count: number;
      message: string;
    }>(`select * from public.access_requests where user_id = $1`, [id])
  ).rows[0]!;
const audit = async (id: string) =>
  (
    await q<{ action: string; from_status: string | null; to_status: string | null; n: number }>(
      `select action, from_status, to_status, sessions_ended as n
       from public.access_audit_log where user_id = $1 order by id`,
      [id],
    )
  ).rows;
const notifications = async () =>
  (await q<{ n: number }>(`select count(*)::int as n from public.access_request_notifications`))
    .rows[0]!.n;
const sessionStatus = async (id: string) =>
  (await q<{ status: string }>(`select status from public.session_requests where id = $1`, [id]))
    .rows[0]!.status;

describe('allow_access_request_again', () => {
  it.each(['denied', 'revoked'] as const)('clears the cooldown of a %s tutee', async (status) => {
    await t.addTutee({ id: T1, status, nextRequestAt: new Date(Date.now() + 36e5).toISOString() });
    await asAdmin();
    const result = await q<{ status: string; next_request_at: string | null }>(
      `select * from public.allow_access_request_again($1)`,
      [T1],
    );
    expect(result.rows[0]).toMatchObject({ status, next_request_at: null });
    expect(await code(() => q(`select public.allow_access_request_again($1)`, [T1]))).toBe('TR003');
    await reset();
    expect(await audit(T1)).toEqual([
      { action: 'cooldown_reset', from_status: status, to_status: status, n: 0 },
    ]);
    expect((await row(T1)).status).toBe(status);
  });

  it.each(['pending', 'approved', 'blocked'] as const)('rejects a %s tutee', async (status) => {
    await t.addTutee({ id: T1, status });
    await asAdmin();
    expect(await code(() => q(`select public.allow_access_request_again($1)`, [T1]))).toBe('P0002');
    expect(await code(() => q(`select public.allow_access_request_again($1)`, [T2]))).toBe('P0002');
    await reset();
    expect(await audit(T1)).toEqual([]);
  });
});

describe('request_access', () => {
  it('creates a request with a requested event and one notification', async () => {
    await t.addTutee({ id: T2, status: 'approved' });
    await t.db.exec(`insert into auth.users values ('${T1}', 'new@example.test', now(), '{}')`);
    const before = await notifications();
    await asUser(T1);
    const result = await q<{ status: string; request_count: number }>(
      `select * from public.request_access('  Hello  ')`,
    );
    expect(result.rows[0]).toMatchObject({ status: 'pending', request_count: 1 });
    await reset();
    expect(await row(T1)).toMatchObject({ message: 'Hello' });
    expect(await audit(T1)).toEqual([
      { action: 'requested', from_status: null, to_status: 'pending', n: 0 },
    ]);
    expect(await notifications()).toBe(before + 1);
  });

  it('never lets a blocked user ask again, even after the cooldown time', async () => {
    await t.addTutee({
      id: T1,
      status: 'blocked',
      nextRequestAt: new Date(Date.now() - 36e5).toISOString(),
    });
    const before = await row(T1);
    const n = await notifications();
    await asUser(T1);
    const failure = await message(() => q(`select public.request_access('please')`));
    expect(failure).toContain('blocked');
    expect(await code(() => q(`select public.request_access('please')`))).toBe('P0001');
    await reset();
    expect(await row(T1)).toEqual(before);
    expect(await audit(T1)).toEqual([]);
    expect(await notifications()).toBe(n);
  });

  it.each(['denied', 'revoked'] as const)('enforces the cooldown for a %s user', async (status) => {
    await t.addTutee({ id: T1, status, nextRequestAt: new Date(Date.now() + 36e5).toISOString() });
    await asUser(T1);
    const failure = await message(() => q(`select public.request_access('again')`));
    expect(failure).toContain('cooldown active');
    await reset();
    expect((await row(T1)).status).toBe(status);
    expect(await audit(T1)).toEqual([]);
  });

  it.each(['denied', 'revoked'] as const)(
    'lets a %s user ask again after the cooldown, with one notification',
    async (status) => {
      await t.addTutee({
        id: T1,
        status,
        requestCount: 2,
        nextRequestAt: new Date(Date.now() - 1000).toISOString(),
      });
      const n = await notifications();
      await asUser(T1);
      await q(`select public.request_access('please')`);
      await reset();
      expect(await row(T1)).toMatchObject({
        status: 'pending',
        request_count: 3,
        decided_at: null,
        next_request_at: null,
      });
      expect(await audit(T1)).toEqual([
        { action: 're_requested', from_status: status, to_status: 'pending', n: 0 },
      ]);
      expect(await notifications()).toBe(n + 1);
    },
  );

  it('lets a revoked user ask again once the tutor allowed it', async () => {
    await t.addTutee({
      id: T1,
      status: 'revoked',
      nextRequestAt: new Date(Date.now() + 36e5).toISOString(),
    });
    await asAdmin();
    await q(`select public.allow_access_request_again($1)`, [T1]);
    await asUser(T1);
    const result = await q<{ status: string }>(`select * from public.request_access('hi')`);
    expect(result.rows[0]!.status).toBe('pending');
  });

  it('is idempotent for pending and approved users and rejects admins and long messages', async () => {
    await t.addTutee({ id: T1, status: 'pending' });
    await t.addTutee({ id: T2, status: 'approved' });
    const n = await notifications();
    await asUser(T1);
    await q(`select public.request_access('x')`);
    await asUser(T2);
    const approved = await q<{ status: string }>(`select * from public.request_access('x')`);
    expect(approved.rows[0]!.status).toBe('approved');
    expect(await code(() => q(`select public.request_access($1)`, ['x'.repeat(501)]))).toBe(
      '22023',
    );
    await asAdmin();
    expect(await code(() => q(`select public.request_access('x')`))).toBe('42501');
    await t.asRole('anon');
    expect(await code(() => q(`select public.request_access('x')`))).toBe('42501');
    await reset();
    expect(await notifications()).toBe(n);
    expect(await audit(T1)).toEqual([]);
    expect(await audit(T2)).toEqual([]);
  });

  it('does not notify when a tutor changes a status', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    const n = await notifications();
    await asAdmin();
    await q(`select public.act_on_tutee($1, 'revoke', 'keep')`, [T1]);
    await q(`select public.act_on_tutee($1, 'block', 'keep')`, [T1]);
    await q(`select public.act_on_tutee($1, 'unblock', 'keep')`, [T1]);
    await reset();
    expect(await notifications()).toBe(n);
  });
});

describe('session policy on revoke and block', () => {
  async function seedSessions() {
    await t.addTutee({ id: T1, status: 'approved' });
    await t.addTutee({ id: T2, status: 'approved' });
    const ids = {
      pending: await t.addSession({ userId: T1, status: 'pending', startsInHours: 48 }),
      future: await t.addSession({ userId: T1, status: 'accepted', startsInHours: 72 }),
      future2: await t.addSession({ userId: T1, status: 'accepted', startsInHours: 96 }),
      past: await t.addSession({ userId: T1, status: 'accepted', startsInHours: -48 }),
      declined: await t.addSession({ userId: T1, status: 'declined', startsInHours: 24 }),
      cancelled: await t.addSession({ userId: T1, status: 'cancelled', startsInHours: 25 }),
      other: await t.addSession({ userId: T2, status: 'accepted', startsInHours: 120 }),
      otherPending: await t.addSession({ userId: T2, status: 'pending', startsInHours: 121 }),
    };
    return ids;
  }

  it.each(['revoke', 'block'] as const)('%s with keep declines pending only', async (action) => {
    const ids = await seedSessions();
    await asAdmin();
    const result = await q<{ r: { pending_declined: number; accepted_cancelled: number } }>(
      `select public.act_on_tutee($1, $2, 'keep') as r`,
      [T1, action],
    );
    expect(result.rows[0]!.r).toMatchObject({ pending_declined: 1, accepted_cancelled: 0 });
    await reset();
    expect(await sessionStatus(ids.pending)).toBe('declined');
    expect(await sessionStatus(ids.future)).toBe('accepted');
    expect(await sessionStatus(ids.future2)).toBe('accepted');
    expect(await sessionStatus(ids.other)).toBe('accepted');
    expect(await sessionStatus(ids.otherPending)).toBe('pending');
    expect((await audit(T1))[0]!.n).toBe(1);
  });

  it.each(['revoke', 'block'] as const)(
    '%s with cancel_all cancels future accepted',
    async (action) => {
      const ids = await seedSessions();
      await asAdmin();
      const result = await q<{ r: { pending_declined: number; accepted_cancelled: number } }>(
        `select public.act_on_tutee($1, $2, 'cancel_all') as r`,
        [T1, action],
      );
      expect(result.rows[0]!.r).toMatchObject({ pending_declined: 1, accepted_cancelled: 2 });
      await reset();
      expect(await sessionStatus(ids.pending)).toBe('declined');
      expect(await sessionStatus(ids.future)).toBe('cancelled');
      expect(await sessionStatus(ids.future2)).toBe('cancelled');
      expect(await sessionStatus(ids.past)).toBe('accepted');
      expect(await sessionStatus(ids.declined)).toBe('declined');
      expect(await sessionStatus(ids.cancelled)).toBe('cancelled');
      expect(await sessionStatus(ids.other)).toBe('accepted');
      expect(await sessionStatus(ids.otherPending)).toBe('pending');
      expect((await audit(T1))[0]!.n).toBe(3);
      const stamped = await q<{ ok: boolean }>(
        `select (cancelled_at is not null) as ok from public.session_requests where id = $1`,
        [ids.future],
      );
      expect(stamped.rows[0]!.ok).toBe(true);
    },
  );

  it('leaves sessions alone for approve, deny, restore and unblock', async () => {
    await t.addTutee({ id: T1, status: 'revoked' });
    const future = await t.addSession({ userId: T1, status: 'accepted', startsInHours: 72 });
    await asAdmin();
    await q(`select public.act_on_tutee($1, 'restore', 'keep')`, [T1]);
    await reset();
    expect(await sessionStatus(future)).toBe('accepted');
  });
});

describe('cancel_session_as_tutor', () => {
  it('cancels pending and future accepted sessions and rejects the rest', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    const pending = await t.addSession({ userId: T1, status: 'pending', startsInHours: 30 });
    const future = await t.addSession({ userId: T1, status: 'accepted', startsInHours: 60 });
    const past = await t.addSession({ userId: T1, status: 'accepted', startsInHours: -60 });
    const declined = await t.addSession({ userId: T1, status: 'declined', startsInHours: 90 });
    await asAdmin();
    const first = await q<{ status: string; cancelled_at: string | null }>(
      `select * from public.cancel_session_as_tutor($1)`,
      [pending],
    );
    expect(first.rows[0]!.status).toBe('cancelled');
    expect(first.rows[0]!.cancelled_at).not.toBeNull();
    const second = await q<{ status: string }>(`select * from public.cancel_session_as_tutor($1)`, [
      future,
    ]);
    expect(second.rows[0]!.status).toBe('cancelled');
    for (const id of [pending, past, declined]) {
      expect(await code(() => q(`select public.cancel_session_as_tutor($1)`, [id]))).toBe('TR003');
    }
    expect(await code(() => q(`select public.cancel_session_as_tutor($1)`, [tuteeId(77)]))).toBe(
      'P0002',
    );
    await reset();
    expect(await sessionStatus(past)).toBe('accepted');
    expect(await sessionStatus(declined)).toBe('declined');
  });
});

describe('tutee-side own-session functions', () => {
  const create = () =>
    q(
      `select * from public.create_session_request(
        ((date_trunc('day', now() at time zone 'Europe/Brussels') + interval '5 days' + time '10:00') at time zone 'Europe/Brussels'),
        ((date_trunc('day', now() at time zone 'Europe/Brussels') + interval '5 days' + time '11:00') at time zone 'Europe/Brussels'))`,
    );
  const window = `now() - interval '1 day', now() + interval '30 days'`;

  it.each(['revoked', 'blocked', 'denied', 'pending'] as const)(
    'gives a %s tutee no access to any session function',
    async (status) => {
      await t.addTutee({ id: T1, status });
      const own = await t.addSession({ userId: T1, status: 'accepted', startsInHours: 72 });
      await asUser(T1);
      expect(await code(create)).toBe('42501');
      expect(await code(() => q(`select * from public.list_my_session_requests(${window})`))).toBe(
        '42501',
      );
      expect(await code(() => q(`select * from public.cancel_session_request($1)`, [own]))).toBe(
        '42501',
      );
      expect(await code(() => q(`select * from public.get_blocked_intervals(${window})`))).toBe(
        '42501',
      );
      await reset();
      expect(await sessionStatus(own)).toBe('accepted');
    },
  );

  it('keeps working for an approved tutee', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await t.addTutee({ id: T2, status: 'approved' });
    const mine = await t.addSession({ userId: T1, status: 'pending', startsInHours: 72 });
    await t.addSession({ userId: T2, status: 'pending', startsInHours: 73 });
    await asUser(T1);
    await create();
    const listed = await q<{ id: string }>(
      `select * from public.list_my_session_requests(${window})`,
    );
    expect(listed.rows.length).toBe(2);
    const cancelled = await q<{ status: string }>(
      `select * from public.cancel_session_request($1)`,
      [mine],
    );
    expect(cancelled.rows[0]!.status).toBe('cancelled');
    expect((await q(`select * from public.get_blocked_intervals(${window})`)).rows).toBeDefined();
  });

  it('lets an admin list own sessions (empty) but not create', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await t.addSession({ userId: T1, status: 'pending', startsInHours: 72 });
    await asAdmin();
    expect((await q(`select * from public.list_my_session_requests(${window})`)).rows).toEqual([]);
    expect(await code(create)).toBe('42501');
  });

  it('refuses a creation that was decided against while it waited (re-check under lock)', async () => {
    const def = await q<{ d: string }>(
      `select pg_get_functiondef('public.create_session_request(timestamptz,timestamptz)'::regprocedure) as d`,
    );
    const body = def.rows[0]!.d;
    const lock = body.indexOf('lock_schedule');
    const recheck = body.indexOf('is_approved_tutee', lock);
    expect(lock).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(lock);
  });

  it('takes locks in the documented order: schedule lock, then the access row', async () => {
    const defs = await q<{ name: string; d: string }>(
      `select p.proname as name, pg_get_functiondef(p.oid) as d from pg_proc p
       where p.proname in ('apply_access_action','request_access','allow_access_request_again','cancel_session_as_tutor')`,
    );
    const by = Object.fromEntries(defs.rows.map((r) => [r.name, r.d]));
    const apply = by.apply_access_action!;
    expect(apply.indexOf('lock_schedule')).toBeGreaterThan(0);
    expect(apply.indexOf('lock_schedule')).toBeLessThan(apply.indexOf('for update'));
    expect(by.cancel_session_as_tutor!.indexOf('lock_schedule')).toBeLessThan(
      by.cancel_session_as_tutor!.indexOf('for update'),
    );
    expect(by.request_access).not.toContain('lock_schedule');
    expect(by.allow_access_request_again).not.toContain('lock_schedule');
  });
});

describe('projections for the tutee', () => {
  const mine = (sql: string) => q<Record<string, unknown>>(sql);

  it.each([
    ['pending', 'pending'],
    ['approved', 'approved'],
    ['denied', 'denied'],
    ['revoked', 'denied'],
    ['blocked', 'denied'],
  ] as const)('get_my_access shows %s as %s', async (status, shown) => {
    await t.addTutee({ id: T1, status });
    await asUser(T1);
    const result = await mine(`select * from public.get_my_access()`);
    expect(result.rows).toEqual([{ is_admin: false, status: shown }]);
  });

  it('get_my_access for admins and users without a request', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await t.db.exec(`insert into auth.users values ('${T3}', 'none@example.test', now(), '{}')`);
    await asAdmin();
    expect((await mine(`select * from public.get_my_access()`)).rows).toEqual([
      { is_admin: true, status: null },
    ]);
    await asUser(T3);
    expect((await mine(`select * from public.get_my_access()`)).rows).toEqual([
      { is_admin: false, status: null },
    ]);
    await t.asRole('anon');
    expect(await code(() => mine(`select * from public.get_my_access()`))).toBe('42501');
  });

  it.each([
    ['revoked', true],
    ['denied', true],
    ['blocked', false],
  ] as const)('get_my_access_request hides %s', async (status, canAsk) => {
    const next = new Date(Date.now() + 36e5).toISOString();
    await t.addTutee({ id: T1, status, nextRequestAt: next, requestCount: 2 });
    await asUser(T1);
    const result = await mine(`select * from public.get_my_access_request()`);
    expect(result.rows.length).toBe(1);
    const only = result.rows[0]!;
    expect(only.status).toBe('denied');
    expect(only.can_ask_again).toBe(canAsk);
    expect(only.request_count).toBe(2);
    expect(only.next_request_at === null).toBe(!canAsk);
    expect(Object.keys(only)).not.toContain('actor_id');
  });

  it('get_my_access_request is empty without a request and never shows others', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await t.addTutee({ id: T2, status: 'blocked' });
    await asUser(T1);
    const result = await mine(`select * from public.get_my_access_request()`);
    expect(result.rows.map((r) => r.user_id)).toEqual([T1]);
    await asAdmin();
    expect((await mine(`select * from public.get_my_access_request()`)).rows).toEqual([]);
  });

  it('cannot read the request table or the audit trail directly', async () => {
    await t.addTutee({ id: T1, status: 'blocked' });
    await asUser(T1);
    expect(await code(() => q(`select status from public.access_requests`))).toBe('42501');
    expect(await code(() => q(`select * from public.access_audit_log`))).toBe('42501');
  });

  it('keeps is_approved_tutee true only for approved users', async () => {
    for (const [n, status] of [
      [1, 'approved'],
      [2, 'revoked'],
      [3, 'blocked'],
      [4, 'denied'],
      [5, 'pending'],
    ] as const) {
      await t.addTutee({ id: tuteeId(n), status });
    }
    const seen: Record<number, unknown> = {};
    for (const n of [1, 2, 3, 4, 5]) {
      await asUser(tuteeId(n));
      seen[n] = (await q<{ v: boolean }>(`select public.is_approved_tutee() as v`)).rows[0]!.v;
    }
    expect(seen).toEqual({ 1: true, 2: false, 3: false, 4: false, 5: false });
  });
});

describe('list_access_requests (inbox)', () => {
  it('lists pending, approved and denied only, with exact column types', async () => {
    await t.addTutee({ id: tuteeId(1), status: 'pending', name: 'Pia' });
    await t.addTutee({ id: tuteeId(2), status: 'approved', name: 'Al' });
    await t.addTutee({ id: tuteeId(3), status: 'denied', name: 'Dee' });
    await t.addTutee({ id: tuteeId(4), status: 'revoked', name: 'Rev' });
    await t.addTutee({ id: tuteeId(5), status: 'blocked', name: 'Blo' });
    await asAdmin();
    const all = await q<{ user_id: string; status: string; display_name: string }>(
      `select * from public.list_access_requests(null)`,
    );
    expect(all.rows.map((r) => r.status).sort()).toEqual(['approved', 'denied', 'pending']);
    expect(all.rows[0]!.status).toBe('pending');
    for (const status of ['revoked', 'blocked']) {
      expect(await code(() => q(`select * from public.list_access_requests($1)`, [status]))).toBe(
        '22023',
      );
    }
    const filtered = await q(`select * from public.list_access_requests('denied')`);
    expect(filtered.rows.length).toBe(1);
    await reset();
    const types = await q<{ t: string }>(
      `select pg_get_function_result('public.list_access_requests(text)'::regprocedure) as t`,
    );
    expect(types.rows[0]!.t).toBe(
      'TABLE(user_id uuid, display_name text, email text, message text, status text, requested_at timestamp with time zone, decided_at timestamp with time zone, next_request_at timestamp with time zone, request_count integer)',
    );
  });
});

describe('list_tutees', () => {
  const list = async (status: string | null, search: string | null, limit = 50, offset = 0) =>
    (
      await q<{
        r: {
          items: {
            user_id: string;
            display_name: string;
            status: string;
            pending_sessions: number;
            accepted_future_sessions: number;
          }[];
          total: number;
          counts: Record<string, number>;
        };
      }>(`select public.list_tutees($1, $2, $3, $4) as r`, [status, search, limit, offset])
    ).rows[0]!.r;

  it('orders pending first, then newest, with a stable tie-break', async () => {
    await t.addTutee({ id: tuteeId(1), status: 'approved', requestedAgo: '-1 day' });
    await t.addTutee({ id: tuteeId(2), status: 'pending', requestedAgo: '-5 days' });
    await t.addTutee({ id: tuteeId(3), status: 'denied', requestedAgo: '-2 hours' });
    await t.addTutee({ id: tuteeId(4), status: 'pending', requestedAgo: '-1 hour' });
    await asAdmin();
    const result = await list(null, null);
    expect(result.items.map((i) => i.user_id)).toEqual([
      tuteeId(4),
      tuteeId(2),
      tuteeId(3),
      tuteeId(1),
    ]);
    expect(result.total).toBe(4);
  });

  it('pages, clamps the limit and keeps counts independent of the status filter', async () => {
    for (let n = 1; n <= 105; n++) {
      await t.addTutee({
        id: tuteeId(n),
        status: n % 5 === 0 ? 'pending' : 'approved',
        requestedAgo: `-${String(n)} minutes`,
      });
    }
    await asAdmin();
    const first = await list('approved', null, 1000, 0);
    expect(first.items.length).toBe(84);
    expect(first.total).toBe(84);
    const all = await list(null, null, 1000, 0);
    expect(all.items.length).toBe(100);
    expect(all.total).toBe(105);
    const tail = await list(null, null, 100, 100);
    expect(tail.items.length).toBe(5);
    const small = await list(null, null, 0, 0);
    expect(small.items.length).toBe(1);
    expect(first.counts).toEqual({
      pending: 21,
      approved: 84,
      denied: 0,
      revoked: 0,
      blocked: 0,
      all: 105,
    });
    const pendingOnly = await list('pending', null);
    expect(pendingOnly.counts.approved).toBe(84);
    expect(pendingOnly.total).toBe(21);
    const page2 = await list('approved', null, 50, 50);
    expect(page2.items.length).toBe(34);
    const ids = new Set(
      [...(await list('approved', null, 50, 0)).items, ...page2.items].map((i) => i.user_id),
    );
    expect(ids.size).toBe(84);
  });

  it('searches names and emails case-insensitively and treats wildcards literally', async () => {
    await t.addTutee({ id: tuteeId(1), name: 'Alex Example', email: 'alex@example.test' });
    await t.addTutee({ id: tuteeId(2), name: '100% Sure', email: 'sure@example.test' });
    await t.addTutee({ id: tuteeId(3), name: 'a_b', email: 'under@example.test' });
    await t.addTutee({ id: tuteeId(4), name: 'back\\slash', email: 'slash@example.test' });
    await t.addTutee({ id: tuteeId(5), name: 'Zed', email: 'ZED.Mail@Example.test' });
    await asAdmin();
    expect((await list(null, 'ALEX')).items.map((i) => i.user_id)).toEqual([tuteeId(1)]);
    expect((await list(null, 'zed.mail')).items.map((i) => i.user_id)).toEqual([tuteeId(5)]);
    expect((await list(null, '  alex  ')).total).toBe(1);
    expect((await list(null, '%')).items.map((i) => i.user_id)).toEqual([tuteeId(2)]);
    expect((await list(null, '_')).items.map((i) => i.user_id).sort()).toEqual([tuteeId(3)]);
    expect((await list(null, '\\')).items.map((i) => i.user_id)).toEqual([tuteeId(4)]);
    expect((await list(null, '   ')).total).toBe(5);
    const searched = await list('approved', 'alex');
    expect(searched.counts.all).toBe(1);
    expect(searched.counts.approved).toBe(1);
    expect((await list(null, 'nobody')).total).toBe(0);
  });

  it('rejects an invalid status, a negative offset and an over-long search', async () => {
    await asAdmin();
    expect(await code(() => list('weird', null))).toBe('22023');
    expect(await code(() => list(null, null, 10, -1))).toBe('22023');
    expect(await code(() => list(null, 'x'.repeat(101)))).toBe('22023');
    expect(await code(() => list(null, 'x'.repeat(100)))).toBe('ok');
  });

  it('counts only pending and future accepted sessions of that tutee', async () => {
    await t.addTutee({ id: T1 });
    await t.addTutee({ id: T2 });
    await t.addSession({ userId: T1, status: 'pending', startsInHours: 30 });
    await t.addSession({ userId: T1, status: 'accepted', startsInHours: 60 });
    await t.addSession({ userId: T1, status: 'accepted', startsInHours: -60 });
    await t.addSession({ userId: T1, status: 'declined', startsInHours: 80 });
    await t.addSession({ userId: T2, status: 'pending', startsInHours: 31 });
    await asAdmin();
    const items = (await list(null, null)).items;
    const one = items.find((i) => i.user_id === T1)!;
    expect(one).toMatchObject({ pending_sessions: 1, accepted_future_sessions: 1 });
    expect(Object.keys(one)).toEqual(
      expect.arrayContaining(['user_id', 'display_name', 'email', 'status', 'request_count']),
    );
    expect(Object.keys(one)).not.toContain('actor_id');
    expect(Object.keys(one)).not.toContain('message');
  });
});

describe('get_tutee_detail', () => {
  const detail = async (id: string) =>
    (
      await q<{
        d: {
          tutee: Record<string, unknown>;
          sessions: { id: string; starts_at: string }[];
          events: Record<string, unknown>[];
          history_starts_at: string | null;
        };
      }>(`select public.get_tutee_detail($1) as d`, [id])
    ).rows[0]!.d;

  it('returns the profile, newest-first sessions and events, and no actor ids', async () => {
    await t.addTutee({ id: T1, status: 'approved', name: 'Alex Example' });
    await t.addSession({ userId: T1, status: 'pending', startsInHours: 30 });
    await t.addSession({ userId: T1, status: 'accepted', startsInHours: 60 });
    await t.addSession({ userId: T1, status: 'accepted', startsInHours: -60 });
    await asAdmin();
    await q(`select public.act_on_tutee($1, 'revoke', 'cancel_all')`, [T1]);
    await q(`select public.act_on_tutee($1, 'restore', 'keep')`, [T1]);
    const result = await detail(T1);
    expect(result.tutee).toMatchObject({
      user_id: T1,
      display_name: 'Alex Example',
      status: 'approved',
      pending_sessions: 0,
      accepted_future_sessions: 0,
    });
    expect(result.sessions.map((s) => Date.parse(s.starts_at))).toEqual(
      [...result.sessions.map((s) => Date.parse(s.starts_at))].sort((a, b) => b - a),
    );
    expect(result.events.map((e) => e.action)).toEqual(['restored', 'revoked']);
    expect(result.events[1]).toMatchObject({
      sessions_ended: 2,
      from_status: 'approved',
      to_status: 'revoked',
    });
    expect(JSON.stringify(result)).not.toContain(ADMIN_ID);
    expect(Object.keys(result.events[0]!).sort()).toEqual([
      'action',
      'created_at',
      'from_status',
      'id',
      'sessions_ended',
      'to_status',
    ]);
    expect(result.history_starts_at).not.toBeNull();
  });

  it('returns null history for an unaudited tutee and rejects unknown users', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await asAdmin();
    const result = await detail(T1);
    expect(result.events).toEqual([]);
    expect(result.history_starts_at).toBeNull();
    expect(await code(() => detail(T2))).toBe('P0002');
  });

  it('limits sessions to 20 and events to 50 while history_starts_at stays the earliest', async () => {
    await t.addTutee({ id: T1, status: 'denied', nextRequestAt: null });
    for (let i = 0; i < 25; i++) {
      await t.addSession({ userId: T1, status: 'declined', startsInHours: 24 + i });
    }
    await t.db.exec(`
      insert into public.access_audit_log (user_id, action, from_status, to_status, created_at)
      select '${T1}', 'cooldown_reset', 'denied', 'denied', now() - (g || ' minutes')::interval
      from generate_series(1, 60) g`);
    await asAdmin();
    const result = await detail(T1);
    expect(result.sessions.length).toBe(20);
    expect(result.events.length).toBe(50);
    await reset();
    const earliest = await q<{ ok: boolean }>(
      `select min(created_at) = $2::timestamptz as ok from public.access_audit_log where user_id = $1`,
      [T1, result.history_starts_at],
    );
    expect(earliest.rows[0]!.ok).toBe(true);
  });
});

describe('access_audit_log', () => {
  it('has exactly the documented columns and no personal data', async () => {
    const cols = await q<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'access_audit_log' order by ordinal_position`,
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'actor_id',
      'action',
      'from_status',
      'to_status',
      'sessions_ended',
      'created_at',
    ]);
  });

  it('is deleted with the user and does not block deleting the actor', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await t.addTutee({ id: T2, status: 'approved' });
    await asAdmin();
    await q(`select public.act_on_tutee($1, 'block', 'keep')`, [T1]);
    await q(`select public.act_on_tutee($1, 'block', 'keep')`, [T2]);
    await reset();
    expect((await audit(T1)).length).toBe(1);
    await q(`delete from auth.users where id = $1`, [T1]);
    expect(await audit(T1)).toEqual([]);
    expect((await audit(T2)).length).toBe(1);
    const fks = await q<{ n: number }>(
      `select count(*)::int as n from pg_constraint c
       where c.conrelid = 'public.access_audit_log'::regclass and c.contype = 'f'`,
    );
    expect(fks.rows[0]!.n).toBe(1);
    await q(`delete from auth.users where id = $1`, [ADMIN_ID]);
    expect((await audit(T2)).length).toBe(1);
  });

  it('rejects client writes and keeps unrelated values out of the log', async () => {
    await t.addTutee({ id: T1, status: 'pending' });
    await asUser(T1);
    expect(await code(() => q(`delete from public.access_audit_log`))).toBe('42501');
    expect(await code(() => q(`update public.access_audit_log set action = 'approved'`))).toBe(
      '42501',
    );
    await t.asRole('service_role');
    expect(await code(() => q(`select * from public.access_audit_log`))).toBe('42501');
    expect(
      await code(() =>
        q(`insert into public.access_audit_log (user_id, action) values ($1, 'approved')`, [T1]),
      ),
    ).toBe('42501');
    await reset();
    const bad = await code(() =>
      q(`insert into public.access_audit_log (user_id, action) values ($1, 'explode')`, [T1]),
    );
    expect(bad).toBe('23514');
  });
});
