import { useEffect, useState } from 'react';
import { formatRecurrenceSummary, type RecurrenceRule } from '../../core/domain/recurrence';
import type { PortResult } from '../../core/ports';
import { todayInBrussels } from '../../shared/dates/brussels';
import type { SeriesDetails } from './calendar-event-dialog';

interface Settled {
  readonly seriesId: string;
  readonly attempt: number;
  readonly details: SeriesDetails;
}

/**
 * Loads the display rule of a series and describes it. While a series is loading, or after a
 * failure, the dialog still works for the single event; `retry` loads it again.
 */
export function useSeriesDetails(
  seriesId: string | undefined,
  getSeries: (seriesId: string) => PortResult<RecurrenceRule>,
): { readonly series: SeriesDetails | undefined; readonly retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (seriesId === undefined) return;
    let active = true;
    void getSeries(seriesId).then((outcome) => {
      if (!active) return;
      const details: SeriesDetails = outcome.ok
        ? {
            status: 'ready',
            summary: formatRecurrenceSummary(outcome.value, todayInBrussels(), false),
          }
        : { status: 'failed' };
      setSettled({ seriesId, attempt, details });
    });
    return () => {
      active = false;
    };
  }, [getSeries, seriesId, attempt]);

  const current =
    settled?.seriesId === seriesId && settled?.attempt === attempt ? settled.details : undefined;
  return {
    series: seriesId === undefined ? undefined : (current ?? { status: 'loading' }),
    retry: () => {
      setAttempt((value) => value + 1);
    },
  };
}
