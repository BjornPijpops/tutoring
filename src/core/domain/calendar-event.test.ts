import { describe, expect, it } from 'vitest';
import { buildIcsPreview, validateNewEvent, type ParsedIcs } from './calendar-event';

const base = { startsAt: '2026-01-05T10:00:00Z', endsAt: '2026-01-05T11:00:00Z' };

describe('validateNewEvent', () => {
  it('accepts valid manual and imported events', () => {
    expect(validateNewEvent({ ...base, title: '', source: 'manual' })).toBeUndefined();
    expect(
      validateNewEvent({ ...base, title: 'x', source: 'ics', externalId: 'uid#1' }),
    ).toBeUndefined();
  });

  it.each([
    ['reversed', { startsAt: base.endsAt, endsAt: base.startsAt, title: '', source: 'manual' }],
    [
      'longer than 31 days',
      { startsAt: base.startsAt, endsAt: '2026-03-01T00:00:00Z', title: '', source: 'manual' },
    ],
    ['too long title', { ...base, title: 'x'.repeat(201), source: 'manual' }],
    ['manual with externalId', { ...base, title: '', source: 'manual', externalId: 'a' }],
    ['imported without externalId', { ...base, title: '', source: 'ics' }],
  ] as const)('rejects %s', (_name, event) => {
    expect(validateNewEvent(event)).toEqual(expect.any(String));
  });
});

describe('buildIcsPreview', () => {
  const parsed: ParsedIcs = {
    occurrences: [
      { ...base, title: 'A', externalId: 'a#1' },
      { ...base, title: 'B', externalId: 'b#1' },
      { ...base, title: 'B again', externalId: 'b#1' },
    ],
    skipped: [{ ...base, title: 'C', reason: 'cancelled' }],
    warnings: ['unknown-time-zone'],
    importedUntil: '2027-01-05T00:00:00Z',
  };

  it('counts new events, duplicates and skipped reasons', () => {
    const preview = buildIcsPreview(parsed, new Set(['a#1']));

    expect(preview).toMatchObject({
      found: 4,
      newCount: 1,
      duplicateCount: 2,
      skippedCount: 1,
      skippedByReason: { cancelled: 1 },
      warnings: ['unknown-time-zone'],
    });
    expect(preview.toAdd.map((event) => event.externalId)).toEqual(['b#1']);
    expect(preview.rows.map((row) => row.status).sort()).toEqual([
      'duplicate',
      'duplicate',
      'new',
      'skipped',
    ]);
  });
});
