import type { ReactNode } from 'react';
import styles from './empty-state.module.css';

/** Props of {@link EmptyState}. */
export interface EmptyStateProps {
  children: ReactNode;
  action?: ReactNode;
}

/** Muted text for a list with nothing in it; the page supplies the heading. */
export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className={styles['empty']}>
      <p className={styles['text']}>{children}</p>
      {action}
    </div>
  );
}
