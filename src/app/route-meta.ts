/** Id of the element that receives focus when skipping or navigating. */
export const MAIN_ID = 'main';

const APP_NAME = 'Tutoring';
const NOT_FOUND_TITLE = 'Page not found';

/** Page titles by route path; unknown paths use the not-found title. */
export const ROUTE_TITLES: Readonly<Record<string, string>> = {
  '/': 'Home',
  '/login': 'Sign in',
  '/calendar': 'Calendar',
  '/tutees': 'Tutees',
  '/access': 'Request access',
  '/access-requests': 'Access requests',
  '/my-sessions': 'My sessions',
  '/session-requests': 'Session requests',
  '/availability': 'Availability',
};

/** Document title for a pathname, e.g. `Calendar · Tutoring`. */
export function documentTitle(pathname: string): string {
  const title = pathname.startsWith('/tutees/')
    ? 'Tutee'
    : (ROUTE_TITLES[pathname] ?? NOT_FOUND_TITLE);
  return `${title} \u00b7 ${APP_NAME}`;
}
