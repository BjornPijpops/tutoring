import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useServices } from '../../app/services-context';
import {
  Button,
  ConfirmDialog,
  Container,
  DefinitionList,
  StatusAnnouncer,
  StatusBadge,
  StatusMessage,
} from '../../shared/ui';
import { formatMoment } from '../../shared/dates/brussels';
import { allowedActions } from '../../core/domain/tutee-transitions';
import type {
  SessionPolicy,
  TuteeAction,
  TuteeDetail,
  TuteeSession,
} from '../../core/domain/tutee';
import type { PortError } from '../../core/ports/port-error';
import { announceRequestsChanged } from '../access/pending-count';
import {
  ACTION_LABEL,
  BUSY_LABEL,
  CANCEL_ACCEPTED_LABEL,
  DETAIL_MESSAGES,
  EVENT_LABEL,
  SESSION_CANCEL_DIALOG,
  STATUS_LABEL,
  accessRequestCount,
  badgeStatus,
  blockDialog,
  blockSuccess,
  detailSessionSummary,
  immediateSuccess,
  revokeDialog,
  revokeSuccess,
  sessionsEnded,
} from './tutee-messages';
import {
  canAskAgainText,
  cooldownCleared,
  durationText,
  historyText,
  isCancellable,
  sessionLabel,
} from './tutee-view-model';
import type { TuteeListState } from './tutees-page';
import styles from './tutees.module.css';

type Load = 'loading' | 'ready' | 'error' | 'not-found';
type Dialog = { kind: 'revoke' } | { kind: 'block' } | { kind: 'session'; id: string } | null;
type ActionKey = TuteeAction | 'allow-again';

/** One tutee: facts, sessions, decision history and the access actions. */
export function TuteeDetailPage() {
  const { userId = '' } = useParams();
  const { tutees } = useServices();
  const location = useLocation();

  const [detail, setDetail] = useState<TuteeDetail | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [announcement, setAnnouncement] = useState('');
  const [pending, setPending] = useState<ActionKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cancelAll, setCancelAll] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const focusHeading = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [tick, setTick] = useState(0);
  const reload = () => {
    setTick((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    void tutees.get(userId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setDetail(result.value);
        setLoad('ready');
      } else {
        setLoad(result.error.kind === 'not-found' ? 'not-found' : 'error');
      }
    });
    return () => {
      active = false;
    };
  }, [tutees, userId, tick]);

  useEffect(() => {
    if (focusHeading.current && load === 'ready') {
      headingRef.current?.focus();
      focusHeading.current = false;
    }
  }, [load, detail]);

  const backState = location.state as TuteeListState | null;

  const back = (
    <Link to="/tutees" state={backState ?? undefined}>
      Back to Tutees
    </Link>
  );

  if (load === 'loading') {
    return (
      <Container>
        {back}
        <StatusMessage status="info">{DETAIL_MESSAGES.loading}</StatusMessage>
      </Container>
    );
  }
  if (load === 'not-found') {
    return (
      <Container>
        {back}
        <h1>Tutee not found</h1>
        <StatusMessage status="warning">{DETAIL_MESSAGES.notFound}</StatusMessage>
      </Container>
    );
  }
  if (load === 'error' || !detail) {
    return (
      <Container>
        {back}
        <StatusMessage status="error">{DETAIL_MESSAGES.loadError}</StatusMessage>
        <Button
          variant="secondary"
          onClick={() => {
            setLoad('loading');
            reload();
          }}
        >
          Try again
        </Button>
      </Container>
    );
  }

  const { tutee, sessions, events } = detail;
  const name = tutee.displayName;
  const now = new Date();
  const cleared = cooldownCleared(tutee, now);
  const actions = allowedActions(tutee.status, cleared);
  const cooldownStatus = tutee.status === 'denied' || tutee.status === 'revoked';

  function refreshAfterConflict(error: PortError): boolean {
    if (error.kind === 'conflict' || error.kind === 'not-found') {
      reload();
      setAnnouncement(DETAIL_MESSAGES.stale);
      return true;
    }
    return false;
  }

  async function run(action: ActionKey) {
    setPending(action);
    setActionError(null);
    const result =
      action === 'allow-again'
        ? await tutees.allowAgain(tutee.userId)
        : await tutees.act(tutee.userId, action);
    setPending(null);
    if (!result.ok) {
      if (!refreshAfterConflict(result.error)) setActionError(DETAIL_MESSAGES.updateError);
      return;
    }
    reload();
    setAnnouncement(immediateSuccess(name, action));
    announceRequestsChanged();
  }

  async function confirmDecision(action: 'revoke' | 'block') {
    const policy: SessionPolicy = cancelAll ? 'cancel_all' : 'keep';
    setPending(action);
    setDialogError(undefined);
    const result = await tutees.act(tutee.userId, action, policy);
    setPending(null);
    if (!result.ok) {
      if (result.error.kind === 'conflict' || result.error.kind === 'not-found') {
        setDialog(null);
        refreshAfterConflict(result.error);
        return;
      }
      setDialogError(action === 'revoke' ? revokeDialog(name).error : blockDialog(name).error);
      return;
    }
    setDialog(null);
    focusHeading.current = true;
    reload();
    setAnnouncement(
      action === 'revoke'
        ? revokeSuccess(name, policy, result.value)
        : blockSuccess(name, policy, result.value),
    );
    announceRequestsChanged();
  }

  async function confirmSessionCancel(id: string) {
    setPending('revoke');
    setDialogError(undefined);
    const result = await tutees.cancelSession(id);
    setPending(null);
    if (!result.ok) {
      if (result.error.kind === 'conflict' || result.error.kind === 'not-found') {
        setDialog(null);
        reload();
        setSessionError(null);
        setAnnouncement(DETAIL_MESSAGES.sessionStale);
        return;
      }
      setDialogError(DETAIL_MESSAGES.cancelSessionError);
      return;
    }
    setDialog(null);
    setSessionError(null);
    reload();
    setAnnouncement(DETAIL_MESSAGES.sessionCancelled);
    announceRequestsChanged();
  }

  function openDecision(kind: 'revoke' | 'block') {
    setCancelAll(false);
    setDialogError(undefined);
    setDialog({ kind });
  }

  function openSessionCancel(session: TuteeSession) {
    setDialogError(undefined);
    setSessionError(null);
    setDialog({ kind: 'session', id: session.id });
  }

  function closeDialog() {
    if (pending) return;
    setDialog(null);
    setDialogError(undefined);
  }

  const revoke = revokeDialog(name);
  const block = blockDialog(name);
  const helpId = 'tutee-cancel-accepted-help';
  const decisionDialog =
    dialog?.kind === 'revoke' ? revoke : dialog?.kind === 'block' ? block : null;
  const decisionKind = dialog?.kind === 'revoke' || dialog?.kind === 'block' ? dialog.kind : null;

  const facts = [
    { label: 'Status', value: STATUS_LABEL[tutee.status] },
    { label: 'Email', value: tutee.email },
    { label: 'Access requested', value: formatMoment(tutee.requestedAt) },
    {
      label: 'Last decision',
      value: tutee.decidedAt ? formatMoment(tutee.decidedAt) : 'Not decided yet',
    },
    { label: 'Access requests', value: accessRequestCount(tutee.requestCount) },
    { label: 'Can ask again', value: canAskAgainText(tutee, now) },
    {
      label: 'Sessions',
      value: detailSessionSummary(tutee.pendingSessions, tutee.acceptedFutureSessions),
    },
    { label: 'History', value: historyText(detail.historyStartsAt, events.length) },
  ];

  return (
    <Container>
      {back}
      <StatusAnnouncer message={announcement} />
      <div className={styles['titleRow']}>
        <h1 ref={headingRef} tabIndex={-1}>
          {name}
        </h1>
        <StatusBadge status={badgeStatus(tutee.status)}>{STATUS_LABEL[tutee.status]}</StatusBadge>
      </div>
      <DefinitionList items={facts} />
      {tutee.message ? <p className={styles['muted']}>{tutee.message}</p> : null}

      <section className={styles['stack']} aria-labelledby="tutee-actions">
        <h2 id="tutee-actions">Access actions</h2>
        <div className={styles['actions']}>
          {actions.map((action) => {
            return (
              <Button
                key={action}
                variant={action === 'approve' ? 'primary' : 'secondary'}
                loading={pending === action}
                disabled={pending !== null}
                onClick={() => {
                  if (action === 'revoke' || action === 'block') openDecision(action);
                  else void run(action);
                }}
              >
                {pending === action ? BUSY_LABEL[action] : ACTION_LABEL[action]}
              </Button>
            );
          })}
        </div>
        {cooldownStatus && cleared ? (
          <p className={styles['muted']}>{DETAIL_MESSAGES.canAskAgainNow}</p>
        ) : null}
        {actionError ? <StatusMessage status="error">{actionError}</StatusMessage> : null}
      </section>

      <section className={styles['stack']} aria-labelledby="tutee-sessions">
        <h2 id="tutee-sessions">Sessions</h2>
        {sessionError ? <StatusMessage status="error">{sessionError}</StatusMessage> : null}
        {sessions.length === 0 ? (
          <p className={styles['muted']}>No sessions yet.</p>
        ) : (
          <ul className={styles['rows']}>
            {sessions.map((session) => (
              <li key={session.id} className={styles['row']}>
                <span>
                  {formatMoment(session.startsAt)} · {durationText(session)} ·{' '}
                  <strong>{sessionLabel(session, now)}</strong>
                </span>
                {isCancellable(session, now) ? (
                  <Button
                    variant="secondary"
                    aria-label={`Cancel session on ${formatMoment(session.startsAt)}`}
                    onClick={() => {
                      openSessionCancel(session);
                    }}
                  >
                    Cancel session
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles['stack']} aria-labelledby="tutee-history">
        <h2 id="tutee-history">Decision history</h2>
        {events.length === 0 ? (
          <p className={styles['muted']}>{historyText(detail.historyStartsAt, 0)}</p>
        ) : (
          <ol className={styles['timeline']}>
            {events.map((event) => (
              <li key={event.id} className={styles['row']}>
                <span>
                  <strong>{EVENT_LABEL[event.action]}</strong> · {formatMoment(event.createdAt)}
                </span>
                {event.sessionsEnded > 0 ? (
                  <span className={styles['muted']}>{sessionsEnded(event.sessionsEnded)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={decisionKind !== null}
        title={decisionDialog?.title ?? ''}
        confirmLabel={decisionDialog?.confirm ?? ''}
        cancelLabel={decisionDialog?.cancel ?? ''}
        {...(dialogError && decisionKind ? { error: dialogError } : {})}
        busy={pending === 'revoke' || pending === 'block'}
        onCancel={closeDialog}
        onConfirm={() => (decisionKind ? confirmDecision(decisionKind) : undefined)}
      >
        <p>{decisionDialog?.body}</p>
        <label className={styles['checkbox']}>
          <input
            type="checkbox"
            checked={cancelAll}
            aria-describedby={helpId}
            onChange={(event) => {
              setCancelAll(event.target.checked);
            }}
          />
          <span>{CANCEL_ACCEPTED_LABEL}</span>
        </label>
        <p id={helpId} className={styles['muted']}>
          {decisionDialog?.help}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === 'session'}
        title={SESSION_CANCEL_DIALOG.title}
        confirmLabel={SESSION_CANCEL_DIALOG.confirm}
        cancelLabel={SESSION_CANCEL_DIALOG.cancel}
        {...(dialogError && dialog?.kind === 'session' ? { error: dialogError } : {})}
        busy={pending !== null && dialog?.kind === 'session'}
        onCancel={closeDialog}
        onConfirm={() => (dialog?.kind === 'session' ? confirmSessionCancel(dialog.id) : undefined)}
      >
        <p>{SESSION_CANCEL_DIALOG.body}</p>
      </ConfirmDialog>
    </Container>
  );
}
