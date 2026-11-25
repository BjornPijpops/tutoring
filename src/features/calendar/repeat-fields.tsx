import { Field, TextInput } from '../../shared/ui';
import {
  REPEAT_COUNT_LIMITS,
  WEEKDAYS,
  fullWeekdayName,
  repeatOptions,
  shortWeekdayName,
  toggleWeekday,
  type RepeatChoice,
  type RepeatEndKind,
  type RepeatErrors,
  type RepeatFormValues,
} from './repeat-form';
import styles from './event-dialog.module.css';

export interface RepeatFieldsProps {
  /** Date field of the dialog; the weekday presets follow it. */
  readonly date: string;
  readonly values: RepeatFormValues;
  readonly errors: RepeatErrors;
  readonly summary: string;
  readonly disabled: boolean;
  /** Earliest and latest end date the tutor may pick. */
  readonly minEndDate: string;
  readonly maxEndDate: string;
  /** `typing` is true for text-like edits, which should not update the live summary yet. */
  readonly onChange: (values: RepeatFormValues, typing?: boolean) => void;
  /** A number field lost focus: its value may now be announced. */
  readonly onCommit: () => void;
}

const id = (key: string) => `event-${key}`;

function ErrorText({ fieldId, message }: { fieldId: string; message: string | undefined }) {
  return message ? (
    <p id={`${fieldId}-error`} className={styles['error']}>
      {message}
    </p>
  ) : null;
}

function CustomSection({ values, errors, disabled, onChange, onCommit }: RepeatFieldsProps) {
  const weekdayError = errors.repeatWeekdays;
  return (
    <>
      <fieldset className={styles['fieldset']}>
        <legend className={styles['legend']}>Repeat every</legend>
        <Field label="Repeat every (weeks)" error={errors.repeatInterval} id={id('repeatInterval')}>
          {(control) => (
            <span className={styles['inline']}>
              <TextInput
                {...control}
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                step={1}
                value={values.intervalWeeks}
                disabled={disabled}
                onChange={(e) => {
                  onChange({ ...values, intervalWeeks: e.target.value }, true);
                }}
                onBlur={onCommit}
              />
              <span>week(s)</span>
            </span>
          )}
        </Field>
      </fieldset>
      <fieldset
        className={styles['fieldset']}
        aria-describedby={weekdayError ? `${id('repeatWeekdays')}-error` : undefined}
      >
        <legend className={styles['legend']}>Repeat on</legend>
        <div className={styles['chips']}>
          {WEEKDAYS.map((weekday) => {
            const name = fullWeekdayName(weekday);
            const short = shortWeekdayName(weekday);
            return (
              <label key={weekday} className={styles['chip']}>
                <input
                  id={weekday === 1 ? id('repeatWeekdays') : undefined}
                  type="checkbox"
                  checked={values.weekdays.includes(weekday)}
                  disabled={disabled}
                  aria-invalid={weekdayError ? true : undefined}
                  onChange={(e) => {
                    onChange(toggleWeekday(values, weekday, e.target.checked));
                  }}
                />
                <span>
                  {short}
                  <span className="visually-hidden">{name.slice(short.length)}</span>
                </span>
              </label>
            );
          })}
        </div>
        <ErrorText fieldId={id('repeatWeekdays')} message={weekdayError} />
      </fieldset>
    </>
  );
}

function EndFieldset(props: RepeatFieldsProps) {
  const { values, errors, disabled, minEndDate, maxEndDate, onChange, onCommit } = props;
  const chooseEnd = (endKind: RepeatEndKind) => {
    onChange({ ...values, endKind });
  };
  return (
    <fieldset className={styles['fieldset']}>
      <legend className={styles['legend']}>
        Ends<span className={styles['required']}> (required)</span>
      </legend>
      <div className={styles['option']}>
        <label className={styles['radioLabel']}>
          <input
            type="radio"
            name="repeat-end"
            checked={values.endKind === 'until'}
            disabled={disabled}
            onChange={() => {
              chooseEnd('until');
            }}
          />
          On date
        </label>
        <div className={styles['nested']}>
          <Field
            label="End date (Brussels time)"
            error={errors.repeatEndDate}
            id={id('repeatEndDate')}
          >
            {(control) => (
              <TextInput
                {...control}
                type="date"
                min={minEndDate}
                max={maxEndDate}
                value={values.endDate}
                disabled={disabled || values.endKind !== 'until'}
                onChange={(e) => {
                  onChange({ ...values, endDate: e.target.value, endDateTouched: true });
                }}
              />
            )}
          </Field>
        </div>
      </div>
      <div className={styles['option']}>
        <label className={styles['radioLabel']}>
          <input
            type="radio"
            name="repeat-end"
            checked={values.endKind === 'count'}
            disabled={disabled}
            onChange={() => {
              chooseEnd('count');
            }}
          />
          After
        </label>
        <div className={styles['nested']}>
          <Field label="Number of events" error={errors.repeatCount} id={id('repeatCount')}>
            {(control) => (
              <span className={styles['inline']}>
                <TextInput
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={REPEAT_COUNT_LIMITS.min}
                  max={REPEAT_COUNT_LIMITS.max}
                  step={1}
                  value={values.count}
                  disabled={disabled || values.endKind !== 'count'}
                  onChange={(e) => {
                    onChange({ ...values, count: e.target.value }, true);
                  }}
                  onBlur={onCommit}
                />
                <span>events</span>
              </span>
            )}
          </Field>
        </div>
      </div>
      <ErrorText fieldId={id('repeatEnd')} message={errors.repeatEnd} />
    </fieldset>
  );
}

/** Repeat select, custom pattern, required end and summary of the create dialog. */
export function RepeatFields(props: RepeatFieldsProps) {
  const { date, values, summary, disabled, onChange } = props;
  return (
    <>
      <Field label="Repeat" id={id('repeatChoice')}>
        {(control) => (
          <select
            {...control}
            className={styles['select']}
            value={values.choice}
            disabled={disabled}
            onChange={(e) => {
              onChange({ ...values, choice: e.target.value as RepeatChoice });
            }}
          >
            {repeatOptions(date).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {values.choice === 'custom' ? <CustomSection {...props} /> : null}
      {values.choice === 'none' ? null : (
        <>
          <EndFieldset {...props} />
          <p className={styles['summary']} aria-live="polite">
            {summary}
          </p>
        </>
      )}
    </>
  );
}
