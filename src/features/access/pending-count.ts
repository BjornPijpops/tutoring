import { useEffect, useState } from 'react';
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
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      void accessRequests.listRequests('pending').then((result) => {
        if (active) setCount(result.ok ? result.value.length : 0);
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
  }, [accessRequests, enabled]);

  return enabled ? count : 0;
}
