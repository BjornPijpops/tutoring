import type { ReactNode } from 'react';
import styles from './status-message.module.css';

/** Kind of feedback a {@link StatusMessage} conveys. */
export type Status = 'info' | 'success' | 'warning' | 'error';

/** Props of {@link StatusMessage}. */
export interface StatusMessageProps {
  status: Status;
  children: ReactNode;
  title?: string;
}

const ICONS: Record<Status, string> = { info: 'ℹ', success: '✓', warning: '⚠', error: '✕' };
const PREFIXES: Record<Status, string> = {
  info: 'Information:',
  success: 'Success:',
  warning: 'Warning:',
  error: 'Error:',
};

/**
 * Feedback message. Meaning is never colour-only: an icon and a visually
 * hidden prefix accompany it. Errors are announced assertively (`alert`),
 * everything else politely (`status`).
 */
export function StatusMessage({ status, children, title }: StatusMessageProps) {
  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      className={`${styles['message']} ${styles[status]}`}
    >
      <span className={styles['icon']} aria-hidden="true">
        {ICONS[status]}
      </span>
      <div>
        <span className={styles['visuallyHidden']}>{PREFIXES[status]} </span>
        {title ? <p className={styles['title']}>{title}</p> : null}
        <p className={styles['body']}>{children}</p>
      </div>
    </div>
  );
}
