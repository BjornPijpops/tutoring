import {
  MAX_TITLE_LENGTH,
  validateNewEvent,
  type CalendarEvent,
  type NewCalendarEvent,
} from '../../core/domain/calendar-event';
import { eventChangesOf, type EventChanges } from '../../core/domain/event-changes';
import { fromMs, overlaps, toMs, type TimeRange } from '../../core/domain/interval';
import {
  addDays,
  localDateOf,
  localTimeOf,
  wallTimeToInstant,
  type IsoDate,
} from '../../core/domain/local-time';
import {
  RECURRENCE_MAX_COUNT,
  RECURRENCE_MIN_COUNT,
  latestRecurrenceDate,
  ruleOccurrenceProblem,
  validateRecurrence,
  type RecurrenceRule,
  type RecurrenceScope,
} from '../../core/domain/recurrence';
import { err, ok, type Result } from '../../core/domain/result';
import { SLOT_MINUTES, TUTOR_TIME_ZONE, TUTORING_HOURS } from '../../core/domain/tutoring-hours';
import type {
  AddedSeries,
  CalendarEventRepository,
  NewCalendarSeries,
  PortError,
  PortResult,
  RemovedEvents,
  UpdatedEvent,
} from '../../core/ports';
import { notFound, sequentialIds, type IdGenerator } from './support';

interface Options {
  readonly seed?: readonly CalendarEvent[];
  readonly nextId?: IdGenerator;
  /** Today's date in Brussels; injected so tests are deterministic. */
  readonly today?: () => IsoDate;
}

const validation = (message: string): PortError => ({ kind: 'validation', message });

function minutesOf(instant: string): number {
  const { hour, minute } = localTimeOf(instant, TUTOR_TIME_ZONE);
  return hour * 60 + minute;
}

function dateOf(instant: string): IsoDate {
  return localDateOf(instant, TUTOR_TIME_ZONE);
}

function dayDifference(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const indexOf = (event: CalendarEvent): number => event.seriesIndex ?? 0;

/** Versions match as instants; a seeded event without a version matches an empty one. */
function sameVersion(stored: string | undefined, expected: string): boolean {
  if (stored === undefined || expected === '') return (stored ?? '') === expected;
  return toMs(stored) === toMs(expected);
}

function atMinutes(date: IsoDate, minutes: number): string {
  return wallTimeToInstant(date, Math.floor(minutes / 60), minutes % 60, TUTOR_TIME_ZONE);
}

/** Same rules as the database: the 30-minute grid inside tutoring hours. */
function gridProblem(minutes: number): string | undefined {
  if (!Number.isInteger(minutes) || minutes % SLOT_MINUTES !== 0) {
    return 'Times must be on the 30-minute grid.';
  }
  if (minutes < TUTORING_HOURS.openHour * 60 || minutes > TUTORING_HOURS.closeHour * 60) {
    return 'Choose a time between 08:00 and 22:00.';
  }
  return undefined;
}

/** In-memory {@link CalendarEventRepository} for tests and offline UI work. */
export class InMemoryCalendarEventRepository implements CalendarEventRepository {
  private readonly events = new Map<string, CalendarEvent>();
  private readonly series = new Map<string, RecurrenceRule>();
  private readonly nextId: IdGenerator;
  private readonly nextSeriesId = sequentialIds('series');
  private readonly today: () => IsoDate;

  constructor({ seed = [], nextId, today }: Options = {}) {
    this.nextId = nextId ?? sequentialIds('event');
    this.today = today ?? (() => dateOf(new Date().toISOString()));
    seed.forEach((event) => this.events.set(event.id, event));
  }

  listEvents(range: TimeRange): PortResult<readonly CalendarEvent[]> {
    const interval = { startsAt: range.from, endsAt: range.to };
    return Promise.resolve(ok(this.snapshot().filter((event) => overlaps(event, interval))));
  }

  addEvents(events: readonly NewCalendarEvent[]): PortResult<readonly CalendarEvent[]> {
    for (const event of events) {
      const problem = validateNewEvent(event);
      if (problem) return Promise.resolve(err(validation(problem)));
    }
    const added: CalendarEvent[] = [];
    for (const event of events) {
      if (event.externalId !== undefined && this.hasExternalId(event)) continue;
      const saved: CalendarEvent = {
        ...event,
        id: this.nextId(),
        updatedAt: new Date().toISOString(),
      };
      this.events.set(saved.id, saved);
      added.push(saved);
    }
    return Promise.resolve(ok(added));
  }

  addSeries({ rule, title, occurrences }: NewCalendarSeries): PortResult<AddedSeries> {
    return Promise.resolve(this.createSeries(rule, title, occurrences));
  }

  getSeries(seriesId: string): PortResult<RecurrenceRule> {
    const rule = this.series.get(seriesId);
    return Promise.resolve(rule ? ok(rule) : err(notFound('Series', seriesId)));
  }

  updateEvent(
    event: CalendarEvent,
    expectedUpdatedAt: string,
    scope: RecurrenceScope = 'this',
    changes?: EventChanges,
  ): PortResult<UpdatedEvent> {
    return Promise.resolve(
      this.applyUpdate(event, expectedUpdatedAt, scope, changes ?? eventChangesOf(event, scope)),
    );
  }

  removeEvent(id: string, scope: RecurrenceScope = 'this'): PortResult<RemovedEvents> {
    const target = this.events.get(id);
    if (!target) return Promise.resolve(err(notFound('Event', id)));
    if (scope !== 'this' && target.seriesId === undefined) {
      return Promise.resolve(err(validation('This event does not repeat.')));
    }
    const removed = this.inScope(target, scope);
    removed.forEach((event) => this.events.delete(event.id));
    const { seriesId } = target;
    if (seriesId !== undefined) {
      if (!this.snapshot().some((event) => event.seriesId === seriesId)) {
        this.series.delete(seriesId);
      } else if (scope === 'following') {
        this.endSeriesAtLastEvent(seriesId);
      }
    }
    return Promise.resolve(ok({ affectedCount: removed.length }));
  }

  removeImportedEvents(): PortResult<void> {
    for (const event of this.snapshot()) {
      if (event.source === 'ics') this.events.delete(event.id);
    }
    return Promise.resolve(ok(undefined));
  }

  /** All stored events ordered by start; shared with the in-memory blocked-time repository. */
  snapshot(): readonly CalendarEvent[] {
    return [...this.events.values()].sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt));
  }

  private createSeries(
    rule: RecurrenceRule,
    title: string,
    occurrences: NewCalendarSeries['occurrences'],
  ): Result<AddedSeries, PortError> {
    const today = this.today();
    const problem = validateRecurrence(rule, today);
    if (problem) return err(validation(problem));
    if (title.length > MAX_TITLE_LENGTH) {
      return err(validation(`A title can have at most ${String(MAX_TITLE_LENGTH)} characters.`));
    }
    if (occurrences.length < RECURRENCE_MIN_COUNT || occurrences.length > RECURRENCE_MAX_COUNT) {
      return err(validation('A series needs between 2 and 400 events.'));
    }
    for (const { startsAt, endsAt } of occurrences) {
      const date = dateOf(startsAt);
      const bad =
        (toMs(endsAt) <= toMs(startsAt) && 'An event must end after it starts.') ||
        (date !== dateOf(endsAt) && 'A repeating event must end on the day it starts.') ||
        gridProblem(minutesOf(startsAt)) ||
        gridProblem(minutesOf(endsAt)) ||
        (date < today || date > latestRecurrenceDate(today)
          ? 'A repeating event must fall within the next 12 months.'
          : undefined);
      if (bad) return err(validation(bad));
    }
    const mismatch = ruleOccurrenceProblem(
      rule,
      occurrences.map((occurrence) => dateOf(occurrence.startsAt)),
      today,
    );
    if (mismatch) return err(validation(mismatch));
    const seriesId = this.nextSeriesId();
    this.series.set(seriesId, rule);
    const ordered = [...occurrences].sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt));
    for (const [seriesIndex, { startsAt, endsAt }] of ordered.entries()) {
      const id = this.nextId();
      this.events.set(id, {
        id,
        startsAt: fromMs(toMs(startsAt)),
        endsAt: fromMs(toMs(endsAt)),
        title,
        source: 'manual',
        updatedAt: new Date().toISOString(),
        seriesId,
        seriesIndex,
      });
    }
    return ok({ seriesId, occurrenceCount: occurrences.length });
  }

  private applyUpdate(
    event: CalendarEvent,
    expectedUpdatedAt: string,
    scope: RecurrenceScope,
    changes: EventChanges,
  ): Result<UpdatedEvent, PortError> {
    const target = this.events.get(event.id);
    if (!target) return err(notFound('Event', event.id));
    if (target.source !== 'manual') return err(validation('Imported events cannot be edited.'));
    if (!sameVersion(target.updatedAt, expectedUpdatedAt)) {
      return err({
        kind: 'conflict',
        message: 'This event changed. Review the times and try again.',
      });
    }
    if (scope !== 'this' && target.seriesId === undefined) {
      return err(validation('This event does not repeat.'));
    }
    const problem = this.changesProblem(target, scope, changes);
    if (problem) return err(validation(problem));

    let seriesId = target.seriesId;
    const targets = this.inScope(target, scope);
    if (scope === 'following' && seriesId !== undefined && this.hasEarlier(target)) {
      seriesId = this.splitSeries(target, targets);
    }
    const now = new Date().toISOString();
    for (const row of targets) {
      const date = changes.date ?? dateOf(row.startsAt);
      const span = dayDifference(dateOf(row.startsAt), dateOf(row.endsAt));
      const updated: CalendarEvent = {
        ...row,
        title: changes.title ?? row.title,
        startsAt: atMinutes(date, changes.startMinutes ?? minutesOf(row.startsAt)),
        endsAt: atMinutes(addDays(date, span), changes.endMinutes ?? minutesOf(row.endsAt)),
        updatedAt: now,
        ...(seriesId === undefined ? {} : { seriesId }),
      };
      const invalid = validateNewEvent(updated);
      if (invalid) return err(validation(invalid));
      this.events.set(row.id, updated);
    }
    if (scope !== 'this' && seriesId !== undefined) this.retimeSeries(seriesId, changes);
    const saved = this.events.get(event.id);
    if (!saved) return err(notFound('Event', event.id));
    return ok({ event: saved, affectedCount: targets.length, ...(seriesId ? { seriesId } : {}) });
  }

  private changesProblem(
    target: CalendarEvent,
    scope: RecurrenceScope,
    changes: EventChanges,
  ): string | undefined {
    if (changes.title !== undefined && changes.title.length > MAX_TITLE_LENGTH) {
      return `A title can have at most ${String(MAX_TITLE_LENGTH)} characters.`;
    }
    if (changes.date !== undefined) {
      if (scope !== 'this') return 'Only one event at a time can move to another date.';
      const today = this.today();
      const moved = changes.date !== dateOf(target.startsAt);
      if (moved && (changes.date < today || changes.date > latestRecurrenceDate(today))) {
        return 'Choose a date within the next 12 months.';
      }
    }
    for (const minutes of [changes.startMinutes, changes.endMinutes]) {
      const problem = minutes === undefined ? undefined : gridProblem(minutes);
      if (problem) return problem;
    }
    return this.inScope(target, scope).some((row) => {
      const sameDay = dateOf(row.startsAt) === dateOf(row.endsAt);
      const start = changes.startMinutes ?? minutesOf(row.startsAt);
      const end = changes.endMinutes ?? minutesOf(row.endsAt);
      return sameDay && end <= start;
    })
      ? 'An event must end after it starts.'
      : undefined;
  }

  /** The target and, for series scopes, the events of its series that the scope reaches. */
  private inScope(target: CalendarEvent, scope: RecurrenceScope): CalendarEvent[] {
    if (scope === 'this' || target.seriesId === undefined) return [target];
    return this.snapshot().filter(
      (event) =>
        event.seriesId === target.seriesId &&
        (scope === 'all' || indexOf(event) >= indexOf(target)),
    );
  }

  private hasEarlier(target: CalendarEvent): boolean {
    return this.snapshot().some(
      (event) => event.seriesId === target.seriesId && indexOf(event) < indexOf(target),
    );
  }

  /** Moves `moved` to a new series that starts at the clicked event; the old one ends before it. */
  private splitSeries(target: CalendarEvent, moved: readonly CalendarEvent[]): string | undefined {
    const oldId = target.seriesId;
    const rule = oldId === undefined ? undefined : this.series.get(oldId);
    if (oldId === undefined) return undefined;
    const newId = this.nextSeriesId();
    if (rule) {
      const dates = moved.map((event) => dateOf(event.startsAt)).sort();
      const first = dates[0] ?? dateOf(target.startsAt);
      const last = dates.at(-1) ?? first;
      this.series.set(newId, { ...rule, startDate: first, end: { kind: 'until', date: last } });
    }
    moved.forEach((event) => this.events.set(event.id, { ...event, seriesId: newId }));
    this.endSeriesAtLastEvent(oldId);
    return newId;
  }

  /** Ends the series on the date of its latest remaining event. */
  private endSeriesAtLastEvent(seriesId: string): void {
    const rule = this.series.get(seriesId);
    const dates = this.snapshot()
      .filter((event) => event.seriesId === seriesId)
      .map((event) => dateOf(event.startsAt))
      .sort();
    const last = dates.at(-1);
    if (rule && last !== undefined)
      this.series.set(seriesId, { ...rule, end: { kind: 'until', date: last } });
  }

  private retimeSeries(seriesId: string, changes: EventChanges): void {
    const rule = this.series.get(seriesId);
    if (!rule) return;
    this.series.set(seriesId, {
      ...rule,
      startMinutes: changes.startMinutes ?? rule.startMinutes,
      endMinutes: changes.endMinutes ?? rule.endMinutes,
    });
  }

  private hasExternalId(candidate: NewCalendarEvent): boolean {
    return [...this.events.values()].some(
      (event) => event.source === candidate.source && event.externalId === candidate.externalId,
    );
  }
}
