import { useEffect, useRef, type ReactNode } from 'react';
import type { AccessRequest } from '../../core/domain/access-request';
import { formatMoment } from '../../shared/dates/brussels';
import { Button, ButtonLink, StatusMessage } from '../../shared/ui';
import { getAccessView } from './access-view';
import styles from './access.module.css';
import { formatCooldown } from './format-cooldown';

/** Props of {@link AccessStatusView}. */
export interface AccessStatusViewProps {
  request: AccessRequest;
  now: Date;
  onCheckAgain: () => void;
  checking: boolean;
  /** Moves focus to the view's heading when it appears after something the user did. */
  focusHeading?: boolean;
  /** Shown after a denial the tutee may already answer with a new request (the form). */
  children?: ReactNode;
}

function Heading({ children, focus }: { children: string; focus: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h2 ref={ref} tabIndex={-1}>
      {children}
    </h2>
  );
}

/** The tutee's request as pending, approved or denied, with what they can do next. */
export function AccessStatusView({
  request,
  now,
  onCheckAgain,
  checking,
  focusHeading = false,
  children,
}: AccessStatusViewProps) {
  const view = getAccessView(request, now);
  const checkAgain = (
    <Button variant="secondary" loading={checking} onClick={onCheckAgain}>
      Check again
    </Button>
  );

  if (view === 'pending') {
    return (
      <div className={styles['stack']}>
        <Heading focus={focusHeading}>Waiting for the tutor</Heading>
        <StatusMessage status="info">
          {`I got your request on ${formatMoment(request.requestedAt)}. You will be able to see my availability once I say yes.`}
        </StatusMessage>
        <section aria-label="Your message">
          {request.message === '' ? (
            <p className={styles['muted']}>You did not add a message.</p>
          ) : (
            <blockquote className={styles['quote']}>{request.message}</blockquote>
          )}
        </section>
        {checkAgain}
        <p className={styles['muted']}>Come back later; this page does not refresh by itself.</p>
      </div>
    );
  }

  if (view === 'approved') {
    return (
      <div className={styles['stack']}>
        <Heading focus={focusHeading}>You have access</Heading>
        <StatusMessage status="success">{"You're in!"}</StatusMessage>
        <ButtonLink to="/availability">See availability</ButtonLink>
      </div>
    );
  }

  const cooldown = formatCooldown(now, request.nextRequestAt);
  return (
    <div className={styles['stack']}>
      <Heading focus={focusHeading}>Not approved at this time</Heading>
      <StatusMessage status="warning">
        {cooldown
          ? `The tutor has not given you access right now. You can ask again after ${cooldown.at} (in ${cooldown.remaining}).`
          : 'The tutor has not given you access right now. You can send a new request.'}
      </StatusMessage>
      <p className={styles['muted']}>If you think this is a mistake, contact the tutor directly.</p>
      {view === 'denied-waiting' ? checkAgain : children}
    </div>
  );
}
