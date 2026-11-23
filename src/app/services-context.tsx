import { createContext, useContext, type ReactNode } from 'react';
import type { Services } from '../infrastructure/container';

const ServicesContext = createContext<Services | null>(null);

/** Props of {@link ServicesProvider}. */
export interface ServicesProviderProps {
  services: Services;
  children: ReactNode;
}

/** Makes the composed services (ports) available to the component tree. */
export function ServicesProvider({ services, children }: ServicesProviderProps) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** Returns the injected services; throws when used outside a {@link ServicesProvider}. */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('useServices must be used within a ServicesProvider');
  }
  return services;
}
