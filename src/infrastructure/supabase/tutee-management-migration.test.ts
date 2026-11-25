/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index rows they just inserted */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALLOWED_FROM, COOLDOWN_MS, nextAccessState } from '../../core/domain/tutee-transitions';
import type { TuteeAction, TuteeStatus } from '../../core/domain/tutee';
import {
  ADMIN_ID,
  createTuteeDatabase,
  tuteeId,
  type TuteeDatabase,
} from '../../test/tutee-database';

const T1 = tuteeId(1);
const T2 = tuteeId(2);
const T3 = tuteeId(3);
const STATUSES: TuteeStatus[] = ['pending', 'approved', 'denied', 'revoked', 'blocked'];
const ACTIONS = Object.keys(ALLOWED_FROM) as TuteeAction[];

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
const row = async (id: string) =>
  (
    await q<{
      status: string;
      decided_at: string | null;
      next_request_at: string | null;
      request_count: number;
      requested_at: string;
    }>(`select * from public.access_requests where user_id = $1`, [id])
  ).rows[0]!;
const audit = async (id: string) =>
  (
    await q<{
      action: string;
      from_status: string | null;
      to_status: string | null;
      sessions_ended: number;
      actor_id: string | null;
    }>(
      `select action, from_status, to_status, sessions_ended, actor_id
       from public.access_audit_log where user_id = $1 order by id`,
      [id],
    )
  ).rows;
const act = (id: string, action: string, policy = 'keep') =>
  q<{ act_on_tutee: { status: string; pending_declined: number; accepted_cancelled: number } }>(
    `select public.act_on_tutee($1, $2, $3)`,
    [id, action, policy],
  ).then((r) => r.rows[0]!.act_on_tutee);

describe('privileges and structure', () => {
  const tutorRpcs: [string, string][] = [
    ['act_on_tutee', `('${T1}', 'approve', 'keep')`],
    ['decide_access_request', `('${T1}', 'approved')`],
    ['allow_access_request_again', `('${T1}')`],
    ['list_tutees', `(null, null, 50, 0)`],
    ['get_tutee_detail', `('${T1}')`],
    ['cancel_session_as_tutor', `('${T1}')`],
    ['list_access_requests', `(null)`],
  ];

  it('rejects anonymous callers for every tutor RPC', async () => {
    await t.addTutee({ id: T1, status: 'pending' });
    await t.asRole('anon');
    for (const [name, args] of tutorRpcs) {
      expect(await code(() => q(`select public.${name}${args}`)), name).toBe('42501');
    }
  });

  it('rejects approved, pending, revoked and blocked tutees for every tutor RPC', async () => {
    await t.addTutee({ id: T1, status: 'pending' });
    for (const [n, status] of [
      [10, 'approved'],
      [11, 'pending'],
      [12, 'revoked'],
      [13, 'blocked'],
      [14, 'denied'],
    ] as const) {
      await t.reset();
      await t.addTutee({ id: T1, status: 'pending' });
      await t.addTutee({ id: tuteeId(n), status });
      await asUser(tuteeId(n));
      for (const [name, args] of tutorRpcs) {
        expect(await code(() => q(`select public.${name}${args}`)), `${status} ${name}`).toBe(
          '42501',
        );
      }
    }
  });

  it('gives clients no table privileges and keeps the service-role grants', async () => {
    await t.asRole('anon');
    const grants = await q<{ g: string }>(
      `select table_name || ':' || grantee || ':' || privilege_type as g
       from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon','authenticated','public')`,
    );
    expect(grants.rows).toEqual([]);
    await t.asRole('authenticated', T1);
    expect(await code(() => q(`select * from public.access_requests`))).toBe('42501');
    expect(await code(() => q(`select * from public.access_audit_log`))).toBe('42501');
    expect(
      await code(() =>
        q(`insert into public.access_audit_log (user_id, action) values ($1,'approved')`, [T1]),
      ),
    ).toBe('42501');

    await q(`reset role`);
    const service = await q<{ g: string }>(
      `select table_name || ':' || privilege_type as g from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'service_role' order by 1`,
    );
    const names = service.rows.map((r) => r.g);
    expect(names).toContain('access_requests:SELECT');
    expect(names).toContain('access_request_notifications:SELECT');
    expect(names).toContain('access_request_notifications:UPDATE');
    expect(names).toContain('session_requests:SELECT');
    expect(names).toContain('tutor_notification_outbox:UPDATE');
    expect(names.filter((n) => n.startsWith('access_audit_log'))).toEqual([]);
  });

  it('pins search_path on every new function and enables RLS on the audit table', async () => {
    const fns = await q<{ proname: string; config: string[] | null }>(
      `select p.proname, p.proconfig as config from pg_proc p
       where p.proname in ('act_on_tutee','decide_access_request','allow_access_request_again',
         'list_tutees','get_tutee_detail','cancel_session_as_tutor','list_access_requests',
         'request_access','get_my_access','get_my_access_request','list_my_session_requests',
         'cancel_session_request','create_session_request','apply_access_action',
         'audit_access','tutee_display_name','queue_access_notification')`,
    );
    expect(fns.rows.length).toBe(17);
    for (const fn of fns.rows) expect(fn.config, fn.proname).toContain('search_path=""');
    const rls = await q<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'access_audit_log'`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
  });

  it('does not expose the private helpers to clients', async () => {
    await t.addTutee({ id: T1, status: 'pending' });
    await asAdmin();
    expect(
      await code(() => q(`select private.apply_access_action($1, 'approve', 'keep')`, [T1])),
    ).toBe('42501');
    expect(
      await code(() => q(`select private.audit_access($1, 'approved', null, null, 0)`, [T1])),
    ).toBe('42501');
  });

  it('widens the status check to five values and rejects anything else', async () => {
    await t.addTutee({ id: T1, status: 'pending' });
    for (const status of STATUSES.filter((s) => s !== 'pending')) {
      await q(
        `update public.access_requests set status = $2, decided_at = now() where user_id = $1`,
        [T1, status],
      );
    }
    expect(
      await code(() =>
        q(`update public.access_requests set status = 'weird' where user_id = $1`, [T1]),
      ),
    ).toBe('23514');
    expect(
      await code(() =>
        q(`update public.access_requests set decided_at = null where user_id = $1`, [T1]),
      ),
    ).toBe('23514');
  });
});

describe('state machine', () => {
  const pairs = STATUSES.flatMap((status) => ACTIONS.map((action) => [status, action] as const));

  it.each(pairs)('%s + %s matches the executable spec', async (status, action) => {
    await t.addTutee({ id: T1, status, nextRequestAt: null });
    const before = await row(T1);
    await asAdmin();
    const expected = nextAccessState(status, action, new Date().toISOString());
    if (!expected.ok) {
      expect(await code(() => act(T1, action))).toBe('TR003');
      await q(`reset role`);
      expect(await row(T1)).toEqual(before);
      expect(await audit(T1)).toEqual([]);
      return;
    }
    const result = await act(T1, action);
    expect(result).toEqual({
      status: expected.value.status,
      pending_declined: 0,
      accepted_cancelled: 0,
    });
    await q(`reset role`);
    const after = await row(T1);
    expect(after.status).toBe(expected.value.status);
    expect(after.decided_at).not.toBeNull();
    const events = await audit(T1);
    expect(events).toEqual([
      {
        action: expected.value.auditAction,
        from_status: status,
        to_status: expected.value.status,
        sessions_ended: 0,
        actor_id: ADMIN_ID,
      },
    ]);
    const gap = await q<{ ms: number | null }>(
      `select (extract(epoch from (next_request_at - decided_at)) * 1000)::float8 as ms
       from public.access_requests where user_id = $1`,
      [T1],
    );
    expect(gap.rows[0]!.ms).toBe(action === 'deny' || action === 'revoke' ? COOLDOWN_MS : null);
  });

  it('rejects invalid input with 22023 and unknown users with P0002', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await asAdmin();
    expect(await code(() => act(T1, 'explode'))).toBe('22023');
    expect(await code(() => act(T1, 'approve', 'wipe'))).toBe('22023');
    expect(await code(() => act(T1, 'approve', 'cancel_all'))).toBe('22023');
    expect(await code(() => act(ADMIN_ID, 'block'))).toBe('22023');
    expect(await code(() => act(T2, 'block'))).toBe('P0002');
    expect(await code(() => q(`select public.act_on_tutee(null, 'block', 'keep')`))).toBe('22023');
    expect(await code(() => q(`select public.act_on_tutee($1, null, 'keep')`, [T1]))).toBe('22023');
    expect(await code(() => q(`select public.act_on_tutee($1, 'block', null)`, [T1]))).toBe(
      '22023',
    );
  });

  it('is rejected twice through the inbox wrapper without a second event', async () => {
    await t.addTutee({ id: T1, status: 'pending' });
    await asAdmin();
    await q(`select public.decide_access_request($1, 'denied')`, [T1]);
    expect(await code(() => q(`select public.decide_access_request($1, 'denied')`, [T1]))).toBe(
      'TR003',
    );
    await q(`select public.decide_access_request($1, 'approved')`, [T1]);
    expect(await code(() => q(`select public.decide_access_request($1, 'approved')`, [T1]))).toBe(
      'TR003',
    );
    await q(`reset role`);
    expect((await audit(T1)).map((e) => e.action)).toEqual(['denied', 'approved']);
  });

  it('maps inbox decisions onto revoke and restore', async () => {
    await t.addTutee({ id: T1, status: 'approved' });
    await t.addTutee({ id: T2, status: 'revoked' });
    await t.addTutee({ id: T3, status: 'blocked' });
    await asAdmin();
    const denied = await q<{ status: string }>(
      `select * from public.decide_access_request($1, 'denied')`,
      [T1],
    );
    expect(denied.rows[0]!.status).toBe('revoked');
    const restored = await q<{ status: string }>(
      `select * from public.decide_access_request($1, 'approved')`,
      [T2],
    );
    expect(restored.rows[0]!.status).toBe('approved');
    expect(await code(() => q(`select public.decide_access_request($1, 'approved')`, [T3]))).toBe(
      'TR003',
    );
    expect(await code(() => q(`select public.decide_access_request($1, 'maybe')`, [T1]))).toBe(
      '22023',
    );
    expect(
      await code(() => q(`select public.decide_access_request($1, 'approved')`, [tuteeId(99)])),
    ).toBe('P0002');
    await q(`reset role`);
    expect((await audit(T1)).map((e) => e.action)).toEqual(['revoked']);
    expect((await audit(T2)).map((e) => e.action)).toEqual(['restored']);
  });
});
