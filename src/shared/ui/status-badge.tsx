import type { Status } from './status-message';
import styles from './status-badge.module.css';

/** Props of {@link StatusBadge}. */
export interface StatusBadgeProps {
  status: Status | 'neutral';
  children: string;
  /** True when the surrounding text already says it (e.g. a count in a link name). */
  decorative?: boolean;
}

/** Small pill with a text label; the colour never carries the meaning alone. */
export function StatusBadge({ status, children, decorative = false }: StatusBadgeProps) {
  return (
    <span
      className={`${styles['badge']} ${styles[status]}`}
      aria-hidden={decorative ? true : undefined}
    >
      {children}
    </span>
  );
}
