import { useState } from 'react';
import { Button, Container, PageHeading, StatusMessage } from '../../shared/ui';
import styles from './login-page.module.css';

/** Sign-in page; the buttons are placeholders until the auth feature is built. */
export function LoginPage() {
  const [notified, setNotified] = useState(false);
  const showNotAvailable = () => {
    setNotified(true);
  };

  return (
    <Container>
      <PageHeading lead="Use your Google or Microsoft account. The tutor will approve your access.">
        Sign in
      </PageHeading>
      <div className={styles['actions']}>
        <Button variant="secondary" fullWidth onClick={showNotAvailable}>
          Continue with Google
        </Button>
        <Button variant="secondary" fullWidth onClick={showNotAvailable}>
          Continue with Microsoft
        </Button>
      </div>
      {notified ? <StatusMessage status="info">Sign-in is not available yet.</StatusMessage> : null}
    </Container>
  );
}
