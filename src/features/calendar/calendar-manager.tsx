import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useServices } from '../../app/services-context';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { mergeIntervals } from '../../core/domain/blocked-intervals';
import { addDays, startOfWeek, type IsoDate } from '../../core/domain/local-time';
import type { PortResult } from '../../core/ports';
import { formatEventWhen, todayInBrussels } from '../../shared/dates/brussels';
import { ConfirmDialog } from '../../shared/ui';
import { useAuth } from '../auth/auth-provider';
import { buildWeekModel, weekRange } from './calendar-view-model';
import { CalendarEventDialog } from './calendar-event-dialog';
import { EventList } from './event-list';
import { ImportPanel } from './import-panel';
import { SelectableTimeGrid } from './selectable-time-grid';
import { toGridBlock } from './tutor-grid-blocks';
import { WeekNavigator } from './week-navigator';
import { WeekView, type WeekLoadState } from './week-view';
import styles from './calendar.module.css';

interface Loaded {
  readonly key: string;
  readonly weekStart: IsoDate;
  readonly outcome: Awaited<PortResult<readonly CalendarEvent[]>>;
}
interface PendingDelete {
  readonly event: CalendarEvent;
  readonly busy: boolean;
  readonly error?: string;
}
interface DialogState {
  readonly mode: 'create' | 'edit' | 'imported';
  readonly event?: CalendarEvent;
  readonly initial?: { date: IsoDate; start: number; end: number };
  readonly error?: string;
  readonly busy: boolean;
}

/** Tutor calendar orchestration: loading, intent handling, dialog and persistence. */
export function CalendarManager() {
  const { calendarEvents } = useServices();
  const { signOut } = useAuth();
  const currentWeekStart = startOfWeek(todayInBrussels());
  const [weekStart, setWeekStart] = useState<IsoDate>(currentWeekStart);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [announce, setAnnounce] = useState('');
  const eventsHeading = useRef<HTMLHeadingElement>(null);
  const saving = useRef(false);
  const key = `${weekStart}#${String(reload)}`;
  useEffect(() => {
    let active = true;
    void calendarEvents.listEvents(weekRange(weekStart)).then((outcome) => {
      if (active) setLoaded({ key, weekStart, outcome });
    });
    return () => {
      active = false;
    };
  }, [calendarEvents, weekStart, key]);
  const events = useMemo(() => (loaded?.outcome.ok ? loaded.outcome.value : []), [loaded]);
  const blocks = useMemo(() => events.map(toGridBlock), [events]);
  const days = useMemo(
    () =>
      loaded?.outcome.ok
        ? buildWeekModel({
            weekStart: loaded.weekStart,
            today: todayInBrussels(),
            blocked: mergeIntervals(events, weekRange(loaded.weekStart)),
            events,
          })
        : null,
    [loaded, events],
  );
  const busy = loaded?.key !== key;
  let state: WeekLoadState = 'loading';
  if (loaded?.outcome.ok) state = 'ready';
  else if (loaded && !busy && !loaded.outcome.ok)
    state = loaded.outcome.error.kind === 'forbidden' ? 'forbidden' : 'error';
  const refresh = useCallback(() => {
    setReload((value) => value + 1);
  }, []);
  const create = (event: Parameters<ComponentProps<typeof CalendarEventDialog>['onCreate']>[0]) => {
    if (!dialog || saving.current) return;
    const activeDialog = dialog;
    saving.current = true;
    const result = calendarEvents.addEvents([event]);
    setDialog({ ...activeDialog, busy: true });
    void result.then((outcome) => {
      saving.current = false;
      if (outcome.ok) {
        setDialog(null);
        setAnnounce('Event created.');
        refresh();
      } else
        setDialog({
          ...activeDialog,
          busy: false,
          error: "We couldn't save this event. Check your connection and try again.",
        });
    });
  };
  const update = (event: CalendarEvent) => {
    if (!dialog || saving.current) return;
    const activeDialog = dialog;
    saving.current = true;
    const expected = event.updatedAt ?? '';
    setDialog({ ...activeDialog, busy: true });
    void calendarEvents.updateEvent(event, expected).then((outcome) => {
      saving.current = false;
      if (outcome.ok) {
        setDialog(null);
        setAnnounce('Event updated.');
        refresh();
      } else
        setDialog({
          ...activeDialog,
          busy: false,
          error:
            outcome.error.kind === 'conflict'
              ? 'This time changed. Review the times and try again.'
              : "We couldn't save this event. Check your connection and try again.",
        });
    });
  };
  const confirmDelete = async () => {
    if (!pendingDelete || saving.current) return;
    saving.current = true;
    setPendingDelete({ ...pendingDelete, busy: true });
    const result = await calendarEvents.removeEvent(pendingDelete.event.id);
    saving.current = false;
    if (!result.ok) {
      setPendingDelete({
        ...pendingDelete,
        busy: false,
        error: "We couldn't delete the event. Try again.",
      });
      return;
    }
    setPendingDelete(null);
    setAnnounce('Event deleted.');
    refresh();
    eventsHeading.current?.focus();
  };
  return (
    <div className={styles['page']}>
      <h1>Calendar</h1>
      <p className={styles['note']}>
        Times are shown in Brussels time (Europe/Brussels). Calendar hours: 08:00-22:00.
      </p>
      {state === 'ready' && days ? (
        <section aria-labelledby="week-view-heading" className={styles['section']}>
          <h2 id="week-view-heading">Week view</h2>
          <WeekNavigator
            weekStart={weekStart}
            currentWeekStart={currentWeekStart}
            onChange={setWeekStart}
          />
          {events.length === 0 ? (
            <p className={styles['note']}>Nothing is blocked this week.</p>
          ) : null}
          <p className={styles['note']}>
            Closed before 08:00 and after 22:00: selection is available 08:00–22:00.
          </p>
          <SelectableTimeGrid
            days={days}
            blocks={blocks}
            busy={busy || (dialog?.busy ?? false)}
            labelId="week-view-heading"
            onSelect={(range) => {
              setDialog({
                mode: 'create',
                busy: false,
                initial: { date: range.date, start: range.startMinutes, end: range.endMinutes },
              });
            }}
            onActivateBlock={(blockKey) => {
              const event = events.find((candidate) => candidate.id === blockKey);
              if (!event) return;
              setDialog({ mode: event.source === 'ics' ? 'imported' : 'edit', event, busy: false });
            }}
            onDeleteBlock={(blockKey) => {
              const event = events.find((candidate) => candidate.id === blockKey);
              if (event) setPendingDelete({ event, busy: false });
            }}
            onShiftWeek={(delta) => {
              setWeekStart(addDays(weekStart, delta * 7));
            }}
          />
        </section>
      ) : (
        <WeekView
          weekStart={weekStart}
          currentWeekStart={currentWeekStart}
          days={days}
          state={state}
          busy={busy && days !== null}
          showTitles
          empty={state === 'ready' && events.length === 0}
          onWeekChange={setWeekStart}
          onRetry={refresh}
          onSignOut={() => void signOut()}
        />
      )}
      <section aria-labelledby="events-heading" className={styles['section']}>
        <h2 id="events-heading" ref={eventsHeading} tabIndex={-1}>
          Events this week
        </h2>
        {state === 'ready' ? (
          <EventList
            events={events}
            onDelete={(event) => {
              setPendingDelete({ event, busy: false });
            }}
          />
        ) : null}
      </section>
      <div className={styles['forms']}>
        <ImportPanel
          onChanged={() => {
            refresh();
          }}
        />
      </div>
      <p className="visually-hidden" role="status">
        {announce}
      </p>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this event?"
        confirmLabel="Delete event"
        cancelLabel="Keep event"
        busy={pendingDelete?.busy ?? false}
        {...(pendingDelete?.error ? { error: pendingDelete.error } : {})}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      >
        {pendingDelete
          ? `${pendingDelete.event.title || 'Untitled event'}, ${formatEventWhen(pendingDelete.event.startsAt, pendingDelete.event.endsAt)}.`
          : ''}
      </ConfirmDialog>
      {dialog ? (
        <CalendarEventDialog
          {...dialog}
          onClose={() => {
            setDialog(null);
          }}
          onCreate={create}
          onSave={update}
          onDelete={() => {
            if (dialog.event) setPendingDelete({ event: dialog.event, busy: false });
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
