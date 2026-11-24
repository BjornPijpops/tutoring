import type { ReactNode } from 'react';
import type { AccessRequestSummary } from '../../core/domain/access-request';
import { formatMoment } from '../../shared/dates/brussels';
import { StatusBadge, StatusMessage } from '../../shared/ui';
import styles from './access.module.css';

/** Id of a card's heading, so the list can move focus to it. */
export const requestHeadingId = (userId: string) => `request-${userId}`;

const ORDINALS: Readonly<Record<number, string>> = { 2: '2nd', 3: '3rd' };

function requestCountText(count: number): string {
  return ORDINALS[count] ?? `${String(count)}th`;
}

/** Props of {@link RequestCard}. */
export interface RequestCardProps {
  request: AccessRequestSummary;
  actions: ReactNode;
  error?: string;
}

/** One request: who asked, when, their message (text only) and the actions passed in. */
export function RequestCard({ request, actions, error }: RequestCardProps) {
  return (
    <li className={styles['card']}>
      <h3 id={requestHeadingId(request.userId)} tabIndex={-1} className={styles['cardName']}>
        {request.displayName}
      </h3>
      <p className={styles['cardEmail']}>{request.email}</p>
      <p className={styles['muted']}>
        {`Asked ${formatMoment(request.requestedAt)}`}
        {request.requestCount > 1 ? ` · ${requestCountText(request.requestCount)} request` : ''}
      </p>
      {request.status !== 'pending' && request.decidedAt ? (
        <p>
          <StatusBadge status={request.status === 'approved' ? 'success' : 'warning'}>
            {request.status === 'approved' ? 'Approved' : 'Declined'}
          </StatusBadge>{' '}
          <span className={styles['muted']}>
            {`${request.status === 'approved' ? 'Approved' : 'Declined'} on ${formatMoment(request.decidedAt)}`}
          </span>
        </p>
      ) : null}
      {request.message === '' ? (
        <p className={styles['muted']}>No message.</p>
      ) : (
        <p className={styles['cardMessage']}>{request.message}</p>
      )}
      {error ? <StatusMessage status="error">{error}</StatusMessage> : null}
      <div className={styles['actions']}>{actions}</div>
    </li>
  );
}
