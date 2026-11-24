import { useEffect, useRef } from 'react';
import { StatusMessage } from './status-message';
import styles from './error-summary.module.css';

/** One problem in a form, linked to the field that has it. */
export interface FieldError {
  readonly fieldId: string;
  readonly message: string;
}

/** Props of {@link ErrorSummary}. */
export interface ErrorSummaryProps {
  errors: readonly FieldError[];
}

/** Focusable list of form problems with links to the fields; focus moves here on mount. */
export function ErrorSummary({ errors }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const count = errors.length;
  return (
    <div ref={ref} tabIndex={-1} className={styles['summary']}>
      <StatusMessage status="error">
        {`Please fix ${String(count)} ${count === 1 ? 'problem' : 'problems'} below.`}
      </StatusMessage>
      <ul className={styles['list']}>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                // Hash links would navigate the HashRouter; focus the field instead.
                event.preventDefault();
                document.getElementById(error.fieldId)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
