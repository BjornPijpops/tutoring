import type { ReactNode } from 'react';
import styles from './page-heading.module.css';

/** Props of {@link PageHeading}. */
export interface PageHeadingProps {
  children: ReactNode;
  /** Short introductory sentence shown below the heading. */
  lead?: string;
}

/** The page's single `h1`, with an optional lead paragraph. */
export function PageHeading({ children, lead }: PageHeadingProps) {
  return (
    <>
      <h1 className={styles['heading']}>{children}</h1>
      {lead ? <p className={styles['lead']}>{lead}</p> : null}
    </>
  );
}
