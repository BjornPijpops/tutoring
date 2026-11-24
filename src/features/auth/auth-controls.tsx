import { NavLink, useNavigate } from 'react-router';
import { Button, StatusMessage } from '../../shared/ui';
import { useAuth } from './auth-provider';
import styles from './auth-controls.module.css';

/** Id of the `main` landmark that receives focus after signing out. */
const MAIN_ID = 'main';

/** Router state that tells the home page to announce the sign-out. */
export const SIGNED_OUT_STATE = { signedOut: true } as const;

/** Header item: "Sign in" link while signed out, "Sign out" button while signed in. */
export function AuthControls() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();

  if (state.status === 'signed-in') {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          void signOut().then((signedOut) => {
            if (!signedOut) return;
            void navigate('/', { state: SIGNED_OUT_STATE });
            document.getElementById(MAIN_ID)?.focus();
          });
        }}
      >
        Sign out
      </Button>
    );
  }
  return (
    <NavLink to="/login" end className={styles['link']}>
      Sign in
    </NavLink>
  );
}

/** Announces a failed sign-out; renders nothing otherwise. */
export function SignOutAlert() {
  const { signOutFailed } = useAuth();
  return signOutFailed ? (
    <div className={styles['alert']}>
      <StatusMessage status="error">{"We couldn't sign you out. Try again."}</StatusMessage>
    </div>
  ) : null;
}
