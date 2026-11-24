import { Button, ButtonLink, Container, PageHeading, StatusMessage } from '../../shared/ui';
import { useAuth } from './auth-provider';
import { SIGN_IN_PROBLEM_TEXT } from './require-auth';
import styles from './login-page.module.css';

/** Sign-in page: Google works; Microsoft is announced as coming soon. */
export function LoginPage() {
  const { state, signIn, signOut, signingIn, signInProblem, signOutFailed } = useAuth();

  return (
    <Container>
      <PageHeading lead="Use your Google account. The tutor will approve your access.">
        Sign in
      </PageHeading>
      {state.status === 'checking' ? (
        <StatusMessage status="info">Checking your sign-in...</StatusMessage>
      ) : null}
      {state.status === 'signed-in' ? (
        <div className={styles['actions']}>
          {state.session.user.role === 'tutor' ? (
            <>
              <StatusMessage status="success">You are signed in.</StatusMessage>
              <ButtonLink to="/calendar">Go to calendar</ButtonLink>
            </>
          ) : (
            <StatusMessage status="info" title="You don't have access yet">
              You are signed in, but the tutor has not given you access to the calendar. Access
              requests are coming soon.
            </StatusMessage>
          )}
          {signOutFailed ? (
            <StatusMessage status="error">{"We couldn't sign you out. Try again."}</StatusMessage>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </Button>
        </div>
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
