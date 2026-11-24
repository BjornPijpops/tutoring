import type { ReactNode } from 'react';
import type { Role } from '../../core/domain/user';
import { Container, PageHeading, StatusMessage } from '../../shared/ui';
import { useAuth } from './auth-provider';
import { RequireAuth } from './require-auth';

/** Props of {@link RequireRole}. */
export interface RequireRoleProps {
  requiredRole: Role;
  /** Page heading shown while the page itself is not available. */
  heading: string;
  /** Explanation shown to signed-in users without the role. */
  noAccessText: string;
  children: ReactNode;
}

function RoleCheck({ requiredRole, heading, noAccessText, children }: RequireRoleProps) {
  const { state } = useAuth();
  if (state.status === 'signed-in' && state.session.user.role === requiredRole)
    return <>{children}</>;

  return (
    <Container>
      <PageHeading>{heading}</PageHeading>
      <StatusMessage status="info" title="You don't have access yet">
        {noAccessText}
      </StatusMessage>
    </Container>
  );
}

/**
 * Shows `children` only to signed-in users with `role`. Like {@link RequireAuth} this is a
 * usability guard, not security: the backend enforces access.
 */
export function RequireRole(props: RequireRoleProps) {
  return (
    <RequireAuth heading={props.heading}>
      <RoleCheck {...props} />
    </RequireAuth>
  );
}
