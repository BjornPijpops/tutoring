import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services-context';

const CHANGED_EVENT = 'access-requests-changed';

/** Tells the navigation that the number of pending requests may have changed. */
export function announceRequestsChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/**
 * Number of requests waiting for the tutor, for the navigation badge. Loaded for the tutor
 * only, refreshed on focus and when the requests page changes something; a failure means no
 * badge.
 */
export function usePendingCount(enabled: boolean): number {
  const { accessRequests } = useServices();
  return usePendingLoader(
    enabled,
    useCallback(
      () =>
        accessRequests
          .listRequests('pending')
          .then((result) => (result.ok ? result.value.length : 0)),
      [accessRequests],
    ),
  );
}

/** Number of pending session requests waiting for the tutor; same refresh rules as above. */
export function useSessionPendingCount(enabled: boolean): number {
  const { sessionRequests } = useServices();
  return usePendingLoader(
    enabled,
    useCallback(
      () => sessionRequests.listPending().then((result) => (result.ok ? result.value.length : 0)),
      [sessionRequests],
    ),
  );
}

function usePendingLoader(enabled: boolean, fetchCount: () => Promise<number>): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      void fetchCount().then((value) => {
        if (active) setCount(value);
      });
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener(CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      window.removeEventListener(CHANGED_EVENT, load);
    };
  }, [fetchCount, enabled]);

  return enabled ? count : 0;
}
