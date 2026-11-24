import { describe, expect, it } from 'vitest';
import { MAX_ICS_BYTES } from '../../core/domain/calendar-event';
import { IcalJsParser } from './ical-js-parser';

const OPTIONS = { from: '2026-11-01T00:00:00Z', to: '2027-11-01T00:00:00Z' };
const parser = new IcalJsParser();

function calendar(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join(
    '\r\n',
  );
}

function event(...lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

const BRUSSELS_TZ = [
  'BEGIN:VTIMEZONE',
  'TZID:Romance Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

async function parse(text: string) {
  const result = await parser.parse(text, OPTIONS);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('IcalJsParser', () => {
  it('reads an Outlook event with a VTIMEZONE (winter time)', async () => {
    const parsed = await parse(
      calendar(
        BRUSSELS_TZ,
        event(
          'UID:out-1',
          'SUMMARY:Maths class',
          'DESCRIPTION:secret notes',
          'LOCATION:Room 4',
          'ATTENDEE:mailto:someone@example.test',
          'DTSTART;TZID=Romance Standard Time:20261124T140000',
          'DTEND;TZID=Romance Standard Time:20261124T153000',
        ),
      ),
    );
    expect(parsed.occurrences).toEqual([
      {
        title: 'Maths class',
        startsAt: '2026-11-24T13:00:00Z',
        endsAt: '2026-11-24T14:30:00Z',
        externalId: 'out-1#2026-11-24T13:00:00Z',
      },
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/secret|Room 4|someone/);
  });

  it('applies summer time from the VTIMEZONE', async () => {
    const parsed = await parse(
      calendar(
        BRUSSELS_TZ,
        event(
          'UID:out-2',
          'SUMMARY:Summer',
          'DTSTART;TZID=Romance Standard Time:20270615T140000',
          'DTEND;TZID=Romance Standard Time:20270615T150000',
        ),
      ),
    );
    expect(parsed.occurrences[0]?.startsAt).toBe('2027-06-15T12:00:00Z');
  });

  it('reads UTC times from Google Calendar', async () => {
    const parsed = await parse(
      calendar(
        event('UID:g-1', 'SUMMARY:Google', 'DTSTART:20261124T090000Z', 'DTEND:20261124T100000Z'),
      ),
    );
    expect(parsed.occurrences[0]).toMatchObject({
      startsAt: '2026-11-24T09:00:00Z',
      endsAt: '2026-11-24T10:00:00Z',
    });
  });

  it('reads floating times as Brussels wall time', async () => {
    const parsed = await parse(
      calendar(
        event('UID:f-1', 'SUMMARY:Floating', 'DTSTART:20270615T140000', 'DTEND:20270615T150000'),
      ),
    );
    expect(parsed.occurrences[0]?.startsAt).toBe('2027-06-15T12:00:00Z');
  });

  it('reads all-day events as whole Brussels days', async () => {
    const parsed = await parse(
      calendar(
        event(
          'UID:a-1',
          'SUMMARY:Holiday',
          'DTSTART;VALUE=DATE:20261125',
          'DTEND;VALUE=DATE:20261126',
        ),
      ),
    );
    expect(parsed.occurrences[0]).toMatchObject({
      startsAt: '2026-11-24T23:00:00Z',
      endsAt: '2026-11-25T23:00:00Z',
    });
  });

  it('uses a known IANA zone without a VTIMEZONE', async () => {
    const parsed = await parse(
      calendar(
        event(
          'UID:i-1',
          'SUMMARY:NY',
          'DTSTART;TZID=America/New_York:20261124T090000',
          'DTEND;TZID=America/New_York:20261124T100000',
        ),
      ),
    );
    expect(parsed.occurrences[0]?.startsAt).toBe('2026-11-24T14:00:00Z');
    expect(parsed.warnings).toEqual([]);
  });

  it('warns and uses Brussels for an unknown time zone', async () => {
    const parsed = await parse(
      calendar(
        event(
          'UID:u-1',
          'SUMMARY:Odd',
          'DTSTART;TZID=Mars/Olympus:20261124T090000',
          'DTEND;TZID=Mars/Olympus:20261124T100000',
        ),
      ),
    );
    expect(parsed.occurrences[0]?.startsAt).toBe('2026-11-24T08:00:00Z');
    expect(parsed.warnings).toContain('unknown-time-zone');
  });

  it('expands RRULE honouring EXDATE and overrides', async () => {
    const parsed = await parse(
      calendar(
        event(
          'UID:r-1',
          'SUMMARY:Weekly',
          'DTSTART:20261124T090000Z',
          'DTEND:20261124T100000Z',
          'RRULE:FREQ=WEEKLY;COUNT=4',
          'EXDATE:20261201T090000Z',
        ),
        event(
          'UID:r-1',
          'SUMMARY:Moved',
          'RECURRENCE-ID:20261208T090000Z',
          'DTSTART:20261208T120000Z',
          'DTEND:20261208T130000Z',
        ),
      ),
    );
    expect(parsed.occurrences.map((o) => [o.title, o.startsAt])).toEqual([
      ['Weekly', '2026-11-24T09:00:00Z'],
      ['Moved', '2026-12-08T12:00:00Z'],
      ['Weekly', '2026-12-15T09:00:00Z'],
    ]);
  });

  it('stops repeating events at the 12-month limit', async () => {
    const parsed = await parse(
      calendar(
        event(
          'UID:r-2',
          'SUMMARY:Forever',
          'DTSTART:20261124T090000Z',
          'DTEND:20261124T100000Z',
          'RRULE:FREQ=WEEKLY',
        ),
      ),
    );
    expect(parsed.occurrences.length).toBeGreaterThan(40);
    expect(parsed.occurrences.at(-1)?.startsAt.startsWith('2027-10')).toBe(true);
  });

  it('skips cancelled, free, past, too long and beyond-limit events', async () => {
    const parsed = await parse(
      calendar(
        event(
          'UID:s-1',
          'SUMMARY:C',
          'STATUS:CANCELLED',
          'DTSTART:20261124T090000Z',
          'DTEND:20261124T100000Z',
        ),
        event(
          'UID:s-2',
          'SUMMARY:T',
          'TRANSP:TRANSPARENT',
          'DTSTART:20261124T090000Z',
          'DTEND:20261124T100000Z',
        ),
        event('UID:s-3', 'SUMMARY:P', 'DTSTART:20260101T090000Z', 'DTEND:20260101T100000Z'),
        event('UID:s-4', 'SUMMARY:L', 'DTSTART:20261124T090000Z', 'DTEND:20270124T090000Z'),
        event('UID:s-5', 'SUMMARY:B', 'DTSTART:20271124T090000Z', 'DTEND:20271124T100000Z'),
      ),
    );
    expect(parsed.occurrences).toEqual([]);
    expect(parsed.skipped.map((s) => [s.title, s.reason])).toEqual([
      ['C', 'cancelled'],
      ['T', 'transparent'],
      ['P', 'past'],
      ['L', 'too-long'],
      ['B', 'beyond-limit'],
    ]);
  });

  it('caps the number of occurrences and warns', async () => {
    const parsed = await parse(
      calendar(
        event(
          'UID:d-1',
          'SUMMARY:Daily',
          'DTSTART:20261124T090000Z',
          'DTEND:20261124T091000Z',
          'RRULE:FREQ=DAILY',
        ),
        event(
          'UID:d-2',
          'SUMMARY:Hourly',
          'DTSTART:20261124T090000Z',
          'DTEND:20261124T091000Z',
          'RRULE:FREQ=HOURLY',
        ),
      ),
    );
    expect(parsed.occurrences.length).toBeLessThanOrEqual(2000);
    expect(parsed.warnings).toContain('occurrence-limit');
  });

  it('rejects text that is not a calendar', async () => {
    const result = await parser.parse('hello world', OPTIONS);
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  it('rejects oversized input', async () => {
    const result = await parser.parse('x'.repeat(MAX_ICS_BYTES + 1), OPTIONS);
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  it('does not leak registered time zones between files', async () => {
    await parse(calendar(BRUSSELS_TZ));
    const parsed = await parse(
      calendar(
        event(
          'UID:z-1',
          'SUMMARY:After',
          'DTSTART;TZID=Romance Standard Time:20261124T140000',
          'DTEND;TZID=Romance Standard Time:20261124T150000',
        ),
      ),
    );
    expect(parsed.warnings).toContain('unknown-time-zone');
  });
});
