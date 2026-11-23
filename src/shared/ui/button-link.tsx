import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { buttonClassName, type ButtonVariant } from './button-styles';

/** Props of {@link ButtonLink}. */
export interface ButtonLinkProps {
  /** Router destination. */
  to: string;
  children: ReactNode;
  /** Visual style; defaults to `primary`. */
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

/** Router link that looks like a {@link Button}; links navigate, buttons act. */
export function ButtonLink({
  to,
  children,
  variant = 'primary',
  fullWidth = false,
}: ButtonLinkProps) {
  return (
    <Link to={to} className={buttonClassName(variant, fullWidth)}>
      {children}
    </Link>
  );
}
