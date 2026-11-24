import { useState, type SyntheticEvent } from 'react';
import type { NewCalendarEvent } from '../../core/domain/calendar-event';
import { useServices } from '../../app/services-context';
import { localDateOf } from '../../core/domain/local-time';
import { TUTOR_TIME_ZONE } from '../../core/domain/tutoring-hours';
import { formatEventWhen } from '../../shared/dates/brussels';
import {
  Button,
  ErrorSummary,
  Field,
  StatusMessage,
  TextInput,
  type FieldError,
} from '../../shared/ui';
import {
  validateBlockedTimeForm,
  type BlockedTimeField,
  type BlockedTimeFormValues,
} from './blocked-time-form';
import { MAX_TITLE_LENGTH } from '../../core/domain/calendar-event';
import styles from './calendar.module.css';

/** Props of {@link AddBlockedTimeForm}. */
export interface AddBlockedTimeFormProps {
  /** Called after an event was stored, with the date to bring into view. */
  onAdded: (date: string) => void;
}

const EMPTY: BlockedTimeFormValues = { date: '', start: '', end: '', title: '' };
const IDS: Record<BlockedTimeField, string> = {
  date: 'blocked-date',
  start: 'blocked-start',
  end: 'blocked-end',
  title: 'blocked-title',
};
const COUNTER_FROM = 180;

type Banner = { kind: 'success'; text: string } | { kind: 'error'; text: string } | null;

/** Form that adds one manual blocked time. Validates on submit; keeps values on failure. */
export function AddBlockedTimeForm({ onAdded }: AddBlockedTimeFormProps) {
  const { calendarEvents } = useServices();
  const [values, setValues] = useState<BlockedTimeFormValues>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const validation = validateBlockedTimeForm(values);
  const errors = submitted ? validation.errors : {};
  const summary: FieldError[] = (Object.keys(IDS) as BlockedTimeField[]).flatMap((field) => {
    const message = errors[field];
    return message ? [{ fieldId: IDS[field], message }] : [];
  });
  const set = (field: BlockedTimeField) => (event: { target: { value: string } }) => {
    setValues((previous) => ({ ...previous, [field]: event.target.value }));
  };
  const remaining = MAX_TITLE_LENGTH - values.title.length;
  const allValid = Object.keys(validation.errors).length === 0;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBanner(null);
    setSubmitted(true);
    if (!validation.event) return;
    const newEvent: NewCalendarEvent = validation.event;
    setSaving(true);
    const result = await calendarEvents.addEvents([newEvent]);
    setSaving(false);
    if (!result.ok) {
      setBanner({ kind: 'error', text: "We couldn't save the blocked time. Try again." });
      return;
    }
    setBanner({
      kind: 'success',
      text: `Blocked time added: ${formatEventWhen(newEvent.startsAt, newEvent.endsAt)}.`,
    });
    setValues(EMPTY);
    setSubmitted(false);
    onAdded(localDateOf(newEvent.startsAt, TUTOR_TIME_ZONE));
    document.getElementById(IDS.date)?.focus();
  };

  return (
    <section aria-labelledby="add-blocked-heading" className={styles['section']}>
      <h2 id="add-blocked-heading">Add blocked time</h2>
      <p>Block a time so tutees can see you are not available.</p>
      <form noValidate onSubmit={(event) => void submit(event)}>
        {summary.length > 0 ? <ErrorSummary key={String(summary.length)} errors={summary} /> : null}
        <Field label="Date" required id={IDS.date} {...optional(errors.date)}>
          {(props) => (
            <TextInput {...props} type="date" value={values.date} onChange={set('date')} />
          )}
        </Field>
        <div className={styles['timeRow']}>
          <Field label="Start time" required id={IDS.start} {...optional(errors.start)}>
            {(props) => (
              <TextInput
                {...props}
                type="time"
                step={300}
                value={values.start}
                onChange={set('start')}
              />
            )}
          </Field>
          <Field label="End time" required id={IDS.end} {...optional(errors.end)}>
            {(props) => (
              <TextInput
                {...props}
                type="time"
                step={300}
                value={values.end}
                onChange={set('end')}
              />
            )}
          </Field>
        </div>
        <div aria-live="polite">
          {allValid && validation.partlyClosed ? (
            <p className={styles['note']}>
              Part of this time is outside 08:00-22:00, which is always blocked. It will be saved as
              you entered it.
            </p>
          ) : null}
        </div>
        <Field
          label="Title"
          id={IDS.title}
          hint="Only you can see the title. Tutees see just that the time is blocked."
          {...optional(errors.title)}
        >
          {(props) => (
            <TextInput
              {...props}
              type="text"
              maxLength={MAX_TITLE_LENGTH}
              value={values.title}
              onChange={set('title')}
            />
          )}
        </Field>
        <p className={styles['note']} aria-live="polite">
          {values.title.length >= COUNTER_FROM
            ? `${String(remaining)} ${remaining === 1 ? 'character' : 'characters'} left`
            : ''}
        </p>
        <Button type="submit" loading={saving}>
          Add blocked time
        </Button>
      </form>
      {banner ? <StatusMessage status={banner.kind}>{banner.text}</StatusMessage> : null}
    </section>
  );
}

function optional(error: string | undefined): { error?: string } {
  return error ? { error } : {};
}
