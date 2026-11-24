import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../../app/services-context';
import { addDays, startOfWeek, type IsoDate } from '../../core/domain/local-time';
import { overlaps, toMs, type Interval } from '../../core/domain/interval';
import type { SessionRequest } from '../../core/domain/session-request';
import { formatDayLabel, formatEventWhen, todayInBrussels } from '../../shared/dates/brussels';
import {
  Button,
  ConfirmDialog,
  Container,
  Dialog,
  PageHeading,
  StatusMessage,
} from '../../shared/ui';
import {
  SESSION_VALIDATION_MESSAGES,
  formatSessionDuration,
  validateSessionRequestRange,
} from '../../core/domain/session-request-rules';
import { SelectableTimeGrid } from './selectable-time-grid';
import { WeekNavigator } from './week-navigator';
import { buildWeekModel, weekRange } from './calendar-view-model';
import { localRangeToInterval } from './time-grid-selection';
import type { LocalTimeRange, GridBlock } from './time-grid-model';
import { sessionBlocks } from './session-request-view-model';

const UNAVAILABLE_MESSAGE = 'This time is no longer available. Choose another time.';
const CANCEL_ERROR = "We couldn't update this request. Check your connection and try again.";

export function AvailabilityPage() {
  const { blockedTime, sessionRequests } = useServices();
  const currentWeekStart = startOfWeek(todayInBrussels());
  const [weekStart, setWeekStart] = useState<IsoDate>(currentWeekStart);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{
    blocked: readonly Interval[];
    own: readonly SessionRequest[];
  } | null>(null);
  const [draft, setDraft] = useState<LocalTimeRange | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [detail, setDetail] = useState<SessionRequest | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  useEffect(() => {
    let active = true;
    const range = weekRange(weekStart);
    void Promise.all([
      blockedTime.listBlockedIntervals(range),
      sessionRequests.listMine({ startsAt: range.from, endsAt: range.to }),
    ]).then(([blocked, own]) => {
      if (!active) return;
      if (blocked.ok && own.ok) {
        setData({ blocked: blocked.value, own: own.value });
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [blockedTime, sessionRequests, weekStart, reload]);
  const days = data
    ? buildWeekModel({ weekStart, today: todayInBrussels(), blocked: data.blocked })
    : null;
  const blocks = useMemo<readonly GridBlock[]>(
    () => (data ? sessionBlocks(data.blocked, data.own) : []),
    [data],
  );
  const closeDialog = () => {
    setDraft(null);
    setDialogError('');
  };
  const closeDetail = () => {
    setDetail(null);
    setConfirmingCancel(false);
    setCancelError('');
  };
  const cancelDetail = async () => {
    if (!detail) return;
    setCancelling(true);
    setCancelError('');
    const result = await sessionRequests.cancel(detail.id);
    setCancelling(false);
    if (!result.ok) {
      setCancelError(CANCEL_ERROR);
      return;
    }
    closeDetail();
    setMessage('Request cancelled.');
    setReload((v) => v + 1);
  };
  if (failed)
    return (
      <Container>
        <PageHeading>Availability</PageHeading>
        <p role="alert">We couldn't load availability. Check your connection and try again.</p>
        <Button
          type="button"
          onClick={() => {
            setReload((v) => v + 1);
          }}
        >
          Try again
        </Button>
      </Container>
    );
  return (
    <Container>
      <PageHeading lead="Times when the tutor is not available.">Availability</PageHeading>
      <p>Times are shown in Brussels time (Europe/Brussels). Calendar hours: 08:00–22:00.</p>
      <WeekNavigator
        weekStart={weekStart}
        currentWeekStart={currentWeekStart}
        onChange={setWeekStart}
      />
      {days ? (
        <SelectableTimeGrid
          days={days}
          blocks={blocks}
          busy={false}
          labelId="availability-heading"
          onSelect={(range) => {
            setDialogError('');
            setMessage('');
            const interval = localRangeToInterval(range);
            const taken =
              data !== null &&
              (data.blocked.some((blocked) => overlaps(blocked, interval)) ||
                data.own.some((r) => r.status === 'accepted' && overlaps(r, interval)));
            if (taken) {
              setSelectionError(UNAVAILABLE_MESSAGE);
              return;
            }
            setSelectionError('');
            setDraft(range);
          }}
          onActivateBlock={(blockKey) => {
            const request = data?.own.find((r) => `own-${r.id}` === blockKey);
            if (!request) return;
            setCancelError('');
            setConfirmingCancel(false);
            setDetail(request);
          }}
          onDeleteBlock={() => undefined}
          onShiftWeek={(delta) => {
            setWeekStart(addDays(weekStart, delta * 7));
          }}
        />
      ) : (
        <p role="status">Loading availability…</p>
      )}
      <p role="status">{message}</p>
      {selectionError ? <StatusMessage status="error">{selectionError}</StatusMessage> : null}
      <Dialog
        open={detail !== null && !confirmingCancel}
        title="Your session request"
        onClose={closeDetail}
      >
        {detail ? (
          <div aria-busy={cancelling}>
            <p>
              {formatEventWhen(detail.startsAt, detail.endsAt)} (
              {formatSessionDuration((toMs(detail.endsAt) - toMs(detail.startsAt)) / 60000)}) in
              Brussels time.
            </p>
            <p>Status: {detail.status === 'accepted' ? 'Accepted' : 'Pending'}</p>
            {cancelError ? <StatusMessage status="error">{cancelError}</StatusMessage> : null}
            <Button
              type="button"
              variant="secondary"
              disabled={cancelling}
              onClick={() => {
                if (detail.status === 'accepted') setConfirmingCancel(true);
                else void cancelDetail();
              }}
            >
              {cancelling
                ? 'Cancelling…'
                : detail.status === 'accepted'
                  ? 'Cancel session'
                  : 'Cancel request'}
            </Button>
            <Button type="button" disabled={cancelling} onClick={closeDetail}>
              Close
            </Button>
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={detail !== null && confirmingCancel}
        title="Cancel this session?"
        confirmLabel="Cancel session"
        cancelLabel="Keep session"
        busy={cancelling}
        {...(cancelError ? { error: cancelError } : {})}
        onCancel={closeDetail}
        onConfirm={cancelDetail}
      >
        This accepted session will be cancelled and the time will become available again.
      </ConfirmDialog>
      <Dialog open={draft !== null} title="Request this tutoring time?" onClose={closeDialog}>
        {draft ? (
          <div aria-busy={sending}>
            <p>
              You are requesting {formatDayLabel(draft.date)} {clock(draft.startMinutes)}–
              {clock(draft.endMinutes)} (
              {formatSessionDuration(draft.endMinutes - draft.startMinutes)}) in Brussels time. Your
              tutor must accept this request before it becomes a session.
            </p>
            {dialogError ? <StatusMessage status="error">{dialogError}</StatusMessage> : null}
            <Button
              type="button"
              disabled={sending}
              onClick={() => {
                const range = localRangeToInterval(draft);
                const invalid = validateSessionRequestRange(range);
                if (invalid) {
                  setDialogError(SESSION_VALIDATION_MESSAGES[invalid]);
                  return;
                }
                setSending(true);
                setDialogError('');
                void sessionRequests.create(range).then((result) => {
                  setSending(false);
                  if (result.ok) {
                    setMessage('Request sent. It is pending tutor approval.');
                    setDraft(null);
                    setReload((v) => v + 1);
                  } else setDialogError(result.error.message);
                });
              }}
            >
              {sending ? 'Sending…' : 'Send request'}
            </Button>
            <Button type="button" variant="secondary" disabled={sending} onClick={closeDialog}>
              Go back
            </Button>
          </div>
        ) : null}
      </Dialog>
    </Container>
  );
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
