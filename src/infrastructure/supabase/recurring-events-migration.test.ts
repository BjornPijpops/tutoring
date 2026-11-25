/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index rows they just inserted */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  localDateOf,
  wallTimeToInstant,
  type IsoDate,
} from '../../core/domain/local-time';
import {
  expandRecurrence,
  latestRecurrenceDate,
  type RecurrenceRule,
} from '../../core/domain/recurrence';
import { TUTOR_TIME_ZONE } from '../../core/domain/tutoring-hours';
import { todayInBrussels } from '../../shared/dates/brussels';
import {
  ADMIN_ID,
  MIGRATIONS,
  createTuteeDatabase,
  tuteeId,
  type TuteeDatabase,
} from '../../test/tutee-database';

const T1 = tuteeId(1);
const today = todayInBrussels();
const day = (offset: number): IsoDate => addDays(today, offset);
const at = (date: IsoDate, minutes: number) =>
  wallTimeToInstant(date, Math.floor(minutes / 60), minutes % 60, TUTOR_TIME_ZONE);
const occurrence = (date: IsoDate, start = 600, end = 660) => ({
  startsAt: at(date, start),
  endsAt: at(date, end),
});
const dailyRule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  startDate: day(1),
  intervalWeeks: 1,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  startMinutes: 600,
  endMinutes: 660,
  end: { kind: 'count', count: 8 },
  ...overrides,
});

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
const asRole = (role: Parameters<TuteeDatabase['asRole']>[0], id?: string) => t.asRole(role, id);
const reset = () => q('reset role');
const code = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
};

interface CreatedSeries {
  series_id: string;
  occurrence_count: number;
}

/** A rule that agrees with `occurrences` (start date, count), with optional overrides. */
const ruleFor = (
  occurrences: readonly { startsAt: string }[],
  overrides: Partial<RecurrenceRule> = {},
): RecurrenceRule => {
  const dates = occurrences.map((item) => localDateOf(item.startsAt, TUTOR_TIME_ZONE)).sort();
  return dailyRule({
    startDate: dates[0] ?? day(1),
    end: { kind: 'count', count: occurrences.length },
    ...overrides,
  });
};

const create = async (
  occurrences: readonly { startsAt: string; endsAt: string }[],
  overrides: Partial<RecurrenceRule> = {},
  title = 'Badminton',
) =>
  (
    await q<CreatedSeries & Record<string, unknown>>(
      `select * from public.create_calendar_series($1::jsonb, $2, $3::jsonb)`,
      [JSON.stringify(ruleFor(occurrences, overrides)), title, JSON.stringify(occurrences)],
    )
  ).rows[0]!;

/** Creates the standard series from the shared TS expansion: 8 consecutive days at 10:00-11:00. */
const createDaily = async (title = 'Badminton') => {
  const rule = dailyRule();
  const { occurrences } = expandRecurrence(rule, today);
  return create(occurrences, rule, title);
};

interface EventRow extends Record<string, unknown> {
  id: string;
  title: string;
  series_id: string | null;
  source: string;
  local_date: string;
  local_start: string;
  local_end: string;
  updated_at: Date;
}
const events = async () =>
  (
    await q<EventRow>(
      `select id, title, series_id, source, updated_at,
         to_char(starts_at at time zone 'Europe/Brussels', 'YYYY-MM-DD') as local_date,
         to_char(starts_at at time zone 'Europe/Brussels', 'HH24:MI') as local_start,
         to_char(ends_at at time zone 'Europe/Brussels', 'HH24:MI') as local_end
       from public.calendar_events order by starts_at, id`,
    )
  ).rows;
const seriesRows = async () =>
  (
    await q<{ id: string; rule: Record<string, unknown> }>(
      `select id, rule from public.calendar_event_series order by created_at, id`,
    )
  ).rows;
const counts = async () =>
  (
    await q<{ events: number; series: number }>(
      `select (select count(*) from public.calendar_events)::int as events,
              (select count(*) from public.calendar_event_series)::int as series`,
    )
  ).rows[0]!;

interface UpdateResult extends Record<string, unknown> {
  affected_count: number;
  series_id: string | null;
}
const update = async (
  event: EventRow,
  scope: string,
  changes: Record<string, unknown>,
  expected: Date = event.updated_at,
) =>
  (
    await q<UpdateResult>(
      `select * from public.update_calendar_event($1, $2::timestamptz, $3, $4::jsonb)`,
      [event.id, expected.toISOString(), scope, JSON.stringify(changes)],
    )
  ).rows[0]!;
const remove = async (id: string, scope: string) =>
  (
    await q<{ affected_count: number } & Record<string, unknown>>(
      `select * from public.delete_calendar_event($1, $2)`,
      [id, scope],
    )
  ).rows[0]!;

const insertIcs = (externalId: string, date: IsoDate) =>
  q(
    `insert into public.calendar_events (starts_at, ends_at, title, source, external_id)
     values ($1::timestamptz, $2::timestamptz, 'Imported', 'ics', $3)`,
    [at(date, 600), at(date, 720), externalId],
  );

describe('schema, privileges and function properties', () => {
  it('creates the series table with RLS and an index on (series_id, starts_at)', async () => {
    const table = await q<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.calendar_event_series'::regclass`,
    );
    expect(table.rows[0]!.relrowsecurity).toBe(true);
    const index = await q<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'calendar_events_series_start_idx'`,
    );
    expect(index.rows[0]!.indexdef).toContain('(series_id, starts_at)');
    const column = await q<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_name = 'calendar_events' and column_name = 'series_id'`,
    );
    expect(column.rows[0]!.is_nullable).toBe('YES');
  });

  it('keeps calendar_events privileges and policies unchanged', async () => {
    const grants = await q<{ privilege_type: string }>(
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
    const triggers = await q<{ tgname: string }>(
      `select tgname from pg_trigger where tgrelid = 'public.calendar_events'::regclass and not tgisinternal`,
    );
    expect(triggers.rows).toEqual([{ tgname: 'calendar_events_updated_at' }]);
  });

  it('gives the series table select-only access to authenticated and none to anon', async () => {
    const grants = await q<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'calendar_event_series'
         and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    );
    expect(grants.rows).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
  });

  const rpcs = [
    ['create_calendar_series', 'TABLE(series_id uuid, occurrence_count integer)'],
    ['update_calendar_event', 'TABLE(affected_count integer, series_id uuid)'],
    ['delete_calendar_event', 'TABLE(affected_count integer)'],
  ] as const;

  it.each(rpcs)(
    '%s is security definer with an empty search_path and exact types',
    async (name, result) => {
      const info = await q<{
        prosecdef: boolean;
        proconfig: string[];
        result: string;
        src: string;
      }>(
        `select prosecdef, proconfig, pg_get_function_result(oid) as result, prosrc as src
       from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
        [name],
      );
      const fn = info.rows[0]!;
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig).toContain('search_path=""');
      expect(fn.result).toBe(result);
      expect(fn.src).toContain('public.is_admin()');
      expect(fn.src).toContain('private.lock_schedule()');
    },
  );

  it.each(rpcs)('%s is executable by authenticated only', async (name) => {
    const allowed = await q<{ role: string; allowed: boolean }>(
      `select r as role, has_function_privilege(r, p.oid, 'execute') as allowed
       from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
       where p.proname = $1 and p.pronamespace = 'public'::regnamespace order by r`,
      [name],
    );
    expect(allowed.rows).toEqual([
      { role: 'anon', allowed: false },
      { role: 'authenticated', allowed: true },
      { role: 'service_role', allowed: false },
    ]);
  });

  it('hides the private helpers from the Data API roles', async () => {
    const helpers = await q<{ role: string; allowed: boolean }>(
      `select r as role, has_function_privilege(r, p.oid, 'execute') as allowed
       from pg_proc p, unnest(array['anon', 'authenticated']) r
       where p.pronamespace = 'private'::regnamespace
         and p.proname in ('json_int', 'json_date', 'local_minutes', 'assert_grid_minutes', 'assert_series_rule')`,
    );
    expect(helpers.rows).toHaveLength(10);
    expect(helpers.rows.every((row) => !row.allowed)).toBe(true);
  });

  it('takes the schedule advisory lock inside each RPC', async () => {
    const lockCount = async () =>
      (
        await q<{ n: number }>(
          `select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
        )
      ).rows[0]!.n;
    await asAdmin();
    await q('begin');
    expect(await lockCount()).toBe(0);
    await createDaily();
    expect(await lockCount()).toBe(1);
    await q('rollback');
    expect(await lockCount()).toBe(0);
    await reset();
  });
});

describe('access control', () => {
  it('lets only the admin read series and call the RPCs', async () => {
    await asAdmin();
    const created = await createDaily();
    const [first] = await events();
    await reset();
    await t.addTutee({ id: T1 });

    for (const role of ['anon', 'tutee'] as const) {
      if (role === 'anon') await asRole('anon');
      else await asRole('authenticated', T1);
      const outcomes = [
        await code(() => create([occurrence(day(2))], {}, 'x')),
        await code(() => update(first!, 'all', { title: 'x' })),
        await code(() => remove(first!.id, 'all')),
      ];
      expect(outcomes).toEqual(['42501', '42501', '42501']);
    }
    await asRole('anon');
    expect(await code(() => q(`select * from public.calendar_event_series`))).toBe('42501');
    await asRole('authenticated', T1);
    expect((await q(`select * from public.calendar_event_series`)).rows).toHaveLength(0);
    expect((await q(`select * from public.calendar_events`)).rows).toHaveLength(0);
    await asAdmin();
    expect((await seriesRows()).map((row) => row.id)).toEqual([created.series_id]);
    expect(await counts()).toEqual({ events: 8, series: 1 });
  });

  it('does not let the admin write the series table directly', async () => {
    await asAdmin();
    expect(
      await code(() => q(`insert into public.calendar_event_series (rule) values ('{}')`)),
    ).toBe('42501');
  });

  it('still lets the admin use the existing table path', async () => {
    await asAdmin();
    await q(
      `insert into public.calendar_events (starts_at, ends_at, title, source)
       values ($1::timestamptz, $2::timestamptz, 'Single', 'manual')`,
      [at(day(2), 600), at(day(2), 660)],
    );
    const [single] = await events();
    expect(single).toMatchObject({ title: 'Single', series_id: null });
    await q(`delete from public.calendar_events where id = $1`, [single!.id]);
    expect(await counts()).toEqual({ events: 0, series: 0 });
  });
});

describe('create_calendar_series', () => {
  it('stores the series and every occurrence atomically and returns the count', async () => {
    await asAdmin();
    const created = await createDaily();
    expect(created.occurrence_count).toBe(8);
    expect(created.series_id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await events();
    expect(rows).toHaveLength(8);
    expect(
      rows.every((row) => row.series_id === created.series_id && row.source === 'manual'),
    ).toBe(true);
    expect(rows.map((row) => row.local_date)).toEqual(
      Array.from({ length: 8 }, (_, index) => day(index + 1)),
    );
    expect(rows.every((row) => row.local_start === '10:00' && row.local_end === '11:00')).toBe(
      true,
    );
    expect(rows.every((row) => row.title === 'Badminton')).toBe(true);
    const [series] = await seriesRows();
    expect(series!.rule).toMatchObject({
      intervalWeeks: 1,
      startMinutes: 600,
      end: { kind: 'count' },
    });
  });

  it('accepts the boundaries: today, the last allowed date, 400 occurrences, a 200-character title', async () => {
    await asAdmin();
    const last = latestRecurrenceDate(today);
    const result = await create(
      [occurrence(today, 480, 510), occurrence(last, 1290, 1320)],
      {},
      'x'.repeat(200),
    );
    expect(result.occurrence_count).toBe(2);
    const many = await create(
      Array.from({ length: 400 }, (_, i) => occurrence(day(1 + (i % 300)))),
    );
    expect(many.occurrence_count).toBe(400);
    expect(await counts()).toEqual({ events: 402, series: 2 });
  });

  it('never rejects an event because of an accepted session or an existing event', async () => {
    await t.addTutee({ id: T1 });
    await q(
      `insert into public.session_requests (user_id, status, starts_at, ends_at, decided_at)
       values ($1, 'accepted', $2::timestamptz, $3::timestamptz, now())`,
      [T1, at(day(3), 600), at(day(3), 630)],
    );
    await asAdmin();
    await create([occurrence(day(2)), occurrence(day(3))]);
    await create([occurrence(day(2)), occurrence(day(3))]);
    expect(await counts()).toEqual({ events: 4, series: 2 });
    await reset();
    const accepted = await q<{ n: number }>(
      `select count(*)::int as n from public.session_requests where status = 'accepted'`,
    );
    expect(accepted.rows[0]!.n).toBe(1);
  });

  const valid = [occurrence(day(2)), occurrence(day(3))];
  const invalid: readonly (readonly [string, () => Promise<unknown>])[] = [
    ['a start before 08:00', () => create([...valid, occurrence(day(4), 450, 540)])],
    ['an end after 22:00', () => create([...valid, occurrence(day(4), 1260, 1350)])],
    ['an off-grid start', () => create([...valid, occurrence(day(4), 615, 660)])],
    ['an off-grid end', () => create([...valid, occurrence(day(4), 600, 665)])],
    ['an end before the start', () => create([...valid, occurrence(day(4), 660, 600)])],
    [
      'an occurrence spanning two dates',
      () => create([...valid, { startsAt: at(day(4), 1260), endsAt: at(day(5), 540) }]),
    ],
    ['a past occurrence', () => create([...valid, occurrence(day(-1))])],
    [
      'an occurrence past the 12-month horizon',
      () => create([...valid, occurrence(addDays(latestRecurrenceDate(today), 1))]),
    ],
    ['a single occurrence', () => create([occurrence(day(2))])],
    ['401 occurrences', () => create(Array.from({ length: 401 }, () => occurrence(day(2))))],
    [
      'no occurrences array',
      () =>
        q(`select * from public.create_calendar_series($1::jsonb, 'x', '{}'::jsonb)`, [
          JSON.stringify(dailyRule()),
        ]),
    ],
    ['a malformed occurrence', () => create([...valid, { startsAt: 'soon', endsAt: 'later' }])],
    [
      'an occurrence without times',
      () => create([...valid, {} as { startsAt: string; endsAt: string }]),
    ],
    ['a 201-character title', () => create(valid, {}, 'x'.repeat(201))],
    [
      'a null title',
      () =>
        q(`select * from public.create_calendar_series($1::jsonb, null, $2::jsonb)`, [
          JSON.stringify(dailyRule()),
          JSON.stringify(valid),
        ]),
    ],
    ['an interval of 13 weeks', () => create(valid, { intervalWeeks: 13 })],
    ['no weekdays', () => create(valid, { weekdays: [] })],
    ['weekday 8', () => create(valid, { weekdays: [8 as never] })],
    ['an off-grid rule time', () => create(valid, { startMinutes: 615 })],
    ['a rule ending before it starts', () => create(valid, { startMinutes: 700, endMinutes: 660 })],
    ['a rule count of 1', () => create(valid, { end: { kind: 'count', count: 1 } })],
    ['a start date in the past', () => create(valid, { startDate: day(-1) })],
    ['a start date after the first occurrence', () => create(valid, { startDate: day(3) })],
    [
      'a start date beyond the horizon',
      () => create(valid, { startDate: addDays(latestRecurrenceDate(today), 1) }),
    ],
    [
      'an end date before the start date',
      () => create(valid, { end: { kind: 'until', date: day(1) } }),
    ],
    [
      'an end date before the last occurrence',
      () => create(valid, { end: { kind: 'until', date: day(2) } }),
    ],
    [
      'an end date beyond the horizon',
      () =>
        create(valid, {
          end: { kind: 'until', date: addDays(latestRecurrenceDate(today), 1) },
        }),
    ],
    [
      'a count that differs from the occurrences',
      () => create(valid, { end: { kind: 'count', count: 3 } }),
    ],
    ['a count above the cap', () => create(valid, { end: { kind: 'count', count: 401 } })],
    ['a rule without end', () => create(valid, { ...dailyRule(), end: undefined })],
    [
      'a non-object rule',
      () =>
        q(`select * from public.create_calendar_series('[]'::jsonb, 'x', $1::jsonb)`, [
          JSON.stringify(valid),
        ]),
    ],
  ];

  it.each(invalid)('rejects %s and persists nothing', async (_name, run) => {
    await asAdmin();
    expect(await code(run)).toBe('22023');
    expect(await counts()).toEqual({ events: 0, series: 0 });
  });
});

describe('series order (series_index)', () => {
  const indexes = async () =>
    (
      await q<{ id: string; series_id: string; series_index: number } & Record<string, unknown>>(
        `select id, series_id, series_index from public.calendar_events order by series_index`,
      )
    ).rows;

  it('numbers occurrences chronologically from 0 whatever order they arrive in', async () => {
    await asAdmin();
    await create([occurrence(day(4)), occurrence(day(2)), occurrence(day(3))]);
    const rows = await events();
    const order = await indexes();
    expect(order.map((row) => row.series_index)).toEqual([0, 1, 2]);
    expect(order.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('accepts a rule with an end date on the last occurrence', async () => {
    await asAdmin();
    const result = await create([occurrence(day(2)), occurrence(day(3))], {
      end: { kind: 'until', date: day(3) },
    });
    expect(result.occurrence_count).toBe(2);
  });

  it('this and following on a later occurrence skips one that was moved past it', async () => {
    await asAdmin();
    const { series_id: oldId } = await createDaily();
    const rows = await events();
    await update(rows[1]!, 'this', { date: day(40) });
    const clicked = (await events()).find((row) => row.id === rows[5]!.id)!;
    const result = await update(clicked, 'following', { title: 'Tail' });
    expect(result.affected_count).toBe(3);
    const after = await events();
    expect(after.filter((row) => row.title === 'Tail').map((row) => row.id)).toEqual(
      rows.slice(5).map((row) => row.id),
    );
    const moved = after.find((row) => row.id === rows[1]!.id)!;
    expect(moved).toMatchObject({ title: 'Badminton', series_id: oldId, local_date: day(40) });
    const order = await indexes();
    expect(order.filter((row) => row.series_id === result.series_id)).toHaveLength(3);
    expect(
      order.filter((row) => row.series_id === result.series_id).map((r) => r.series_index),
    ).toEqual([5, 6, 7]);
    const old = (await seriesRows()).find((row) => row.id === oldId)!;
    expect(old.rule).toMatchObject({ end: { kind: 'until', date: day(40) } });
  });

  it('this and following on an earlier occurrence includes the ones after it, even the moved one', async () => {
    await asAdmin();
    const { series_id: oldId } = await createDaily();
    const rows = await events();
    await update(rows[0]!, 'this', { date: day(40) });
    const clicked = (await events()).find((row) => row.id === rows[2]!.id)!;
    const result = await update(clicked, 'following', { title: 'Rest' });
    expect(result.affected_count).toBe(6);
    const after = await events();
    expect(
      after
        .filter((row) => row.title === 'Rest')
        .map((row) => row.id)
        .sort(),
    ).toEqual(
      rows
        .slice(2)
        .map((row) => row.id)
        .sort(),
    );
    const untouched = after.filter((row) => row.series_id === oldId);
    expect(untouched.map((row) => row.id).sort()).toEqual([rows[0]!.id, rows[1]!.id].sort());
    expect(untouched.every((row) => row.title === 'Badminton')).toBe(true);
    const newRule = (await seriesRows()).find((row) => row.id === result.series_id)!.rule;
    expect(newRule).toMatchObject({ startDate: day(3), end: { kind: 'until', date: day(8) } });
    const oldRule = (await seriesRows()).find((row) => row.id === oldId)!.rule;
    expect(oldRule).toMatchObject({ end: { kind: 'until', date: day(40) } });
  });

  it('delete this and following uses the occurrence order after a move', async () => {
    await asAdmin();
    await createDaily();
    const rows = await events();
    await update(rows[0]!, 'this', { date: day(40) });
    const result = await remove(rows[3]!.id, 'following');
    expect(result.affected_count).toBe(5);
    const left = await events();
    expect(left.map((row) => row.id)).toEqual([rows[1]!.id, rows[2]!.id, rows[0]!.id]);
    const [rule] = await seriesRows();
    expect(rule!.rule).toMatchObject({ end: { kind: 'until', date: day(40) } });
  });

  it('rejects series rows without an index', async () => {
    await asAdmin();
    const { series_id: seriesId } = await createDaily();
    expect(
      await code(() =>
        q(
          `insert into public.calendar_events (starts_at, ends_at, title, source, series_id)
           values (now(), now() + interval '1 hour', 'x', 'manual', $1)`,
          [seriesId],
        ),
      ),
    ).toBe('23514');
  });
});

describe('update_calendar_event', () => {
  it('scope this: changes one event, keeps it in the series and returns the count', async () => {
    await asAdmin();
    const { series_id: seriesId } = await createDaily();
    const rows = await events();
    const result = await update(rows[2]!, 'this', {
      title: 'Moved',
      startMinutes: 720,
      endMinutes: 780,
    });
    expect(result).toEqual({ affected_count: 1, series_id: seriesId });
    const after = await events();
    expect(after[2]).toMatchObject({
      title: 'Moved',
      local_start: '12:00',
      local_end: '13:00',
      series_id: seriesId,
    });
    expect(after.filter((row) => row.title === 'Badminton')).toHaveLength(7);
    expect(after[3]!.local_start).toBe('10:00');
  });

  it('scope this: moves the event to another date and later scopes still reach it', async () => {
    await asAdmin();
    await createDaily();
    const rows = await events();
    await update(rows[1]!, 'this', { date: day(20) });
    const moved = (await events()).find((row) => row.id === rows[1]!.id)!;
    expect(moved.local_date).toBe(day(20));
    expect(moved.local_start).toBe('10:00');
    const result = await update(rows[0]!, 'all', { startMinutes: 840, endMinutes: 900 });
    expect(result.affected_count).toBe(8);
    const after = await events();
    expect(after.find((row) => row.id === moved.id)).toMatchObject({
      local_date: day(20),
      local_start: '14:00',
      local_end: '15:00',
    });
    expect(after.every((row) => row.local_start === '14:00')).toBe(true);
  });

  it('scope all: updates every row and the display rule, keeping individual titles unless changed', async () => {
    await asAdmin();
    const { series_id: seriesId } = await createDaily();
    const rows = await events();
    await update(rows[4]!, 'this', { title: 'Own title' });
    const fresh = (await events()).find((row) => row.id === rows[0]!.id)!;
    const result = await update(fresh, 'all', { startMinutes: 570, endMinutes: 690 });
    expect(result).toEqual({ affected_count: 8, series_id: seriesId });
    let after = await events();
    expect(after.every((row) => row.local_start === '09:30' && row.local_end === '11:30')).toBe(
      true,
    );
    expect(after.filter((row) => row.title === 'Own title')).toHaveLength(1);
    expect((await seriesRows())[0]!.rule).toMatchObject({ startMinutes: 570, endMinutes: 690 });

    await update(after[0]!, 'all', { title: 'Everything' });
    after = await events();
    expect(after.every((row) => row.title === 'Everything')).toBe(true);
  });

  it('scope following: splits the series at the clicked event', async () => {
    await asAdmin();
    const { series_id: oldId } = await createDaily();
    const rows = await events();
    const result = await update(rows[3]!, 'following', {
      title: 'Later',
      startMinutes: 1080,
      endMinutes: 1140,
    });
    expect(result.affected_count).toBe(5);
    expect(result.series_id).not.toBe(oldId);
    const after = await events();
    expect(
      after
        .slice(0, 3)
        .every(
          (row) =>
            row.series_id === oldId && row.title === 'Badminton' && row.local_start === '10:00',
        ),
    ).toBe(true);
    expect(
      after
        .slice(3)
        .every(
          (row) =>
            row.series_id === result.series_id &&
            row.title === 'Later' &&
            row.local_start === '18:00',
        ),
    ).toBe(true);
    const series = await seriesRows();
    expect(series).toHaveLength(2);
    const oldRule = series.find((row) => row.id === oldId)!.rule;
    const newRule = series.find((row) => row.id === result.series_id)!.rule;
    expect(oldRule).toMatchObject({ startMinutes: 600, end: { kind: 'until', date: day(3) } });
    expect(newRule).toMatchObject({
      startDate: day(4),
      startMinutes: 1080,
      endMinutes: 1140,
      end: { kind: 'until', date: day(8) },
    });
  });

  it('scope following on the first event is the same as all, without a split', async () => {
    await asAdmin();
    const { series_id: seriesId } = await createDaily();
    const rows = await events();
    const result = await update(rows[0]!, 'following', { title: 'Whole' });
    expect(result).toEqual({ affected_count: 8, series_id: seriesId });
    expect(await counts()).toEqual({ events: 8, series: 1 });
  });

  it('keeps wall-clock times across both Brussels clock changes', async () => {
    await reset();
    const series = await q<{ id: string }>(
      `insert into public.calendar_event_series (rule) values ($1::jsonb) returning id`,
      [JSON.stringify(dailyRule({ startDate: '2027-03-27', startMinutes: 540, endMinutes: 600 }))],
    );
    const seriesId = series.rows[0]!.id;
    const dates = [
      '2027-03-27',
      '2027-03-28',
      '2027-03-29',
      '2027-10-30',
      '2027-10-31',
      '2027-11-01',
    ];
    for (const [index, date] of dates.entries()) {
      await q(
        `insert into public.calendar_events (starts_at, ends_at, title, source, series_id, series_index)
         values (($1 || ' 09:00')::timestamp at time zone 'Europe/Brussels',
                 ($1 || ' 10:00')::timestamp at time zone 'Europe/Brussels', 'DST', 'manual', $2, $3)`,
        [date, seriesId, index],
      );
    }
    await asAdmin();
    const rows = await events();
    const result = await update(rows[0]!, 'all', { startMinutes: 630, endMinutes: 690 });
    expect(result.affected_count).toBe(6);
    const utc = await q<{ local_date: string; utc: string; local_start: string }>(
      `select to_char(starts_at at time zone 'Europe/Brussels', 'YYYY-MM-DD') as local_date,
              to_char(starts_at at time zone 'UTC', 'HH24:MI') as utc,
              to_char(starts_at at time zone 'Europe/Brussels', 'HH24:MI') as local_start
       from public.calendar_events order by starts_at`,
    );
    expect(utc.rows.map((row) => `${row.local_date} ${row.local_start} ${row.utc}`)).toEqual([
      '2027-03-27 10:30 09:30',
      '2027-03-28 10:30 08:30',
      '2027-03-29 10:30 08:30',
      '2027-10-30 10:30 08:30',
      '2027-10-31 10:30 09:30',
      '2027-11-01 10:30 09:30',
    ]);
  });

  it('rejects a stale version for the clicked row without partial writes', async () => {
    await asAdmin();
    await createDaily();
    const rows = await events();
    const clicked = rows[2]!;
    await update(clicked, 'this', { title: 'Someone else' });
    expect(
      await code(() =>
        update(clicked, 'all', { title: 'Stale', startMinutes: 900, endMinutes: 960 }),
      ),
    ).toBe('40001');
    const after = await events();
    expect(after.filter((row) => row.title === 'Stale')).toHaveLength(0);
    expect(after.filter((row) => row.local_start === '10:00')).toHaveLength(8);
  });

  it('compares the version to the millisecond the client sees', async () => {
    await asAdmin();
    await createDaily();
    const [first] = await events();
    const sameMs = new Date(Math.floor(first!.updated_at.getTime()));
    expect((await update(first!, 'this', { title: 'ms' }, sameMs)).affected_count).toBe(1);
    expect(
      await code(() => update(first!, 'this', { title: 'again' }, new Date(sameMs.getTime() - 1))),
    ).toBe('40001');
  });

  const failures: readonly (readonly [string, string, Record<string, unknown>, string])[] = [
    ['a date with scope following', 'following', { date: day(30) }, '22023'],
    ['a date with scope all', 'all', { date: day(30) }, '22023'],
    ['a date before today', 'this', { date: day(-1) }, '22023'],
    ['a date past the horizon', 'this', { date: addDays(latestRecurrenceDate(today), 1) }, '22023'],
    ['a malformed date', 'this', { date: '2027-13-40' }, '22023'],
    ['an unknown key', 'this', { color: 'red' }, '22023'],
    ['a start before 08:00', 'this', { startMinutes: 450 }, '22023'],
    ['an end after 22:00', 'all', { endMinutes: 1350 }, '22023'],
    ['an off-grid start', 'this', { startMinutes: 615 }, '22023'],
    ['a fractional start', 'this', { startMinutes: 600.5 }, '22023'],
    ['an end before the start', 'this', { startMinutes: 720 }, '22023'],
    ['a start after every end in a series', 'all', { startMinutes: 1260 }, '22023'],
    ['a 201-character title', 'this', { title: 'x'.repeat(201) }, '22023'],
    ['a non-string title', 'this', { title: 5 }, '22023'],
    ['an invalid scope', 'everything', { title: 'x' }, '22023'],
  ];

  it.each(failures)(
    'rejects %s without changing anything',
    async (_name, scope, changes, expected) => {
      await asAdmin();
      await createDaily();
      const before = await events();
      expect(await code(() => update(before[3]!, scope, changes))).toBe(expected);
      expect(await events()).toEqual(before);
    },
  );

  it('reports a missing event and treats a null body as invalid', async () => {
    await asAdmin();
    await createDaily();
    const [first] = await events();
    expect(
      await code(() =>
        update({ ...first!, id: '00000000-0000-0000-0000-00000000dead' }, 'this', { title: 'x' }),
      ),
    ).toBe('P0002');
    expect(
      await code(() =>
        q(`select * from public.update_calendar_event($1, $2::timestamptz, 'this', null)`, [
          first!.id,
          first!.updated_at.toISOString(),
        ]),
      ),
    ).toBe('22023');
  });

  it('only accepts scope this for single events and never edits imported ones', async () => {
    await reset();
    await q(
      `insert into public.calendar_events (starts_at, ends_at, title, source)
       values ($1::timestamptz, $2::timestamptz, 'Single', 'manual')`,
      [at(day(2), 600), at(day(2), 660)],
    );
    await insertIcs('uid#1', day(3));
    await asAdmin();
    const [single, imported] = await events();
    expect(await code(() => update(single!, 'all', { title: 'x' }))).toBe('22023');
    expect(await code(() => update(single!, 'following', { title: 'x' }))).toBe('22023');
    expect(await code(() => update(imported!, 'this', { title: 'x' }))).toBe('22023');
    expect(
      (await update(single!, 'this', { title: 'Renamed', startMinutes: 660, endMinutes: 720 }))
        .affected_count,
    ).toBe(1);
    expect((await events())[0]).toMatchObject({
      title: 'Renamed',
      local_start: '11:00',
      series_id: null,
    });
    expect((await events())[1]).toMatchObject({ title: 'Imported', local_start: '10:00' });
  });
});

describe('delete_calendar_event', () => {
  it('scope this: removes one event and keeps the series', async () => {
    await asAdmin();
    const { series_id: seriesId } = await createDaily();
    const rows = await events();
    expect(await remove(rows[2]!.id, 'this')).toEqual({ affected_count: 1 });
    const after = await events();
    expect(after).toHaveLength(7);
    expect(after.every((row) => row.series_id === seriesId)).toBe(true);
    expect((await seriesRows()).map((row) => row.id)).toEqual([seriesId]);
  });

  it('scope following: removes the clicked and later events and ends the rule the day before', async () => {
    await asAdmin();
    const { series_id: seriesId } = await createDaily();
    const rows = await events();
    expect(await remove(rows[5]!.id, 'following')).toEqual({ affected_count: 3 });
    expect((await events()).map((row) => row.local_date)).toEqual([1, 2, 3, 4, 5].map(day));
    expect((await seriesRows())[0]).toMatchObject({
      id: seriesId,
      rule: { end: { kind: 'until', date: day(5) } },
    });
  });

  it('scope following on the first event removes the whole series row too', async () => {
    await asAdmin();
    await createDaily();
    const rows = await events();
    expect(await remove(rows[0]!.id, 'following')).toEqual({ affected_count: 8 });
    expect(await counts()).toEqual({ events: 0, series: 0 });
  });

  it('scope all: removes every event, including moved ones, and the empty series', async () => {
    await asAdmin();
    await createDaily();
    const keep = await create([occurrence(day(2)), occurrence(day(3))], {}, 'Other series');
    const rows = await events();
    const badminton = rows.filter((row) => row.title === 'Badminton');
    await update(badminton[1]!, 'this', { date: day(40) });
    expect(await remove(badminton[0]!.id, 'all')).toEqual({ affected_count: 8 });
    expect(await counts()).toEqual({ events: 2, series: 1 });
    expect((await seriesRows())[0]!.id).toBe(keep.series_id);
  });

  it('deleting the last remaining event with scope this removes its empty series', async () => {
    await asAdmin();
    await create([occurrence(day(2)), occurrence(day(3))]);
    const rows = await events();
    await remove(rows[0]!.id, 'this');
    expect(await counts()).toEqual({ events: 1, series: 1 });
    await remove(rows[1]!.id, 'this');
    expect(await counts()).toEqual({ events: 0, series: 0 });
  });

  it('removes single and imported events with scope this only', async () => {
    await reset();
    await insertIcs('uid#1', day(2));
    await insertIcs('uid#2', day(3));
    await q(
      `insert into public.calendar_events (starts_at, ends_at, title, source)
       values ($1::timestamptz, $2::timestamptz, 'Single', 'manual')`,
      [at(day(4), 600), at(day(4), 660)],
    );
    await asAdmin();
    const rows = await events();
    for (const scope of ['following', 'all']) {
      expect(await code(() => remove(rows[0]!.id, scope))).toBe('22023');
      expect(await code(() => remove(rows[2]!.id, scope))).toBe('22023');
    }
    expect(await counts()).toEqual({ events: 3, series: 0 });
    expect(await remove(rows[0]!.id, 'this')).toEqual({ affected_count: 1 });
    expect(await remove(rows[2]!.id, 'this')).toEqual({ affected_count: 1 });
    expect((await events()).map((row) => row.title)).toEqual(['Imported']);
  });

  it('reports a missing event and an invalid scope without deleting', async () => {
    await asAdmin();
    await createDaily();
    const [first] = await events();
    expect(await code(() => remove('00000000-0000-0000-0000-00000000dead', 'this'))).toBe('P0002');
    expect(await code(() => remove(first!.id, 'some'))).toBe('22023');
    expect(await counts()).toEqual({ events: 8, series: 1 });
  });

  it('cascades the events when a series row is deleted by the owner', async () => {
    await asAdmin();
    const { series_id: seriesId } = await createDaily();
    await reset();
    await q(`delete from public.calendar_event_series where id = $1`, [seriesId]);
    expect(await counts()).toEqual({ events: 0, series: 0 });
  });
});

describe('re-running the migration', () => {
  it('is idempotent and keeps existing series and events', async () => {
    const { series_id } = await createDaily();
    await t.db.exec(MIGRATIONS.recurring);
    const rows = await q(`select id from public.calendar_events where series_id = $1`, [series_id]);
    expect(rows.rows).toHaveLength(8);
    expect(await code(() => createDaily())).toBe('ok');
  });
});

describe('unaffected behaviour', () => {
  it('shows tutees only merged anonymous intervals for series and imported events', async () => {
    await t.addTutee({ id: T1 });
    await asAdmin();
    await createDaily('Secret badminton');
    await reset();
    await insertIcs('uid#1', day(2));
    await asRole('authenticated', T1);
    const result = await q<{ starts_at: Date; ends_at: Date }>(
      `select * from public.get_blocked_intervals($1::timestamptz, $2::timestamptz)`,
      [at(day(0), 0), at(day(10), 0)],
    );
    expect(result.fields.map((field) => field.name)).toEqual(['starts_at', 'ends_at']);
    // Eight daily 10:00-11:00 events; the imported 10:00-12:00 event extends the first day's block.
    expect(result.rows).toHaveLength(8);
    expect(JSON.stringify(result.rows)).not.toContain('Secret');
  });

  it('still rejects session requests that overlap a series event, and allows free slots', async () => {
    await t.addTutee({ id: T1 });
    await asAdmin();
    await create([occurrence(day(5)), occurrence(day(6))]);
    await asRole('authenticated', T1);
    const request = (start: number) =>
      q(`select * from public.create_session_request($1::timestamptz, $2::timestamptz)`, [
        at(day(5), start),
        at(day(5), start + 30),
      ]);
    expect(await code(() => request(600))).toBe('TR002');
    expect(await code(() => request(720))).toBe('ok');
  });

  it('keeps imported events free of series links', async () => {
    await asAdmin();
    await createDaily();
    await reset();
    await insertIcs('uid#9', day(2));
    const rows = await events();
    expect(rows.filter((row) => row.source === 'ics').map((row) => row.series_id)).toEqual([null]);
  });
});
