import type { ComponentPropsWithoutRef } from 'react';
import styles from './field.module.css';

/** Props of {@link TextArea}: native textarea attributes except styling. */
export type TextAreaProps = Omit<ComponentPropsWithoutRef<'textarea'>, 'className' | 'style'>;

/** Styled native `textarea`; use inside a {@link Field}. */
export function TextArea({ rows = 4, ...rest }: TextAreaProps) {
  return <textarea {...rest} rows={rows} className={`${styles['input']} ${styles['textarea']}`} />;
}
