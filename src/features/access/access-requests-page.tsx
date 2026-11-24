import { useCallback, useEffect, useMemo, useState } from 'react';
import { useServices } from '../../app/services-context';
import {
  MAX_PENDING_REQUESTS,
  type AccessRequest,
  type AccessRequestSummary,
} from '../../core/domain/access-request';
import type { Result } from '../../core/domain/result';
import type { PortError } from '../../core/ports';
import {
  Button,
  Container,
  FilterTabs,
  PageHeading,
  StatusAnnouncer,
  StatusMessage,
} from '../../shared/ui';
import { announceRequestsChanged } from './pending-count';
import { RequestList, type RequestTab } from './request-list';

/** Most requests the server returns; more may exist. */
const LIST_LIMIT = 200;
const SAVE_ERROR = "We couldn't save that. Try again.";

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly requests: readonly AccessRequestSummary[] };

function merge(summary: AccessRequestSummary, request: AccessRequest): AccessRequestSummary {
  return {
    ...summary,
    status: request.status,
    message: request.message,
    requestedAt: request.requestedAt,
    decidedAt: request.decidedAt,
    nextRequestAt: request.nextRequestAt,
    requestCount: request.requestCount,
  };
}

function plural(count: number): string {
  return `${String(count)} ${count === 1 ? 'request' : 'requests'}`;
}

/** Tutor page: decide on access requests. The route guard and the backend restrict it. */
export function AccessRequestsPage() {
  const { accessRequests } = useServices();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [tab, setTab] = useState<RequestTab>('pending');
  const [now, setNow] = useState(() => new Date());
  const [announcement, setAnnouncement] = useState('');
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [errorById, setErrorById] = useState<Readonly<Record<string, string>>>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void accessRequests.listRequests().then((result) => {
      if (!active) return;
      setNow(new Date());
      setLoad(result.ok ? { status: 'ready', requests: result.value } : { status: 'error' });
    });
    return () => {
      active = false;
    };
  }, [accessRequests, reload]);

  const requests = useMemo(() => (load.status === 'ready' ? load.requests : []), [load]);
  const counts = useMemo(
    () => ({
      pending: requests.filter((request) => request.status === 'pending').length,
      approved: requests.filter((request) => request.status === 'approved').length,
      denied: requests.filter((request) => request.status === 'denied').length,
    }),
    [requests],
  );
  const shown = useMemo(
    () => requests.filter((request) => request.status === tab),
    [requests, tab],
  );

  const act = useCallback(
    async (
      request: AccessRequestSummary,
      run: () => Promise<Result<AccessRequest, PortError>>,
      done: string,
    ): Promise<boolean> => {
      const trigger = document.activeElement;
      setBusyIds((ids) => new Set(ids).add(request.userId));
      setErrorById(({ [request.userId]: _removed, ...rest }) => rest);
      const result = await run();
      setBusyIds((ids) => {
        const next = new Set(ids);
        next.delete(request.userId);
        return next;
      });
      setNow(new Date());
      if (result.ok) {
        const updated = merge(request, result.value);
        setLoad((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                requests: current.requests.map((item) =>
                  item.userId === request.userId ? updated : item,
                ),
              }
            : current,
        );
        setAnnouncement(done);
        announceRequestsChanged();
        return true;
      }
      if (result.error.kind === 'unavailable') {
        setErrorById((errors) => ({ ...errors, [request.userId]: SAVE_ERROR }));
        window.setTimeout(() => {
          if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
        }, 0);
      } else {
        setAnnouncement('This request changed. The list has been updated.');
        setReload((value) => value + 1);
        announceRequestsChanged();
      }
      return false;
    },
    [],
  );

  const left = (status: AccessRequestSummary['status']) =>
    status === 'pending' ? ` ${plural(counts.pending - 1)} left.` : '';

  const approve = (request: AccessRequestSummary) =>
    act(
      request,
      () => accessRequests.decide(request.userId, 'approved'),
      `${request.displayName} approved.${left(request.status)}`,
    );
  const deny = (request: AccessRequestSummary) =>
    act(
      request,
      () => accessRequests.decide(request.userId, 'denied'),
      `${request.displayName} denied.${left(request.status)}`,
    );
  const revoke = (request: AccessRequestSummary) =>
    act(
      request,
      () => accessRequests.decide(request.userId, 'denied'),
      `Access for ${request.displayName} revoked.`,
    );
  const allowAgain = (request: AccessRequestSummary) =>
    act(
      request,
      () => accessRequests.allowRequestAgain(request.userId),
      `${request.displayName} can ask again now.`,
    );

  return (
    <Container>
      <PageHeading lead="People who asked to see your availability.">Access requests</PageHeading>
      <StatusAnnouncer message={announcement} />
      {load.status === 'loading' ? (
        <div aria-busy="true">
          <StatusMessage status="info">Loading requests...</StatusMessage>
        </div>
      ) : null}
      {load.status === 'error' ? (
        <>
          <StatusMessage status="error">
            {"We couldn't load the requests. Check your connection and try again."}
          </StatusMessage>
          <Button
            onClick={() => {
              setLoad({ status: 'loading' });
              setReload((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </>
      ) : null}
      {load.status === 'ready' ? (
        <>
          {counts.pending >= MAX_PENDING_REQUESTS ? (
            <StatusMessage status="warning">
              {`${String(MAX_PENDING_REQUESTS)} requests are waiting. New requests are paused until you clear some.`}
            </StatusMessage>
          ) : null}
          {requests.length >= LIST_LIMIT ? (
            <StatusMessage status="info">
              {`Showing the latest ${String(LIST_LIMIT)} requests.`}
            </StatusMessage>
          ) : null}
          <FilterTabs
            label="Show requests"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'pending', label: 'Pending', count: counts.pending },
              { value: 'approved', label: 'Approved', count: counts.approved },
              { value: 'denied', label: 'Declined', count: counts.denied },
            ]}
          />
          <RequestList
            key={tab}
            tab={tab}
            requests={shown}
            now={now}
            onApprove={approve}
            onDeny={deny}
            onRevoke={revoke}
            onAllowAgain={allowAgain}
            busyIds={busyIds}
            errorById={errorById}
          />
        </>
      ) : null}
    </Container>
  );
}
