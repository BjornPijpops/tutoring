import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useServices } from '../../app/services-context';
import { toMs } from '../../core/domain/interval';
import type { SessionRequest } from '../../core/domain/session-request';
import { formatSessionDuration } from '../../core/domain/session-request-rules';
import { formatEventWhen } from '../../shared/dates/brussels';
import { Button, ConfirmDialog, Container, PageHeading, StatusMessage } from '../../shared/ui';

const STATUS_LABEL: Readonly<Record<SessionRequest['status'], string>> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
};
const UPDATE_ERROR = "We couldn't update this request. Check your connection and try again.";

export function MySessionsPage() {
  const { sessionRequests } = useServices();
  const [items, setItems] = useState<readonly SessionRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<SessionRequest | null>(null);
  const [now, setNow] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    return sessionRequests.listMine().then((result) => {
      setFailed(!result.ok);
      setItems(result.ok ? result.value : []);
      setNow(Date.now());
    });
  }, [sessionRequests]);
  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (item: SessionRequest) => {
    setBusyId(item.id);
    setError('');
    const result = await sessionRequests.cancel(item.id);
    setBusyId(null);
    if (result.ok) {
      setConfirming(null);
      setMessage('Request cancelled.');
      await load();
    } else setError(UPDATE_ERROR);
  };

  const isActive = (item: SessionRequest) =>
    (item.status === 'pending' || item.status === 'accepted') && toMs(item.endsAt) > now;
  const groups = [
    { title: 'Pending', rows: (items ?? []).filter((i) => i.status === 'pending' && isActive(i)) },
    {
      title: 'Accepted',
      rows: (items ?? []).filter((i) => i.status === 'accepted' && isActive(i)),
    },
    { title: 'Past and closed', rows: (items ?? []).filter((i) => !isActive(i)) },
  ].filter((group) => group.rows.length > 0);

  return (
    <Container>
      <PageHeading>My sessions</PageHeading>
      <div role="status">{message}</div>
      {error && !confirming ? <StatusMessage status="error">{error}</StatusMessage> : null}
      {items === null ? (
        <p role="status" aria-busy="true">
          Loading your sessions…
        </p>
      ) : failed ? (
        <>
          <StatusMessage status="error">
            We couldn&apos;t load your sessions. Check your connection and try again.
          </StatusMessage>
          <Button
            type="button"
            onClick={() => {
              void load();
            }}
          >
            Try again
          </Button>
        </>
      ) : items.length === 0 ? (
        <>
          <p>You have no sessions or requests yet.</p>
          <Link to="/availability">Browse availability</Link>
        </>
      ) : (
        groups.map((group) => (
          <section key={group.title} aria-labelledby={`group-${group.title}`}>
            <h2 id={`group-${group.title}`}>{group.title}</h2>
            <ul>
              {group.rows.map((item) => (
                <li key={item.id} aria-busy={busyId === item.id}>
                  <span>{formatEventWhen(item.startsAt, item.endsAt)}</span>{' '}
                  <span>
                    ({formatSessionDuration((toMs(item.endsAt) - toMs(item.startsAt)) / 60000)})
                  </span>{' '}
                  <strong>{STATUS_LABEL[item.status]}</strong>{' '}
                  {isActive(item) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busyId === item.id}
                      onClick={() => {
                        if (item.status === 'accepted') {
                          setError('');
                          setConfirming(item);
                        } else void cancel(item);
                      }}
                    >
                      {busyId === item.id
                        ? 'Cancelling…'
                        : item.status === 'accepted'
                          ? 'Cancel session'
                          : 'Cancel request'}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <ConfirmDialog
        open={confirming !== null}
        title="Cancel this session?"
        confirmLabel="Cancel session"
        cancelLabel="Keep session"
        busy={busyId !== null}
        {...(error ? { error } : {})}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => (confirming ? cancel(confirming) : undefined)}
      >
        This accepted session will be cancelled and the time will become available again.
      </ConfirmDialog>
    </Container>
  );
}
