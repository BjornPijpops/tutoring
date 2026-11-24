import type { ComponentPropsWithoutRef } from 'react';
import { buttonClassName, type ButtonVariant } from './button-styles';
import styles from './button.module.css';

/** Props of {@link Button}: native button attributes (except styling) plus variants. */
export interface ButtonProps extends Omit<
  ComponentPropsWithoutRef<'button'>,
  'className' | 'style'
> {
  /** Visual style; defaults to `primary`. */
  variant?: ButtonVariant;
  /** Stretches the button to the container width. */
  fullWidth?: boolean;
  /** Disables the button and marks it busy while keeping its label. */
  loading?: boolean;
}

/** Button for actions. Use {@link ButtonLink} for navigation. */
export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  type = 'button',
  disabled,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  // `aria-disabled` keeps the button focusable (so it can be described) but inert.
  const ariaDisabled = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
  return (
    <button
      {...rest}
      type={type}
      className={buttonClassName(variant, fullWidth)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      onClick={ariaDisabled ? undefined : onClick}
    >
      {loading ? <span className={styles['spinner']} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
