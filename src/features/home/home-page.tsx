import { useLocation } from 'react-router';
import { ButtonLink, Container, PageHeading, StatusMessage } from '../../shared/ui';
import { usePendingCount } from '../access/pending-count';
import { useAuth } from '../auth/auth-provider';

function wasSignedOut(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'signedOut' in state;
}

/** Landing page; what it offers depends on who is signed in and their access. */
export function HomePage() {
  const location = useLocation();
  const { state } = useAuth();
  const user = state.status === 'signed-in' ? state.session.user : null;
  const pendingCount = usePendingCount(user?.role === 'tutor');

  let lead = "Personal tutoring sessions. Sign in to ask for access and see when I'm free.";
  if (user?.role === 'tutor') lead = 'Manage your calendar and access requests.';
  else if (user?.accessState === 'approved') lead = 'You have access.';
  else if (user) lead = "You're signed in. Ask for access to see my availability.";

  return (
    <Container>
      <PageHeading lead={lead}>Tutoring</PageHeading>
      {wasSignedOut(location.state) ? (
        <StatusMessage status="success">You have been signed out.</StatusMessage>
      ) : null}
      {state.status === 'checking' ? (
        <StatusMessage status="info">Checking your sign-in...</StatusMessage>
      ) : null}
      {state.status === 'signed-out' || state.status === 'error' ? (
        <ButtonLink to="/login">Sign in</ButtonLink>
      ) : null}
      {user?.role === 'tutor' ? (
        <>
          <ButtonLink to="/calendar">Go to calendar</ButtonLink>{' '}
          <ButtonLink to="/access-requests" variant="secondary">
            {pendingCount > 0
              ? `Access requests (${String(pendingCount)} pending)`
              : 'Access requests'}
          </ButtonLink>
        </>
      ) : null}
      {user?.role === 'tutee' ? <TuteeBlock accessState={user.accessState} /> : null}
    </Container>
  );
}

function TuteeBlock({ accessState }: { accessState: 'none' | 'pending' | 'approved' | 'denied' }) {
  if (accessState === 'approved')
    return <ButtonLink to="/availability">See availability</ButtonLink>;
  if (accessState === 'none') return <ButtonLink to="/access">Request access</ButtonLink>;
  return (
    <>
      {accessState === 'pending' ? (
        <StatusMessage status="info">Your request is waiting for the tutor.</StatusMessage>
      ) : (
        <StatusMessage status="warning">{"You don't have access right now."}</StatusMessage>
      )}
      <ButtonLink to="/access" variant="secondary">
        See request status
      </ButtonLink>
    </>
  );
}
