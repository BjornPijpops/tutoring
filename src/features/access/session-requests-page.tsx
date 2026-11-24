import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services-context';
import { toMs } from '../../core/domain/interval';
import type { SessionDecision, TutorSessionRequest } from '../../core/domain/session-request';
import { formatSessionDuration } from '../../core/domain/session-request-rules';
import { formatEventWhen } from '../../shared/dates/brussels';
import { announceRequestsChanged } from './pending-count';
import { Button, Container, PageHeading, StatusMessage } from '../../shared/ui';

const CONFLICT_ERROR =
  'This request can no longer be accepted because the time is unavailable. Review the request and try again.';
const UPDATE_ERROR = "We couldn't update this request. Check your connection and try again.";

export function SessionRequestsPage() {
  const { sessionRequests } = useServices();
  const [items, setItems] = useState<readonly TutorSessionRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<{ id: string; decision: SessionDecision } | null>(null);

  const load = useCallback(() => {
    return sessionRequests.listPending().then((result) => {
      setFailed(!result.ok);
      setItems(result.ok ? result.value : []);
    });
  }, [sessionRequests]);
  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: SessionDecision) => {
    setBusy({ id, decision });
    setError('');
    setMessage('');
    const result = await sessionRequests.decide(id, decision);
    setBusy(null);
    if (!result.ok) {
      setError(
        result.error.kind === 'conflict' && decision === 'accepted' ? CONFLICT_ERROR : UPDATE_ERROR,
      );
      return;
    }
    const count = result.value.overlapDeclinedCount;
    const base = decision === 'accepted' ? 'Request accepted.' : 'Request declined.';
    setMessage(count > 0 ? `${base} ${String(count)} overlapping requests were declined.` : base);
    announceRequestsChanged();
    await load();
  };

  return (
    <Container>
      <PageHeading>Session requests</PageHeading>
      <div role="status">{message}</div>
      {error ? <StatusMessage status="error">{error}</StatusMessage> : null}
      {items === null ? (
        <p role="status" aria-busy="true">
          Loading session requests…
        </p>
      ) : failed ? (
        <>
          <StatusMessage status="error">
            We couldn&apos;t load session requests. Check your connection and try again.
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
        <p>There are no pending session requests.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const working = busy?.id === item.id;
            return (
              <li key={item.id} aria-busy={working}>
                <strong>{item.requesterName}</strong>{' '}
                <span>{formatEventWhen(item.startsAt, item.endsAt)}</span>{' '}
                <span>
                  ({formatSessionDuration((toMs(item.endsAt) - toMs(item.startsAt)) / 60000)})
                </span>{' '}
                <span>Pending</span>{' '}
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    void decide(item.id, 'accepted');
                  }}
                >
                  {working && busy.decision === 'accepted' ? 'Accepting…' : 'Accept'}
                </Button>{' '}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    void decide(item.id, 'declined');
                  }}
                >
                  {working && busy.decision === 'declined' ? 'Declining…' : 'Decline'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
