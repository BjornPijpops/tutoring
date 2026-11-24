import { useId, type ReactNode } from 'react';
import styles from './field.module.css';

/** Attributes a control inside a {@link Field} must spread to be labelled and described. */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

/** Props of {@link Field}. */
export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Fixed id for the control, so an {@link ErrorSummary} can link to it. */
  id?: string;
  /** Renders the control; spread the given props onto it. */
  children: (props: FieldControlProps) => ReactNode;
}

/** Label, hint and error message wired to one form control. */
export function Field({ label, hint, error, required = false, id: fixedId, children }: FieldProps) {
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles['field']}>
      <label htmlFor={id} className={styles['label']}>
        {label}
        {required ? <span className={styles['required']}> (required)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className={styles['hint']}>
          {hint}
        </p>
      ) : null}
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {error ? (
        <p id={errorId} className={styles['error']}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
