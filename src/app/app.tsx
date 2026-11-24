import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { HashRouter } from 'react-router';
import { AuthProvider } from '../features/auth/auth-provider';
import type { Services } from '../infrastructure/container';
import { AppRoutes } from './routes';
import { ServicesProvider } from './services-context';

/** Props of {@link App}. */
export interface AppProps {
  services: Services;
}

/**
 * Root component: injects services, server-state cache and the router.
 * HashRouter because GitHub Pages cannot rewrite deep links to index.html.
 */
export function App({ services }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ServicesProvider services={services}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ServicesProvider>
  );
}
