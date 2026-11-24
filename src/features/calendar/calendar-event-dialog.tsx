import { useState } from 'react';
import type { CalendarEvent, NewCalendarEvent } from '../../core/domain/calendar-event';
import { localDateOf, localTimeOf, type IsoDate } from '../../core/domain/local-time';
import { TUTOR_TIME_ZONE } from '../../core/domain/tutoring-hours';
import { formatEventWhen } from '../../shared/dates/brussels';
import { Button, Dialog, ErrorSummary, Field, TextInput } from '../../shared/ui';
import { validateCalendarEventForm, valuesForEvent } from './calendar-event-form';

const CLIP_NOTICE = 'The time outside 08:00–22:00 was removed. Check the times and save again.';

export interface CalendarEventDialogProps {
  readonly mode: 'create' | 'edit' | 'imported';
  readonly event?: CalendarEvent;
  readonly initial?: { readonly date: IsoDate; readonly start: number; readonly end: number };
  readonly busy: boolean;
  readonly error?: string;
  readonly onSave: (event: CalendarEvent) => void;
  readonly onCreate: (event: NewCalendarEvent) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

/** Shared create/edit/details dialog for tutor events. */
export function CalendarEventDialog(props: CalendarEventDialogProps) {
  const { mode, event, initial, busy, error, onSave, onCreate, onDelete, onClose } = props;
  const date = event ? localDateOf(event.startsAt, TUTOR_TIME_ZONE) : (initial?.date ?? '');
  const start = event
    ? localTimeOf(event.startsAt, TUTOR_TIME_ZONE).hour * 60 +
      localTimeOf(event.startsAt, TUTOR_TIME_ZONE).minute
    : (initial?.start ?? 480);
  const end = event
    ? localTimeOf(event.endsAt, TUTOR_TIME_ZONE).hour * 60 +
      localTimeOf(event.endsAt, TUTOR_TIME_ZONE).minute
    : (initial?.end ?? start + 30);
  const [values, setValues] = useState(valuesForEvent(date, start, end, event?.title ?? ''));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [clipNotice, setClipNotice] = useState(false);
  const title =
    mode === 'create'
      ? 'Create blocked time'
      : mode === 'edit'
        ? 'Edit blocked time'
        : 'Imported event';
  const field =
    (name: keyof typeof values, extra: Record<string, unknown> = {}) =>
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
          setClipNotice(false);
          setValues({ ...values, [name]: e.target.value });
        }}
      />
    );
  return (
    <Dialog
      open
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {mode === 'imported' && event ? (
        <>
          <p>{event.title || 'Untitled event'}</p>
          <p>{formatEventWhen(event.startsAt, event.endsAt)} - Imported from calendar file</p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onDelete}>
              Delete event
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <form
          aria-busy={busy}
          onSubmit={(submit) => {
            submit.preventDefault();
            if (busy) return;
            const result = validateCalendarEventForm(values);
            setErrors(result.errors);
            if (result.clippedValues) {
              // Show the clipped times first so the tutor confirms what will be saved.
              setValues(result.clippedValues);
              setClipNotice(true);
              return;
            }
            if (result.event) {
              if (mode === 'create') onCreate(result.event);
              else if (event) onSave({ ...event, ...result.event });
            }
          }}
        >
          <Field
            label="Title (optional)"
            hint="Only you can see this title. Tutees see only that the time is blocked."
            error={errors.title}
          >
            {field('title', { maxLength: 200 })}
          </Field>
          <Field label="Date (Brussels time)" required error={errors.date}>
            {field('date', { type: 'date' })}
          </Field>
          <Field label="Start (Brussels time)" required error={errors.start}>
            {field('start', { type: 'time', step: 1800 })}
          </Field>
          <Field label="End (Brussels time)" required error={errors.end}>
            {field('end', { type: 'time', step: 1800 })}
          </Field>
          {clipNotice ? <p role="status">{CLIP_NOTICE}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {Object.keys(errors).length > 0 ? (
            <ErrorSummary
              errors={Object.entries(errors).map(([fieldId, message]) => ({ fieldId, message }))}
            />
          ) : null}
          <div className="dialog-actions">
            <Button type="submit" loading={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create event' : 'Save changes'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
