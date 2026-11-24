import { describe, expect, it } from 'vitest';
import { mapEventRows, mapIntervalRows, mapSupabaseError } from './rows';

describe('mapEventRows', () => {
  it('maps valid rows to canonical domain events', () => {
    const result = mapEventRows([
      {
        id: 'e1',
        starts_at: '2026-01-05T10:00:00+00:00',
        ends_at: '2026-01-05T11:00:00.000Z',
        title: 'Maths',
        source: 'ics',
        external_id: 'uid#1',
      },
      {
        id: 'e2',
        starts_at: '2026-01-06T10:00:00Z',
        ends_at: '2026-01-06T11:00:00Z',
        title: '',
        source: 'manual',
        external_id: null,
      },
    ]);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 'e1',
          startsAt: '2026-01-05T10:00:00Z',
          endsAt: '2026-01-05T11:00:00Z',
          title: 'Maths',
          source: 'ics',
          externalId: 'uid#1',
        },
        {
          id: 'e2',
          startsAt: '2026-01-06T10:00:00Z',
          endsAt: '2026-01-06T11:00:00Z',
          title: '',
          source: 'manual',
        },
      ],
    });
  });

  it.each([
    ['not an array', {}],
    ['missing field', [{ id: 'e1' }]],
    [
      'bad timestamp',
      [{ id: 'e', starts_at: 'x', ends_at: 'y', title: '', source: 'manual', external_id: null }],
    ],
    [
      'unknown source',
      [
        {
          id: 'e',
          starts_at: '2026-01-05T10:00:00Z',
          ends_at: '2026-01-05T11:00:00Z',
          title: '',
          source: 'other',
          external_id: null,
        },
      ],
    ],
  ])('rejects malformed rows (%s) as unavailable', (_name, rows) => {
    expect(mapEventRows(rows)).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});

describe('mapIntervalRows', () => {
  it('maps intervals and rejects extra-shaped garbage', () => {
    expect(
      mapIntervalRows([{ starts_at: '2026-01-05T10:00:00Z', ends_at: '2026-01-05T11:00:00Z' }]),
    ).toEqual({
      ok: true,
      value: [{ startsAt: '2026-01-05T10:00:00Z', endsAt: '2026-01-05T11:00:00Z' }],
    });
    expect(mapIntervalRows([{ starts_at: 1 }])).toMatchObject({ ok: false });
  });
});

describe('mapSupabaseError', () => {
  it.each([
    ['42501', 'forbidden'],
    ['PGRST301', 'forbidden'],
    ['23505', 'conflict'],
    ['22023', 'validation'],
    ['23514', 'validation'],
    ['08006', 'unavailable'],
    [undefined, 'unavailable'],
  ] as const)('maps %s to %s', (code, kind) => {
    expect(mapSupabaseError({ code, message: 'raw backend text' }).kind).toBe(kind);
  });

  it('never leaks the backend message', () => {
    expect(mapSupabaseError({ code: '42501', message: 'secret detail' }).message).not.toContain(
      'secret',
    );
  });
});
