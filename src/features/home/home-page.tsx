import { useLocation } from 'react-router';
import { ButtonLink, Container, PageHeading, StatusMessage } from '../../shared/ui';
import { useAuth } from '../auth/auth-provider';

function wasSignedOut(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'signedOut' in state;
}

/** Landing page. */
export function HomePage() {
  const location = useLocation();
  const { state } = useAuth();
  const lead =
    state.status === 'signed-in'
      ? 'Manage your tutoring access and availability.'
      : 'Personal tutoring sessions. Sign in to request access and book a time.';

  return (
    <Container>
      <PageHeading lead={lead}>Tutoring</PageHeading>
      {wasSignedOut(location.state) ? (
        <StatusMessage status="success">You have been signed out.</StatusMessage>
      ) : null}
      {state.status === 'checking' ? (
        <StatusMessage status="info">Checking your sign-in...</StatusMessage>
      ) : state.status === 'signed-in' && state.session.user.role === 'tutor' ? (
        <>
          <StatusMessage status="success">You are signed in as the tutor.</StatusMessage>
          <ButtonLink to="/calendar">Go to calendar</ButtonLink>
        </>
      ) : state.status === 'signed-in' ? (
        <StatusMessage status="info">
          You are signed in, but the tutor has not given you access yet.
        </StatusMessage>
      ) : (
        <ButtonLink to="/login">Sign in</ButtonLink>
      )}
    </Container>
  );
}
