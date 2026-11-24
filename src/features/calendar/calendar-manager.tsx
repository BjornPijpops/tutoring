import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/services-context';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { mergeIntervals } from '../../core/domain/blocked-intervals';
import { startOfWeek, type IsoDate } from '../../core/domain/local-time';
import type { PortResult } from '../../core/ports';
import { formatEventWhen, formatWeekRange, todayInBrussels } from '../../shared/dates/brussels';
import { ConfirmDialog } from '../../shared/ui';
import { useAuth } from '../auth/auth-provider';
import { AddBlockedTimeForm } from './add-blocked-time-form';
import { buildWeekModel, weekRange } from './calendar-view-model';
import { EventList } from './event-list';
import { ImportPanel } from './import-panel';
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

/** The tutor's calendar: week view, events of the week, add form and ICS import. */
export function CalendarManager() {
  const { calendarEvents } = useServices();
  const { signOut } = useAuth();
  const currentWeekStart = startOfWeek(todayInBrussels());
  const [weekStart, setWeekStart] = useState<IsoDate>(currentWeekStart);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [announce, setAnnounce] = useState('');
  const eventsHeading = useRef<HTMLHeadingElement>(null);
  const key = `${weekStart}#${String(reload)}`;

  useEffect(() => {
    let active = true; // latest request wins: older responses are dropped
    void calendarEvents.listEvents(weekRange(weekStart)).then((outcome) => {
      if (active) setLoaded({ key, weekStart, outcome });
    });
    return () => {
      active = false;
    };
  }, [calendarEvents, weekStart, key]);

  const events = useMemo(() => (loaded?.outcome.ok ? loaded.outcome.value : []), [loaded]);
  const days = useMemo(() => {
    if (!loaded?.outcome.ok) return null;
    const range = weekRange(loaded.weekStart);
    return buildWeekModel({
      weekStart: loaded.weekStart,
      today: todayInBrussels(),
      blocked: mergeIntervals(events, range),
      events,
    });
  }, [loaded, events]);

  const busy = loaded?.key !== key;
  let state: WeekLoadState = 'loading';
  if (loaded?.outcome.ok) state = 'ready';
  else if (loaded && !busy && !loaded.outcome.ok)
    state = loaded.outcome.error.kind === 'forbidden' ? 'forbidden' : 'error';

  const showWeek = useCallback((week: IsoDate, message?: string) => {
    setWeekStart(week);
    if (message) setAnnounce(message);
  }, []);
  const refresh = useCallback(() => {
    setReload((value) => value + 1);
  }, []);

  const jumpToDate = (date: IsoDate) => {
    const week = startOfWeek(date);
    if (week !== weekStart) showWeek(week, `Week of ${formatWeekRange(week)} shown.`);
    refresh();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setPendingDelete({ ...pendingDelete, busy: true });
    const result = await calendarEvents.removeEvent(pendingDelete.event.id);
    if (!result.ok) {
      setPendingDelete({
        event: pendingDelete.event,
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
      <WeekView
        weekStart={weekStart}
        currentWeekStart={currentWeekStart}
        days={days}
        state={state}
        busy={busy && days !== null}
        showTitles
        empty={state === 'ready' && events.length === 0}
        onWeekChange={(week) => {
          showWeek(week);
        }}
        onRetry={refresh}
        onSignOut={() => {
          void signOut();
        }}
      />
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
        <AddBlockedTimeForm onAdded={jumpToDate} />
        <ImportPanel
          onChanged={(jumpTo) => {
            if (jumpTo && events.length === 0) jumpToDate(jumpTo);
            else refresh();
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
          ? `${pendingDelete.event.title || 'Untitled event'}, ${formatEventWhen(pendingDelete.event.startsAt, pendingDelete.event.endsAt)}. Tutees will see this time as free again, unless it is closed hours or covered by another event.`
          : ''}
      </ConfirmDialog>
    </div>
  );
}
