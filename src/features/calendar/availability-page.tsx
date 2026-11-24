import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { useServices } from '../../app/services-context';
import { addDays, startOfWeek, type IsoDate } from '../../core/domain/local-time';
import type { Interval } from '../../core/domain/interval';
import type { PortResult } from '../../core/ports';
import { todayInBrussels } from '../../shared/dates/brussels';
import { Container, PageHeading } from '../../shared/ui';
import { SelectableTimeGrid } from './selectable-time-grid';
import { WeekNavigator } from './week-navigator';
import type { GridBlock } from './time-grid-model';
import { buildWeekModel, weekRange } from './calendar-view-model';

interface Loaded {
  readonly key: string;
  readonly weekStart: IsoDate;
  readonly outcome: Awaited<PortResult<readonly Interval[]>>;
}

/**
 * Availability for approved tutees (and the tutor): only free, blocked and closed times,
 * never event titles. If the server says access ended, the user is sent to `/access`.
 */
export function AvailabilityPage() {
  const { blockedTime } = useServices();
  const currentWeekStart = startOfWeek(todayInBrussels());
  const [weekStart, setWeekStart] = useState<IsoDate>(currentWeekStart);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${weekStart}#${String(reload)}`;

  useEffect(() => {
    let active = true;
    void blockedTime.listBlockedIntervals(weekRange(weekStart)).then((outcome) => {
      if (active) setLoaded({ key, weekStart, outcome });
    });
    return () => {
      active = false;
    };
  }, [blockedTime, weekStart, key]);

  const days = useMemo(
    () =>
      loaded?.outcome.ok
        ? buildWeekModel({
            weekStart: loaded.weekStart,
            today: todayInBrussels(),
            blocked: loaded.outcome.value,
          })
        : null,
    [loaded],
  );
  const blocks = useMemo<readonly GridBlock[]>(
    () =>
      loaded?.outcome.ok
        ? loaded.outcome.value.map((interval, index) => ({
            ...interval,
            key: `availability-${String(index)}`,
            label: 'Not available',
            kind: 'blocked',
            readOnly: true,
          }))
        : [],
    [loaded],
  );
  const busy = loaded?.key !== key;
  const error = loaded && !busy && !loaded.outcome.ok;
  if (error && loaded.outcome.error.kind === 'forbidden') {
    return <Navigate to="/access" replace state={{ accessEnded: true }} />;
  }
  return (
    <Container>
      <PageHeading lead="Times when the tutor is not available.">Availability</PageHeading>
      <section aria-labelledby="availability-heading">
        <h2 id="availability-heading">Week view</h2>
        <p>Times are shown in Brussels time (Europe/Brussels). Calendar hours: 08:00–22:00.</p>
        <WeekNavigator
          weekStart={weekStart}
          currentWeekStart={currentWeekStart}
          onChange={setWeekStart}
        />
        {error ? (
          <>
            <p role="alert">We couldn't load the calendar. Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => {
                setReload((value) => value + 1);
              }}
            >
              Try again
            </button>
          </>
        ) : days ? (
          <SelectableTimeGrid
            days={days}
            blocks={blocks}
            busy={busy}
            readOnly
            labelId="availability-heading"
            onSelect={() => undefined}
            onActivateBlock={() => undefined}
            onDeleteBlock={() => undefined}
            onShiftWeek={(delta) => {
              setWeekStart(addDays(weekStart, delta * 7));
            }}
          />
        ) : (
          <p role="status">Loading the calendar...</p>
        )}
      </section>
      <p>To book a time, ask the tutor directly for now.</p>
    </Container>
  );
}
