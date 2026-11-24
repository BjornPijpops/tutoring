import type ICALType from 'ical.js';
import {
  ICS_MAX_OCCURRENCES,
  MAX_EVENT_DAYS,
  MAX_ICS_BYTES,
  MAX_TITLE_LENGTH,
  type IcsOccurrence,
  type IcsWarning,
  type ParsedIcs,
  type SkippedOccurrence,
} from '../../core/domain/calendar-event';
import { fromMs, toMs, type IsoDateTime } from '../../core/domain/interval';
import { wallTimeToInstant } from '../../core/domain/local-time';
import { err, ok } from '../../core/domain/result';
import { TUTOR_TIME_ZONE } from '../../core/domain/tutoring-hours';
import type { IcsParseOptions, IcsParser, PortResult } from '../../core/ports';

type Ical = typeof ICALType;
type IcalTime = InstanceType<Ical['Time']>;
type IcalComponent = InstanceType<Ical['Component']>;
type IcalEvent = InstanceType<Ical['Event']>;

const DAY_MS = 86_400_000;
/** Upper bound on iterator steps per repeating series; protects against runaway rules. */
const MAX_STEPS_PER_SERIES = 5000;

/** How the wall clock of a time value maps to an instant. */
type ZoneMode =
  | { readonly kind: 'native' }
  | { readonly kind: 'wall'; readonly timeZone: string; readonly unknown: boolean };

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * {@link IcsParser} on `ical.js`, loaded on demand so it stays out of the main bundle.
 * Only the title and times are read; every other property is ignored and nothing is kept.
 */
export class IcalJsParser implements IcsParser {
  async parse(text: string, options: IcsParseOptions): PortResult<ParsedIcs> {
    if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) {
      return err({ kind: 'validation', message: 'The calendar file is too large.' });
    }
    try {
      const { default: ICAL } = await import('ical.js');
      return ok(readCalendar(ICAL, text, options));
    } catch {
      return err({ kind: 'validation', message: 'The calendar file could not be read.' });
    }
  }
}

function readCalendar(ICAL: Ical, text: string, options: IcsParseOptions): ParsedIcs {
  const calendar = new ICAL.Component(ICAL.parse(text) as unknown[]);
  if (calendar.name !== 'vcalendar') throw new Error('Not a calendar');

  ICAL.TimezoneService.reset();
  try {
    calendar.getAllSubcomponents('vtimezone').forEach((zone) => {
      ICAL.TimezoneService.register(zone);
    });
    return new Reader(ICAL, options).read(calendar);
  } finally {
    ICAL.TimezoneService.reset();
  }
}

class Reader {
  private readonly occurrences: IcsOccurrence[] = [];
  private readonly skipped: SkippedOccurrence[] = [];
  private readonly warnings = new Set<IcsWarning>();
  private readonly windowStart: number;
  private readonly windowEnd: number;
  private emitted = 0;

  constructor(
    private readonly ICAL: Ical,
    private readonly options: IcsParseOptions,
  ) {
    this.windowStart = toMs(options.from);
    this.windowEnd = toMs(options.to);
  }

  read(calendar: IcalComponent): ParsedIcs {
    const byUid = new Map<string, IcalComponent[]>();
    calendar.getAllSubcomponents('vevent').forEach((component, index) => {
      const uid = asString(component.getFirstPropertyValue('uid')) || `no-uid-${String(index)}`;
      byUid.set(uid, [...(byUid.get(uid) ?? []), component]);
    });

    for (const [uid, components] of byUid) {
      if (this.limitReached()) break;
      const master = components.find((c) => !c.hasProperty('recurrence-id'));
      const exceptions = components.filter((c) => c.hasProperty('recurrence-id'));
      if (master) {
        this.readSeries(uid, master, exceptions);
      } else {
        exceptions.forEach((component) => {
          this.readSingle(uid, new this.ICAL.Event(component));
        });
      }
    }

    this.occurrences.sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt));
    return {
      occurrences: this.occurrences,
      skipped: this.skipped,
      warnings: [...this.warnings],
      importedUntil: this.options.to,
    };
  }

  private limitReached(): boolean {
    if (this.emitted < ICS_MAX_OCCURRENCES) return false;
    this.warnings.add('occurrence-limit');
    return true;
  }

  private readSeries(uid: string, master: IcalComponent, exceptions: IcalComponent[]): void {
    const event = new this.ICAL.Event(master, { exceptions });
    if (!event.isRecurring()) {
      this.readSingle(uid, event);
      return;
    }

    const iterator = event.iterator();
    for (let steps = 0; steps < MAX_STEPS_PER_SERIES; steps += 1) {
      const next = iterator.next();
      // ical.js returns undefined at the end of a finite series, despite its typings
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!next) return;
      if (this.instantOf(next, event) >= this.windowEnd) return;
      if (this.limitReached()) return;
      const details = event.getOccurrenceDetails(next);
      this.record(uid, details.item, details.startDate, details.endDate);
    }
    this.warnings.add('occurrence-limit');
  }

  private readSingle(uid: string, event: IcalEvent): void {
    if (this.limitReached()) return;
    this.record(uid, event, event.startDate, event.endDate);
  }

  private record(uid: string, event: IcalEvent, start: IcalTime, end: IcalTime): void {
    const startMs = this.instantOf(start, event);
    const endMs = this.instantOf(end, event);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

    const startsAt = fromMs(startMs);
    const endsAt = fromMs(endMs);
    const title = asString(event.summary).trim().slice(0, MAX_TITLE_LENGTH);
    const reason = this.skipReason(event, startMs, endMs);
    if (reason !== 'past') this.emitted += 1;

    if (reason) {
      this.skipped.push({ title, startsAt, endsAt, reason });
      return;
    }
    this.occurrences.push({ title, startsAt, endsAt, externalId: `${uid}#${startsAt}` });
  }

  private skipReason(
    event: IcalEvent,
    startMs: number,
    endMs: number,
  ): SkippedOccurrence['reason'] | undefined {
    const status = asString(event.component.getFirstPropertyValue('status')).toUpperCase();
    const transparency = asString(event.component.getFirstPropertyValue('transp')).toUpperCase();
    if (status === 'CANCELLED') return 'cancelled';
    if (transparency === 'TRANSPARENT') return 'transparent';
    if (endMs <= this.windowStart) return 'past';
    if (startMs >= this.windowEnd) return 'beyond-limit';
    if (endMs - startMs > MAX_EVENT_DAYS * DAY_MS) return 'too-long';
    return undefined;
  }

  private zoneModeOf(event: IcalEvent): ZoneMode {
    const tzid = event.component.getFirstProperty('dtstart')?.getParameter('tzid');
    if (typeof tzid !== 'string' || tzid === '') return { kind: 'native' };
    if (this.ICAL.TimezoneService.has(tzid)) return { kind: 'native' };
    if (isKnownTimeZone(tzid)) return { kind: 'wall', timeZone: tzid, unknown: false };
    return { kind: 'wall', timeZone: TUTOR_TIME_ZONE, unknown: true };
  }

  /** Epoch milliseconds of a time value; floating and all-day times use Brussels wall time. */
  private instantOf(time: IcalTime, event: IcalEvent): number {
    const isUtc = !time.isDate && time.zone === this.ICAL.Timezone.utcTimezone;
    if (isUtc) return time.toUnixTime() * 1000;

    const mode = this.zoneModeOf(event);
    if (mode.kind === 'wall') {
      if (mode.unknown) this.warnings.add('unknown-time-zone');
      return toMs(wall(time, mode.timeZone));
    }
    const isFloating = time.isDate || time.zone === this.ICAL.Timezone.localTimezone;
    return isFloating ? toMs(wall(time, TUTOR_TIME_ZONE)) : time.toUnixTime() * 1000;
  }
}

function wall(time: IcalTime, timeZone: string): IsoDateTime {
  const date = [
    String(time.year).padStart(4, '0'),
    String(time.month).padStart(2, '0'),
    String(time.day).padStart(2, '0'),
  ].join('-');
  return wallTimeToInstant(date, time.hour, time.minute, timeZone);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
