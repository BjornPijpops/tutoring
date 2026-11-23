import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { ServicesProvider } from '../app/services-context';
import { createContainer } from '../infrastructure/container';
import type { Services } from '../infrastructure/container';

/** Fresh in-memory services for a test. */
export function createTestServices(): Services {
  return createContainer({ supabaseUrl: undefined, supabaseAnonKey: undefined, basePath: '/' });
}

/** Options for {@link renderWithServices}. */
export interface RenderWithServicesOptions {
  services?: Services;
  /** Initial router location; defaults to `/`. */
  route?: string;
}

/** Renders `ui` inside the services provider and a memory router. */
export function renderWithServices(
  ui: ReactElement,
  { services = createTestServices(), route = '/' }: RenderWithServicesOptions = {},
): RenderResult {
  return render(
    <ServicesProvider services={services}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </ServicesProvider>,
  );
}
