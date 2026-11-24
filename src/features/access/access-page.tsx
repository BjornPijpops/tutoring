import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useServices } from '../../app/services-context';
import type { AccessRequest } from '../../core/domain/access-request';
import type { Identity } from '../../core/domain/user';
import { Button, Container, PageHeading, StatusAnnouncer, StatusMessage } from '../../shared/ui';
import { useAuth } from '../auth/auth-provider';
import { AccessRequestForm } from './access-request-form';
import { AccessStatusView } from './access-status-view';
import { getAccessView } from './access-view';

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly request: AccessRequest | null };

const TITLES = {
  form: 'Request access',
  pending: 'Request sent',
  approved: 'You have access',
  'denied-waiting': 'No access right now',
  'denied-can-ask': 'No access right now',
} as const;

function accessEnded(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'accessEnded' in state;
}

/** Tutee page: ask for access, or see where the request stands. */
export function AccessPage() {
  const { accessRequests, auth } = useServices();
  const { state: authState, refresh } = useAuth();
  const location = useLocation();
  const user = authState.status === 'signed-in' ? authState.session.user : null;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState('');
  const [userChanged, setUserChanged] = useState(false);
  const [reload, setReload] = useState(0);
  const isTutee = user?.role === 'tutee';

  useEffect(() => {
    if (isTutee) void refresh();
  }, [isTutee, refresh]);

  useEffect(() => {
    if (!isTutee) return;
    let active = true;
    void Promise.all([accessRequests.getMine(), auth.getIdentity()]).then(([mine, who]) => {
      if (!active) return;
      setNow(new Date());
      setIdentity(who.ok ? who.value : null);
      setLoad(mine.ok ? { status: 'ready', request: mine.value } : { status: 'error' });
    });
    return () => {
      active = false;
    };
  }, [accessRequests, auth, isTutee, reload]);

  const submit = useCallback(
    async (message: string) => {
      setBusy(true);
      setSubmitError(undefined);
      const result = await accessRequests.requestAccess(message);
      setBusy(false);
      setNow(new Date());
      if (result.ok) {
        setLoad({ status: 'ready', request: result.value });
        setAnnouncement('Request sent. The tutor will be told by email.');
        setUserChanged(true);
        void refresh();
        return;
      }
      const { error } = result;
      if (error.kind === 'conflict' && error.code === 'access_requests_closed') {
        setSubmitError('Requests are paused for now. Please try again later or contact the tutor.');
      } else if (error.kind === 'conflict') {
        setAnnouncement('Your request status has changed.');
        setUserChanged(true);
        setReload((value) => value + 1);
        void refresh();
      } else {
        setSubmitError("We couldn't send your request. Your message is still here, try again.");
      }
    },
    [accessRequests, refresh],
  );

  const checkAgain = useCallback(async () => {
    if (load.status !== 'ready') return;
    setChecking(true);
    const result = await accessRequests.getMine();
    setChecking(false);
    setNow(new Date());
    if (!result.ok) {
      setAnnouncement("We couldn't check. Try again.");
      return;
    }
    const before = load.request;
    const after = result.value;
    const changed =
      before?.status !== after?.status || before?.nextRequestAt !== after?.nextRequestAt;
    setLoad({ status: 'ready', request: after });
    if (changed) {
      setAnnouncement('Your request status has changed.');
      setUserChanged(true);
      void refresh();
    } else {
      setAnnouncement(after?.status === 'pending' ? 'Still waiting.' : 'Nothing has changed.');
    }
  }, [accessRequests, load, refresh]);

  if (user?.role === 'tutor') return <Navigate to="/access-requests" replace />;

  const request = load.status === 'ready' ? load.request : null;
  // The server's answer decides, not the possibly stale session: after "access ended" the
  // session still says approved until refreshed.
  if (request?.status === 'approved' && !userChanged) {
    return <Navigate to="/availability" replace />;
  }
  const view = getAccessView(request, now);
  const title = load.status === 'ready' ? TITLES[view] : TITLES.form;
  const form = (heading?: string) => (
    <AccessRequestForm
      identity={identity}
      onSubmit={submit}
      busy={busy}
      error={submitError}
      heading={heading}
    />
  );

  return (
    <Container>
      <PageHeading>{title}</PageHeading>
      <StatusAnnouncer message={announcement} />
      {accessEnded(location.state) ? (
        <StatusMessage status="info">Your access has ended.</StatusMessage>
      ) : null}
      {load.status === 'loading' ? (
        <div aria-busy="true">
          <StatusMessage status="info">Loading your request...</StatusMessage>
        </div>
      ) : null}
      {load.status === 'error' ? (
        <>
          <StatusMessage status="error">
            {"We couldn't load your request. Check your connection and try again."}
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
      {load.status === 'ready' && request === null ? form() : null}
      {load.status === 'ready' && request !== null ? (
        <AccessStatusView
          key={view}
          request={request}
          now={now}
          onCheckAgain={() => {
            void checkAgain();
          }}
          checking={checking}
          focusHeading={userChanged}
        >
          {form('Ask again')}
        </AccessStatusView>
      ) : null}
    </Container>
  );
}
