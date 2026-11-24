import type { ComponentPropsWithoutRef } from 'react';
import styles from './field.module.css';

/** Props of {@link TextInput}: native input attributes except styling. */
export type TextInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'style'>;

/** Styled native `input` (text, date, time, file); use inside a {@link Field}. */
export function TextInput(props: TextInputProps) {
  return <input {...props} className={styles['input']} />;
}
