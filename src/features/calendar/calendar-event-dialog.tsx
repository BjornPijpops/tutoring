import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent, NewCalendarEvent } from '../../core/domain/calendar-event';
import type { EventChanges } from '../../core/domain/event-changes';
import { localDateOf, localTimeOf, type IsoDate } from '../../core/domain/local-time';
import {
  expandRecurrence,
  latestRecurrenceDate,
  type RecurrenceRule,
  type RecurrenceScope,
} from '../../core/domain/recurrence';
import { TUTOR_TIME_ZONE } from '../../core/domain/tutoring-hours';
import type { NewCalendarSeries } from '../../core/ports';
import { formatEventWhen, todayInBrussels } from '../../shared/dates/brussels';
import { Button, Dialog, ErrorSummary, Field, TextInput } from '../../shared/ui';
import {
  changesBetween,
  repeatBaseOf,
  validateCalendarEventForm,
  valuesForEvent,
  type CalendarEventFormValues,
} from './calendar-event-form';
import { RepeatFields } from './repeat-fields';
import {
  defaultRepeatValues,
  followDate,
  repeatSummary,
  validateRepeat,
  type RepeatErrors,
  type RepeatFormValues,
} from './repeat-form';
import { ScopeStep, type ScopeAction } from './scope-step';
import styles from './event-dialog.module.css';

const CLIP_NOTICE = 'The time outside 08:00–22:00 was removed. Check the times and save again.';
const REPEAT_HINT = 'To change how this event repeats, delete it and create a new one.';

/** What is known about the series of the event being edited. */
export type SeriesDetails =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly summary: string }
  | { readonly status: 'failed' };

export interface CalendarEventDialogProps {
  readonly mode: 'create' | 'edit' | 'imported';
  readonly event?: CalendarEvent;
  readonly initial?: { readonly date: IsoDate; readonly start: number; readonly end: number };
  readonly busy: boolean;
  readonly error?: string;
  /** The event no longer exists: only the message and Close are shown. */
  readonly gone?: boolean;
  /** Series of a repeating event being edited. */
  readonly series?: SeriesDetails;
  readonly onRetrySeries?: () => void;
  readonly onSave: (event: CalendarEvent, scope?: RecurrenceScope, changes?: EventChanges) => void;
  readonly onCreate: (event: NewCalendarEvent) => void;
  readonly onCreateSeries: (series: NewCalendarSeries) => void;
  /** Plain delete of an event that does not repeat (the parent asks for confirmation). */
  readonly onDelete: () => void;
  readonly onDeleteScoped: (scope: RecurrenceScope) => void;
  readonly onClose: () => void;
}

type Step = 'form' | ScopeAction;
interface PendingSave {
  readonly event: CalendarEvent;
  readonly changes: EventChanges;
}

const minutesOf = (instant: string): number => {
  const { hour, minute } = localTimeOf(instant, TUTOR_TIME_ZONE);
  return hour * 60 + minute;
};
const fieldId = (name: string) => `event-${name}`;

function titleFor(mode: CalendarEventDialogProps['mode'], step: Step): string {
  if (step === 'edit') return 'Edit repeating event';
  if (step === 'delete') return 'Delete repeating event';
  if (mode === 'create') return 'Create blocked time';
  return mode === 'edit' ? 'Edit blocked time' : 'Imported event';
}

function scopeButtonLabel(step: ScopeAction, busy: boolean, scope: RecurrenceScope): string {
  if (step === 'edit') return busy ? 'Saving…' : 'Save changes';
  if (busy) return 'Deleting…';
  return scope === 'this' ? 'Delete event' : 'Delete events';
}

function RepeatDetails({
  series,
  onRetry,
}: {
  series: SeriesDetails;
  onRetry: (() => void) | undefined;
}) {
  if (series.status === 'failed') {
    return (
      <div>
        <p className={styles['repeatLine']}>We couldn&apos;t load the repeat details.</p>
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <p className={styles['repeatLine']}>
        Repeats: {series.status === 'loading' ? 'Loading repeat details\u2026' : series.summary}
      </p>
      <p className={styles['hintText']}>{REPEAT_HINT}</p>
    </>
  );
}

function EventDialogContent(props: CalendarEventDialogProps) {
  const { mode, event, initial, busy, error, series, onSave, onCreate, onClose } = props;
  const [today] = useState(() => todayInBrussels());
  const date = event ? localDateOf(event.startsAt, TUTOR_TIME_ZONE) : (initial?.date ?? '');
  const start = event ? minutesOf(event.startsAt) : (initial?.start ?? 480);
  const end = event ? minutesOf(event.endsAt) : (initial?.end ?? start + 30);
  const [initialValues] = useState(() => valuesForEvent(date, start, end, event?.title ?? ''));
  const [values, setValues] = useState<CalendarEventFormValues>(initialValues);
  const [repeat, setRepeat] = useState<RepeatFormValues>(() => defaultRepeatValues(date, today));
  // The summary follows `shown`, which skips keystrokes in number fields until they lose focus.
  const [shown, setShown] = useState<RepeatFormValues>(repeat);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [clipNotice, setClipNotice] = useState(false);
  const [nothingChanged, setNothingChanged] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [scope, setScope] = useState<RecurrenceScope>('this');
  const [pending, setPending] = useState<PendingSave | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<string | null>(null);

  const repeating = mode === 'edit' && event?.seriesId !== undefined;
  const seriesDetails: SeriesDetails = series ?? { status: 'loading' };
  const seriesPending = repeating && seriesDetails.status === 'loading';

  useEffect(() => {
    if (step !== 'form') {
      titleRef.current?.focus();
    } else if (returnFocus.current) {
      document.getElementById(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [step]);

  const editField = (name: keyof CalendarEventFormValues, value: string) => {
    setClipNotice(false);
    setNothingChanged(false);
    setValues({ ...values, [name]: value });
    if (name === 'date') {
      const next = followDate(repeat, value, today);
      setRepeat(next);
      setShown(next);
    }
  };
  const field =
    (name: keyof CalendarEventFormValues, extra: Record<string, unknown> = {}) =>
    (control: {
      id: string;
      'aria-describedby': string | undefined;
      'aria-invalid': true | undefined;
      'aria-required': true | undefined;
    }) => (
      <TextInput
        {...control}
        {...extra}
        value={values[name]}
        disabled={busy}
        onChange={(e) => {
          editField(name, e.target.value);
        }}
      />
    );
  const updateRepeat = (next: RepeatFormValues, typing = false) => {
    setRepeat(next);
    if (!typing) setShown(next);
  };

  const submit = () => {
    if (busy) return;
    const result = validateCalendarEventForm(values);
    if (result.clippedValues) {
      // Show the clipped times first so the tutor confirms what will be saved.
      setErrors(result.errors);
      setValues(result.clippedValues);
      setClipNotice(true);
      return;
    }
    const base = repeatBaseOf(values);
    const repeated: { errors: RepeatErrors; rule?: RecurrenceRule } =
      mode === 'create' && base ? validateRepeat(repeat, base, today) : { errors: {} };
    const allErrors: Record<string, string> = { ...result.errors, ...repeated.errors };
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0 || !result.event) return;

    if (mode === 'create') {
      if (repeated.rule) {
        props.onCreateSeries({
          rule: repeated.rule,
          title: result.event.title,
          occurrences: expandRecurrence(repeated.rule, today).occurrences.map(
            ({ startsAt, endsAt }) => ({ startsAt, endsAt }),
          ),
        });
      } else {
        onCreate(result.event);
      }
      return;
    }
    if (!event) return;
    const merged: CalendarEvent = { ...event, ...result.event };
    if (!repeating) {
      onSave(merged);
      return;
    }
    const changes = changesBetween(initialValues, values);
    if (Object.keys(changes).length === 0) {
      setNothingChanged(true);
      return;
    }
    setPending({ event: merged, changes });
    setScope('this');
    returnFocus.current = fieldId('save');
    setStep('edit');
  };

  const openDelete = () => {
    if (!repeating) {
      props.onDelete();
      return;
    }
    setScope('this');
    returnFocus.current = fieldId('delete');
    setStep('delete');
  };

  let onlyThis: 'date' | 'details' | undefined;
  if (seriesDetails.status === 'failed') onlyThis = 'details';
  else if (step === 'edit' && pending?.changes.date !== undefined) onlyThis = 'date';
  const effectiveScope: RecurrenceScope = onlyThis ? 'this' : scope;

  let body;
  if (props.gone) {
    body = (
      <>
        <p role="alert">{error}</p>
        <div className={styles['actions']}>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    );
  } else if (mode === 'imported' && event) {
    body = (
      <>
        <p>{event.title || 'Untitled event'}</p>
        <p>{formatEventWhen(event.startsAt, event.endsAt)} - Imported from calendar file</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles['actions']}>
          <Button variant="secondary" onClick={props.onDelete}>
            Delete event
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    );
  } else if (step !== 'form') {
    body = (
      <div aria-busy={busy}>
        <ScopeStep
          action={step}
          when={event ? formatEventWhen(event.startsAt, event.endsAt) : ''}
          scope={effectiveScope}
          disabled={busy}
          {...(onlyThis ? { onlyThis } : {})}
          onChange={setScope}
        />
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles['actions']}>
          <Button
            loading={busy}
            onClick={() => {
              if (step === 'delete') props.onDeleteScoped(effectiveScope);
              else if (pending) onSave(pending.event, effectiveScope, pending.changes);
            }}
          >
            {scopeButtonLabel(step, busy, effectiveScope)}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setStep('form');
            }}
          >
            Back
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <form
        aria-busy={busy}
        noValidate
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          submit();
        }}
      >
        {repeating ? <RepeatDetails series={seriesDetails} onRetry={props.onRetrySeries} /> : null}
        <Field
          label="Title (optional)"
          hint="Only you can see this title. Tutees see only that the time is blocked."
          error={errors['title']}
          id={fieldId('title')}
        >
          {field('title', { maxLength: 200 })}
        </Field>
        <Field label="Date (Brussels time)" required error={errors['date']} id={fieldId('date')}>
          {field('date', { type: 'date' })}
        </Field>
        <Field label="Start (Brussels time)" required error={errors['start']} id={fieldId('start')}>
          {field('start', { type: 'time', step: 1800 })}
        </Field>
        <Field label="End (Brussels time)" required error={errors['end']} id={fieldId('end')}>
          {field('end', { type: 'time', step: 1800 })}
        </Field>
        {mode === 'create' ? (
          <RepeatFields
            date={values.date}
            values={repeat}
            errors={errors}
            summary={repeatSummary(shown, repeatBaseOf(values), today)}
            disabled={busy}
            minEndDate={values.date}
            maxEndDate={latestRecurrenceDate(today)}
            onChange={updateRepeat}
            onCommit={() => {
              setShown(repeat);
            }}
          />
        ) : null}
        {clipNotice ? <p role="status">{CLIP_NOTICE}</p> : null}
        {nothingChanged ? <p role="status">Nothing has changed.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {Object.keys(errors).length > 0 ? (
          <ErrorSummary
            errors={Object.entries(errors).map(([name, message]) => ({
              fieldId: fieldId(name),
              message,
            }))}
          />
        ) : null}
        <div
          className={`${styles['actions']} ${mode === 'edit' ? (styles['actionsWithDelete'] ?? '') : ''}`}
        >
          <Button id={fieldId('save')} type="submit" loading={busy} disabled={seriesPending}>
            {busy
              ? 'Saving…'
              : mode === 'create'
                ? repeat.choice === 'none'
                  ? 'Create event'
                  : 'Create events'
                : 'Save changes'}
          </Button>
          {mode === 'edit' ? (
            <Button
              id={fieldId('delete')}
              variant="secondary"
              disabled={busy || seriesPending}
              onClick={openDelete}
            >
              Delete event
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Dialog
      open
      title={titleFor(mode, step)}
      titleRef={titleRef}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {body}
    </Dialog>
  );
}

/** Shared create/edit/details dialog for tutor events, including repeat and scope steps. */
export function CalendarEventDialog(props: CalendarEventDialogProps) {
  // A new event version (for example after a conflict) starts the form afresh.
  const key = `${props.event?.id ?? 'new'}:${props.event?.updatedAt ?? ''}`;
  return <EventDialogContent key={key} {...props} />;
}
