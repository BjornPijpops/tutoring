/** Outcome of an OAuth redirect as seen in the page URL. */
export type OAuthCallbackOutcome = 'none' | 'success' | 'cancelled' | 'failed';

/** What the URL says about an OAuth redirect, and the same URL without the callback parameters. */
export interface OAuthCallback {
  readonly outcome: OAuthCallbackOutcome;
  readonly cleanUrl: string;
}

const CALLBACK_PARAMS = ['code', 'state', 'error', 'error_code', 'error_description'] as const;

/**
 * Reads the PKCE callback from the query string (`?code=` or `?error=`). The callback must
 * be a query, never a hash fragment: the fragment belongs to the HashRouter.
 */
export function readOAuthCallback(url: URL): OAuthCallback {
  const { searchParams } = url;
  let outcome: OAuthCallbackOutcome = 'none';
  if (searchParams.has('error')) {
    outcome = searchParams.get('error') === 'access_denied' ? 'cancelled' : 'failed';
  } else if (searchParams.has('code')) {
    outcome = 'success';
  }

  const clean = new URL(url.href);
  CALLBACK_PARAMS.forEach((param) => {
    clean.searchParams.delete(param);
  });
  return { outcome, cleanUrl: clean.href };
}
