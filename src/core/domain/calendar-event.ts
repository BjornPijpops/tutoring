import { fromMs, isValidInterval, toMs, type Interval, type IsoDateTime } from './interval';

/** Where a calendar event came from. */
export type EventSource = 'manual' | 'ics';

/** Time the tutor is unavailable; the title is only visible to the tutor. */
export interface CalendarEvent extends Interval {
  readonly id: string;
  readonly title: string;
  readonly source: EventSource;
  /** Stable id of an imported occurrence (`UID#start`); only set for `ics` events. */
  readonly externalId?: string;
  /** Optimistic-concurrency version returned by persistence. */
  readonly updatedAt?: IsoDateTime;
}

/** Data needed to create an event; the repository assigns the id. */
export type NewCalendarEvent = Omit<CalendarEvent, 'id'>;

/** Longest allowed title, in characters. */
export const MAX_TITLE_LENGTH = 200;
/** Longest allowed single event, in days. */
export const MAX_EVENT_DAYS = 31;
/** Largest accepted `.ics` file, in bytes. */
export const MAX_ICS_BYTES = 1_000_000;
/** Recurring events are expanded this many months ahead. */
export const ICS_EXPANSION_MONTHS = 12;
/** Maximum number of occurrences read from one file. */
export const ICS_MAX_OCCURRENCES = 2000;

const DAY_MS = 86_400_000;

/** Why an occurrence in an `.ics` file is not imported. */
export type SkipReason = 'cancelled' | 'transparent' | 'past' | 'too-long' | 'beyond-limit';

/** One occurrence read from an `.ics` file that can be imported. */
export interface IcsOccurrence extends Interval {
  readonly title: string;
  readonly externalId: string;
}

/** An occurrence that will not be imported, and why. */
export interface SkippedOccurrence {
  readonly title: string;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly reason: SkipReason;
}

/** Notable things found while reading a file. */
export type IcsWarning = 'unknown-time-zone' | 'occurrence-limit';

/** Raw outcome of reading an `.ics` file, before comparing with existing events. */
export interface ParsedIcs {
  readonly occurrences: readonly IcsOccurrence[];
  readonly skipped: readonly SkippedOccurrence[];
  readonly warnings: readonly IcsWarning[];
  /** End of the expansion window for repeating events. */
  readonly importedUntil: IsoDateTime;
}

/** Row of the import preview. */
export interface PreviewRow {
  readonly title: string;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly status: 'new' | 'duplicate' | 'skipped';
  readonly skipReason?: SkipReason;
}

/** What importing a file would do; shown to the tutor before confirming. */
export interface IcsPreview {
  readonly rows: readonly PreviewRow[];
  readonly toAdd: readonly IcsOccurrence[];
  readonly found: number;
  readonly newCount: number;
  readonly duplicateCount: number;
  readonly skippedCount: number;
  readonly skippedByReason: Readonly<Partial<Record<SkipReason, number>>>;
  readonly warnings: readonly IcsWarning[];
  readonly importedUntil: IsoDateTime;
}

/** Combines a parsed file with the external ids already stored into a preview. */
export function buildIcsPreview(
  parsed: ParsedIcs,
  existingExternalIds: ReadonlySet<string>,
): IcsPreview {
  const toAdd: IcsOccurrence[] = [];
  const seen = new Set<string>();
  const rows: PreviewRow[] = [];
  let duplicateCount = 0;

  for (const occurrence of parsed.occurrences) {
    const duplicate =
      existingExternalIds.has(occurrence.externalId) || seen.has(occurrence.externalId);
    seen.add(occurrence.externalId);
    if (duplicate) duplicateCount += 1;
    else toAdd.push(occurrence);
    rows.push({
      title: occurrence.title,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      status: duplicate ? 'duplicate' : 'new',
    });
  }

  const skippedByReason: Partial<Record<SkipReason, number>> = {};
  for (const skipped of parsed.skipped) {
    skippedByReason[skipped.reason] = (skippedByReason[skipped.reason] ?? 0) + 1;
    rows.push({
      title: skipped.title,
      startsAt: skipped.startsAt,
      endsAt: skipped.endsAt,
      status: 'skipped',
      skipReason: skipped.reason,
    });
  }

  rows.sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt));
  return {
    rows,
    toAdd,
    found: parsed.occurrences.length + parsed.skipped.length,
    newCount: toAdd.length,
    duplicateCount,
    skippedCount: parsed.skipped.length,
    skippedByReason,
    warnings: parsed.warnings,
    importedUntil: parsed.importedUntil,
  };
}

/** True when a single event is longer than the allowed {@link MAX_EVENT_DAYS}. */
export function exceedsMaxLength(interval: Interval): boolean {
  return toMs(interval.endsAt) - toMs(interval.startsAt) > MAX_EVENT_DAYS * DAY_MS;
}

/** Why a new event is not acceptable, or `undefined` when it is valid. */
export function validateNewEvent(event: NewCalendarEvent): string | undefined {
  if (!isValidInterval(event)) return 'An event must end after it starts.';
  if (exceedsMaxLength(event)) return `An event can last at most ${String(MAX_EVENT_DAYS)} days.`;
  if (event.title.length > MAX_TITLE_LENGTH) {
    return `A title can have at most ${String(MAX_TITLE_LENGTH)} characters.`;
  }
  if (event.source === 'manual' && event.externalId !== undefined) {
    return 'Only imported events can have an external id.';
  }
  if (event.source === 'ics' && !event.externalId) return 'Imported events need an external id.';
  return undefined;
}

/** Latest end of the given events as an instant, or `undefined` when there are none. */
export function latestEnd(events: readonly Interval[]): IsoDateTime | undefined {
  if (events.length === 0) return undefined;
  return fromMs(Math.max(...events.map((event) => toMs(event.endsAt))));
}
