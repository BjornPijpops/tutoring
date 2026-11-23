import styles from './button.module.css';

/** Visual style of a {@link Button} or {@link ButtonLink}. */
export type ButtonVariant = 'primary' | 'secondary';

/** Shared look for buttons and button-styled links. */
export function buttonClassName(variant: ButtonVariant, fullWidth: boolean): string {
  return [styles['button'], styles[variant], fullWidth ? styles['fullWidth'] : '']
    .filter(Boolean)
    .join(' ');
}
