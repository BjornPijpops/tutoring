import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/auth-provider';
import { RequireAuth } from '../auth/require-auth';

/** Props of {@link RequireAccess}. */
export interface RequireAccessProps {
  /** Page heading shown while the sign-in is checked or required. */
  heading: string;
  children: ReactNode;
}

function AccessCheck({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status !== 'signed-in') return null;
  const { role, accessState } = state.session.user;
  if (role === 'tutor' || accessState === 'approved') return <>{children}</>;
  return <Navigate to="/access" replace />;
}

/**
 * Shows `children` to the tutor and to approved tutees; everyone else is sent to `/access`.
 * A usability guard only: the backend refuses the data to anyone else.
 */
export function RequireAccess({ heading, children }: RequireAccessProps) {
  return (
    <RequireAuth heading={heading}>
      <AccessCheck>{children}</AccessCheck>
    </RequireAuth>
  );
}
