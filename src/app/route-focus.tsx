import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { MAIN_ID, documentTitle } from './route-meta';

/**
 * Keeps screen-reader users informed about navigation: updates the document
 * title and, after a route change, moves focus to `main`. Renders nothing.
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    document.title = documentTitle(pathname);
    // Focus is only moved on navigation, not on the initial page load.
    if (previousPathname.current !== null && previousPathname.current !== pathname) {
      document.getElementById(MAIN_ID)?.focus();
    }
    previousPathname.current = pathname;
  }, [pathname]);

  return null;
}
