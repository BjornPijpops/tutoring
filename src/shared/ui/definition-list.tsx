import type { ReactNode } from 'react';
import styles from './definition-list.module.css';

/** Props of {@link DefinitionList}. */
export interface DefinitionListProps {
  items: readonly { label: string; value: ReactNode }[];
}

/** Read-only label/value pairs (a `dl`), e.g. a person's name and e-mail. */
export function DefinitionList({ items }: DefinitionListProps) {
  return (
    <dl className={styles['list']}>
      {items.map((item) => (
        <div key={item.label} className={styles['row']}>
          <dt className={styles['term']}>{item.label}</dt>
          <dd className={styles['value']}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
