import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import type { AccessRequestSummary } from '../../core/domain/access-request';
import { Button, EmptyState } from '../../shared/ui';
import styles from './access.module.css';
import { formatCooldown } from './format-cooldown';
import { RequestCard, requestHeadingId } from './request-card';

/** Which list the tutor is looking at. */
export type RequestTab = 'pending' | 'approved' | 'denied';

const HEADINGS: Readonly<Record<RequestTab, string>> = {
  pending: 'Pending requests',
  approved: 'Approved',
  denied: 'Declined',
};

const EMPTY: Readonly<Record<RequestTab, string>> = {
  pending: "No requests waiting. You'll get an email when someone asks.",
  approved: 'Nobody has access yet.',
  denied: 'No declined requests.',
};

/** Props of {@link RequestList}. Handlers resolve to whether the action worked. */
export interface RequestListProps {
  tab: RequestTab;
  requests: readonly AccessRequestSummary[];
  now: Date;
  onApprove: (request: AccessRequestSummary) => Promise<boolean>;
  onDeny: (request: AccessRequestSummary) => Promise<boolean>;
  onAllowAgain: (request: AccessRequestSummary) => Promise<boolean>;
  busyIds: ReadonlySet<string>;
  errorById: Readonly<Record<string, string>>;
}

/**
 * Cards for one tab with their actions. After a card leaves the list, focus moves to the card
 * that took its place, or to the section heading when none is left. Render with `key={tab}`.
 */
export function RequestList({
  tab,
  requests,
  now,
  onApprove,
  onDeny,
  onAllowAgain,
  busyIds,
  errorById,
}: RequestListProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previous = useRef<readonly AccessRequestSummary[]>(requests);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (previous.current !== requests) {
      const ids = new Set(requests.map((request) => request.userId));
      const removedAt = previous.current.findIndex((request) => !ids.has(request.userId));
      if (removedAt >= 0) focusIndex.current = removedAt;
      previous.current = requests;
    }
    if (focusIndex.current !== null) {
      const next = requests[Math.min(focusIndex.current, requests.length - 1)];
      const target = next ? document.getElementById(requestHeadingId(next.userId)) : null;
      (target ?? headingRef.current)?.focus();
      focusIndex.current = null;
    }
  }, [requests]);

  const actionsFor = (request: AccessRequestSummary) => {
    const busy = busyIds.has(request.userId);
    const name = request.displayName;
    if (tab === 'pending') {
      return (
        <>
          <Button
            loading={busy}
            aria-label={`Approve ${name}`}
            onClick={() => {
              void onApprove(request);
            }}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            aria-label={`Deny ${name}`}
            onClick={() => {
              void onDeny(request);
            }}
          >
            Deny
          </Button>
        </>
      );
    }
    if (tab === 'approved') {
      return (
        <Link to={`/tutees/${request.userId}`} aria-label={`Manage ${name}`}>
          Manage
        </Link>
      );
    }
    const cooldown = formatCooldown(now, request.nextRequestAt);
    return (
      <>
        <Button
          variant="secondary"
          loading={busy}
          aria-label={`Approve ${name}`}
          onClick={() => {
            void onApprove(request);
          }}
        >
          Approve
        </Button>
        {cooldown ? (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              aria-label={`Allow ${name} to ask again now`}
              onClick={() => {
                void onAllowAgain(request);
              }}
            >
              Allow to ask again now
            </Button>
            <span className={styles['muted']}>{`Can ask again after ${cooldown.at}`}</span>
          </>
        ) : (
          <span className={styles['muted']}>Can ask again now</span>
        )}
      </>
    );
  };

  return (
    <section aria-labelledby="request-list-heading">
      <h2 id="request-list-heading" ref={headingRef} tabIndex={-1}>
        {HEADINGS[tab]}
      </h2>
      {requests.length === 0 ? (
        <EmptyState>{EMPTY[tab]}</EmptyState>
      ) : (
        <ul className={styles['list']}>
          {requests.map((request) => (
            <RequestCard
              key={request.userId}
              request={request}
              actions={actionsFor(request)}
              error={errorById[request.userId]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
