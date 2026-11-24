import { Navigate } from 'react-router';
import { homeTarget } from '../../app/nav';
import { Button, Container, PageHeading, StatusMessage } from '../../shared/ui';
import { useAuth } from './auth-provider';
import { SIGN_IN_PROBLEM_TEXT } from './require-auth';
import styles from './login-page.module.css';

/** Sign-in page: Google works; Microsoft is announced as coming soon. Signed-in users go home. */
export function LoginPage() {
  const { state, signIn, signingIn, signInProblem } = useAuth();

  return (
    <Container>
      <PageHeading lead="Use your Google account. The tutor will approve your access.">
        Sign in
      </PageHeading>
      {state.status === 'checking' ? (
        <StatusMessage status="info">Checking your sign-in...</StatusMessage>
      ) : null}
      {state.status === 'signed-in' ? (
        <Navigate to={homeTarget(state.session.user)} replace />
      ) : null}
      {state.status === 'signed-out' || state.status === 'error' ? (
        <>
          {signInProblem ? (
            <StatusMessage status="error">{SIGN_IN_PROBLEM_TEXT[signInProblem]}</StatusMessage>
          ) : null}
          <div className={styles['actions']}>
            <Button
              variant="secondary"
              fullWidth
              loading={signingIn}
              onClick={() => {
                void signIn('google');
              }}
            >
              Continue with Google
            </Button>
            <Button
              variant="secondary"
              fullWidth
              aria-disabled="true"
              aria-describedby="microsoft-hint"
            >
              Continue with Microsoft (coming soon)
            </Button>
            <p id="microsoft-hint" className={styles['hint']}>
              Microsoft sign-in is not available yet.
            </p>
          </div>
        </>
      ) : null}
    </Container>
  );
}
