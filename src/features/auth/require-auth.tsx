import type { ReactNode } from 'react';
import { Button, Container, PageHeading, StatusMessage } from '../../shared/ui';
import { useAuth, type SignInProblem } from './auth-provider';

/** Text shown for a failed or cancelled sign-in attempt. */
export const SIGN_IN_PROBLEM_TEXT: Readonly<Record<SignInProblem, string>> = {
  cancelled: 'Sign-in was cancelled. You can try again.',
  failed:
    "We couldn't sign you in with Google. Try again. If it keeps happening, contact the tutor.",
  network: "We couldn't reach the sign-in service. Check your connection and try again.",
};

/** Props of {@link RequireAuth}. */
export interface RequireAuthProps {
  /** Page heading shown while the page itself is not available. */
  heading: string;
  children: ReactNode;
}

/**
 * Shows `children` to signed-in users only. This is a usability guard: the data behind it is
 * protected by the backend (RLS), so nothing is fetched while this renders a gate.
 */
export function RequireAuth({ heading, children }: RequireAuthProps) {
  const { state, signIn, signingIn, signInProblem } = useAuth();
  if (state.status === 'signed-in') return <>{children}</>;

  return (
    <Container>
      <PageHeading>{heading}</PageHeading>
      {state.status === 'checking' ? (
        <StatusMessage status="info">Checking your sign-in...</StatusMessage>
      ) : null}
      {state.status === 'error' ? (
        <StatusMessage status="error">{SIGN_IN_PROBLEM_TEXT.network}</StatusMessage>
      ) : null}
      {state.status === 'signed-out' ? (
        <>
          <p>Sign in to see the {heading.toLowerCase()}.</p>
          {signInProblem ? (
            <StatusMessage status="error">{SIGN_IN_PROBLEM_TEXT[signInProblem]}</StatusMessage>
          ) : null}
          <Button
            loading={signingIn}
            onClick={() => {
              void signIn('google');
            }}
          >
            Sign in with Google
          </Button>
        </>
      ) : null}
    </Container>
  );
}
