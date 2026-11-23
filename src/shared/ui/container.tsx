import type { ReactNode } from 'react';
import styles from './container.module.css';

/** Props of {@link Container}. */
export interface ContainerProps {
  children: ReactNode;
  /** Element to render; defaults to `div`. */
  as?: 'div' | 'section';
}

/** Centred, width-limited content wrapper with responsive padding. */
export function Container({ children, as: Tag = 'div' }: ContainerProps) {
  return <Tag className={styles['container']}>{children}</Tag>;
}
