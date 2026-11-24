import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services-context';
import {
  buildIcsPreview,
  ICS_EXPANSION_MONTHS,
  latestEnd,
  MAX_ICS_BYTES,
  MAX_EVENT_DAYS,
  type IcsPreview,
  type IcsWarning,
  type PreviewRow,
  type SkipReason,
} from '../../core/domain/calendar-event';
import { localDateOf, type IsoDate } from '../../core/domain/local-time';
import { TUTOR_TIME_ZONE } from '../../core/domain/tutoring-hours';
import { formatDayLabel, formatShortDate, formatTimeRange } from '../../shared/dates/brussels';
import { Button, ConfirmDialog, Field, StatusMessage, TextInput } from '../../shared/ui';
import styles from './calendar.module.css';

/** Props of {@link ImportPanel}. */
export interface ImportPanelProps {
  /** Called after events were added or removed; `jumpTo` is the first imported date. */
  onChanged: (jumpTo?: IsoDate) => void;
  /** Injectable clock for tests. */
  now?: () => Date;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; fileName: string; preview: IcsPreview; shown: number; failed: boolean }
  | { kind: 'importing'; fileName: string; preview: IcsPreview; shown: number }
  | { kind: 'success'; message: string };

interface ImportedInfo {
  readonly externalIds: ReadonlySet<string>;
  readonly count: number;
  readonly until: string | undefined;
}

const PAGE_SIZE = 50;
const WIDE_RANGE = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' } as const;
const NO_IMPORTS: ImportedInfo = { externalIds: new Set(), count: 0, until: undefined };

const SKIP_TEXT: Record<Exclude<SkipReason, 'beyond-limit'>, string> = {
  cancelled: 'Cancelled',
  transparent: 'Marked as free',
  past: 'In the past',
  'too-long': `Longer than ${String(MAX_EVENT_DAYS)} days`,
};

const ERROR_TYPE = "That doesn't look like a calendar file. Choose a file that ends in .ics.";
const ERROR_SIZE = 'This file is larger than 1 MB. Export a shorter date range and try again.';
const ERROR_READ =
  "We couldn't read this calendar file. It may be damaged. Export it again and retry.";
const ERROR_SAVE = "We couldn't save the events. Nothing was imported. Try again.";

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function warningText(warning: IcsWarning, until: string): string {
  return warning === 'unknown-time-zone'
    ? "Some events use a time zone we don't know. They were read as Brussels time."
    : `Only the first 2000 occurrences were read. Repeating events are cut off after ${until}.`;
}

function statusText(row: PreviewRow): string {
  if (row.status === 'new') return 'Will be added';
  if (row.status === 'duplicate') return 'Already imported';
  const reason = row.skipReason;
  if (reason === 'beyond-limit') return 'Skipped: after the 12-month limit';
  return `Skipped: ${(reason ? SKIP_TEXT[reason] : 'skipped').toLowerCase()}`;
}

function limitDate(now: Date): string {
  const limit = new Date(now);
  limit.setUTCMonth(limit.getUTCMonth() + ICS_EXPANSION_MONTHS);
  return limit.toISOString();
}

/** Import of an `.ics` file as a small state machine: choose, check, confirm, done. */
export function ImportPanel({ onChanged, now = () => new Date() }: ImportPanelProps) {
  const { calendarEvents, icsParser } = useServices();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [imported, setImported] = useState<ImportedInfo>(NO_IMPORTS);
  const [refresh, setRefresh] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<{ busy: boolean; error?: string } | null>(
    null,
  );
  const [announce, setAnnounce] = useState('');
  const stepFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    void calendarEvents.listEvents(WIDE_RANGE).then((result) => {
      if (!active || !result.ok) return;
      const ics = result.value.filter((event) => event.source === 'ics');
      setImported({
        externalIds: new Set(ics.flatMap((event) => (event.externalId ? [event.externalId] : []))),
        count: ics.length,
        until: latestEnd(ics),
      });
    });
    return () => {
      active = false;
    };
  }, [calendarEvents, refresh]);

  useEffect(() => {
    if (step.kind !== 'idle') stepFocus.current?.focus();
  }, [step.kind]);

  const chooseFile = useCallback(
    async (file: File) => {
      if (!/\.ics$/i.test(file.name) && file.type !== 'text/calendar') {
        setStep({ kind: 'error', message: ERROR_TYPE });
        return;
      }
      if (file.size > MAX_ICS_BYTES) {
        setStep({ kind: 'error', message: ERROR_SIZE });
        return;
      }
      setStep({ kind: 'parsing', fileName: file.name });
      const current = now();
      try {
        const text = await file.text();
        const parsed = await icsParser.parse(text, {
          from: current.toISOString(),
          to: limitDate(current),
        });
        if (!parsed.ok) {
          setStep({ kind: 'error', message: ERROR_READ });
          return;
        }
        const preview = buildIcsPreview(parsed.value, imported.externalIds);
        setStep({ kind: 'preview', fileName: file.name, preview, shown: PAGE_SIZE, failed: false });
      } catch {
        setStep({ kind: 'error', message: ERROR_READ });
      }
    },
    [icsParser, imported.externalIds, now],
  );

  const confirmImport = async (fileName: string, preview: IcsPreview, shown: number) => {
    setStep({ kind: 'importing', fileName, preview, shown });
    const result = await calendarEvents.addEvents(
      preview.toAdd.map((occurrence) => ({ ...occurrence, source: 'ics' as const })),
    );
    if (!result.ok) {
      setStep({ kind: 'preview', fileName, preview, shown, failed: true });
      return;
    }
    const parts = [
      `${plural(result.value.length, 'event', 'events')} imported.`,
      preview.duplicateCount > 0
        ? `${String(preview.duplicateCount)} ${preview.duplicateCount === 1 ? 'was' : 'were'} already in your calendar.`
        : '',
      preview.skippedCount > 0
        ? `${String(preview.skippedCount)} ${preview.skippedCount === 1 ? 'was' : 'were'} skipped.`
        : '',
    ].filter(Boolean);
    setStep({ kind: 'success', message: parts.join(' ') });
    setRefresh((value) => value + 1);
    const first = preview.toAdd[0];
    onChanged(first ? localDateOf(first.startsAt, TUTOR_TIME_ZONE) : undefined);
  };

  const removeImported = async () => {
    setConfirmRemove({ busy: true });
    const count = imported.count;
    const result = await calendarEvents.removeImportedEvents();
    if (!result.ok) {
      setConfirmRemove({
        busy: false,
        error: "We couldn't remove the imported events. Try again.",
      });
      return;
    }
    setConfirmRemove(null);
    setAnnounce(`${plural(count, 'imported event', 'imported events')} removed.`);
    setRefresh((value) => value + 1);
    onChanged();
  };

  const until = imported.until ? formatShortDate(localDateOf(imported.until, TUTOR_TIME_ZONE)) : '';
  const focusRef = (element: HTMLElement | null) => {
    stepFocus.current = element;
  };

  return (
    <section aria-labelledby="import-heading" className={styles['section']}>
      <h2 id="import-heading">Import a calendar file</h2>
      <p>
        Export your calendar as an .ics file from Outlook, Google Calendar or Apple Calendar and
        import it here. Events become blocked time. Only titles are kept; descriptions, locations
        and attendees are never read or stored. Repeating events are included for up to 12 months
        ahead.
      </p>

      {step.kind === 'idle' || step.kind === 'parsing' || step.kind === 'error' ? (
        <>
          <Field label="Calendar file (.ics, up to 1 MB)" id="import-file">
            {(props) => (
              <TextInput
                {...props}
                type="file"
                accept=".ics,text/calendar"
                disabled={step.kind === 'parsing'}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void chooseFile(file);
                }}
              />
            )}
          </Field>
          {step.kind === 'parsing' ? (
            <div ref={focusRef} tabIndex={-1}>
              <StatusMessage status="info">{`Reading ${step.fileName}...`}</StatusMessage>
            </div>
          ) : null}
          {step.kind === 'error' ? (
            <div ref={focusRef} tabIndex={-1}>
              <StatusMessage status="error">{step.message}</StatusMessage>
            </div>
          ) : null}
        </>
      ) : null}

      {step.kind === 'preview' || step.kind === 'importing' ? (
        <PreviewStep
          step={step}
          until={limitDateLabel(now())}
          focusRef={focusRef}
          onShowMore={() => {
            if (step.kind !== 'preview') return;
            const shown = step.shown + PAGE_SIZE;
            setStep({ ...step, shown });
            setAnnounce(
              `Showing ${String(Math.min(shown, step.preview.rows.length))} of ${String(step.preview.rows.length)}`,
            );
          }}
          onImport={() => {
            void confirmImport(step.fileName, step.preview, step.shown);
          }}
          onChooseAnother={() => {
            setStep({ kind: 'idle' });
          }}
        />
      ) : null}

      {step.kind === 'success' ? (
        <div ref={focusRef} tabIndex={-1}>
          <StatusMessage status="success" title="Import complete">
            {step.message}
          </StatusMessage>
          <Button
            variant="secondary"
            onClick={() => {
              setStep({ kind: 'idle' });
            }}
          >
            Import another file
          </Button>
        </div>
      ) : null}

      {imported.count > 0 && step.kind !== 'importing' ? (
        <div className={styles['imported']}>
          {until ? (
            <p className={styles['note']}>
              Imported until {until}. Import again before then to keep repeating events up to date.
            </p>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmRemove({ busy: false });
            }}
          >
            Remove all imported events
          </Button>
        </div>
      ) : null}

      <p className="visually-hidden" role="status">
        {announce}
      </p>
      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove all imported events?"
        confirmLabel="Remove imported events"
        cancelLabel="Keep events"
        busy={confirmRemove?.busy ?? false}
        {...(confirmRemove?.error ? { error: confirmRemove.error } : {})}
        onCancel={() => {
          setConfirmRemove(null);
        }}
        onConfirm={removeImported}
      >
        {`This removes ${plural(imported.count, 'imported event', 'imported events')}. Events you added by hand stay. Tutees will see those times as free again.`}
      </ConfirmDialog>
    </section>
  );
}

function limitDateLabel(now: Date): string {
  return formatShortDate(localDateOf(limitDate(now), TUTOR_TIME_ZONE));
}

interface PreviewStepProps {
  step: Extract<Step, { kind: 'preview' | 'importing' }>;
  until: string;
  focusRef: (element: HTMLElement | null) => void;
  onShowMore: () => void;
  onImport: () => void;
  onChooseAnother: () => void;
}

function PreviewStep({
  step,
  until,
  focusRef,
  onShowMore,
  onImport,
  onChooseAnother,
}: PreviewStepProps) {
  const { preview, fileName } = step;
  const importing = step.kind === 'importing';
  const rows = preview.rows.slice(0, step.shown);
  const nothingNew = preview.newCount === 0;
  const first = preview.rows[0];
  const last = preview.rows.at(-1);
  const skippedLines = (Object.keys(SKIP_TEXT) as (keyof typeof SKIP_TEXT)[]).flatMap((reason) => {
    const count = preview.skippedByReason[reason] ?? 0;
    return count > 0 ? [`${SKIP_TEXT[reason]}: ${String(count)}`] : [];
  });
  const beyond = preview.skippedByReason['beyond-limit'] ?? 0;
  if (beyond > 0) skippedLines.push(`After ${until} (12-month limit): ${String(beyond)}`);

  return (
    <div>
      <h3 ref={focusRef} tabIndex={-1}>
        Check before importing
      </h3>
      <dl className={styles['summary']}>
        <dt>Found</dt>
        <dd>{plural(preview.found, 'event', 'events')}</dd>
        <dt>Will be added</dt>
        <dd>{preview.newCount}</dd>
        <dt>Already in your calendar (duplicates, left unchanged)</dt>
        <dd>{preview.duplicateCount}</dd>
        <dt>Skipped</dt>
        <dd>
          {preview.skippedCount}
          {skippedLines.length > 0 ? (
            <ul>
              {skippedLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </dd>
        {first && last ? (
          <>
            <dt>Dates</dt>
            <dd>
              {formatShortDate(localDateOf(first.startsAt, TUTOR_TIME_ZONE))} -{' '}
              {formatShortDate(localDateOf(last.startsAt, TUTOR_TIME_ZONE))}
            </dd>
          </>
        ) : null}
      </dl>
      <p className={styles['note']}>Repeating events included until {until}.</p>
      {preview.warnings.map((warning) => (
        <StatusMessage key={warning} status="warning">
          {warningText(warning, until)}
        </StatusMessage>
      ))}
      {preview.found === 0 || (nothingNew && preview.duplicateCount === 0) ? (
        <StatusMessage status="info">
          No events to import. Cancelled events, events marked as free and past events are skipped.
        </StatusMessage>
      ) : null}
      {step.kind === 'preview' && step.failed ? (
        <StatusMessage status="error">{ERROR_SAVE}</StatusMessage>
      ) : null}
      {rows.length > 0 ? (
        <table className={styles['previewTable']}>
          <caption>{`Events found in ${fileName}`}</caption>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Date</th>
              <th scope="col">Time</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.startsAt}-${String(index)}`}>
                <td>{row.title || <span className={styles['muted']}>No title</span>}</td>
                <td>{formatDayLabel(localDateOf(row.startsAt, TUTOR_TIME_ZONE))}</td>
                <td>{formatTimeRange(row.startsAt, row.endsAt)}</td>
                <td>{statusText(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {preview.rows.length > rows.length ? (
        <Button variant="secondary" onClick={onShowMore}>
          Show 50 more
        </Button>
      ) : null}
      <div className={styles['actions']}>
        <Button
          loading={importing}
          aria-disabled={nothingNew ? 'true' : undefined}
          aria-describedby={nothingNew ? 'import-hint' : undefined}
          onClick={onImport}
        >
          {`Import ${plural(preview.newCount, 'event', 'events')}`}
        </Button>
        <Button variant="secondary" disabled={importing} onClick={onChooseAnother}>
          Choose another file
        </Button>
      </div>
      {nothingNew ? (
        <p id="import-hint" className={styles['note']}>
          There is nothing new to import.
        </p>
      ) : null}
    </div>
  );
}
