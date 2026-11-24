import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { useServices } from '../../app/services-context';
import { startOfWeek, type IsoDate } from '../../core/domain/local-time';
import type { Interval } from '../../core/domain/interval';
import type { PortResult } from '../../core/ports';
import { todayInBrussels } from '../../shared/dates/brussels';
import { Container, PageHeading } from '../../shared/ui';
import { buildWeekModel, weekRange } from './calendar-view-model';
import { WeekView, type WeekLoadState } from './week-view';

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
  const busy = loaded?.key !== key;
  let state: WeekLoadState = 'loading';
  if (loaded?.outcome.ok) state = 'ready';
  else if (loaded && !busy && !loaded.outcome.ok)
    state = loaded.outcome.error.kind === 'forbidden' ? 'forbidden' : 'error';

  if (state === 'forbidden') return <Navigate to="/access" replace state={{ accessEnded: true }} />;

  return (
    <Container>
      <PageHeading lead="Times when the tutor is free or not.">Availability</PageHeading>
      <WeekView
        weekStart={weekStart}
        currentWeekStart={currentWeekStart}
        days={days}
        state={state}
        busy={busy && days !== null}
        showTitles={false}
        empty={
          state === 'ready' && loaded?.outcome.ok === true && loaded.outcome.value.length === 0
        }
        onWeekChange={setWeekStart}
        onRetry={() => {
          setReload((value) => value + 1);
        }}
        onSignOut={() => undefined}
      />
      <p>To book a time, ask the tutor directly for now.</p>
    </Container>
  );
}
