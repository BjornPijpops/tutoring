import type { AppConfig } from '../core/config';
import type {
  AccessRequestRepository,
  AuthProvider,
  AvailabilityRepository,
  Notifier,
  SessionRequestRepository,
} from '../core/ports';
import {
  InMemoryAccessRequestRepository,
  InMemoryAuthProvider,
  InMemoryAvailabilityRepository,
  InMemoryNotifier,
  InMemorySessionRequestRepository,
} from './memory';

/** Everything the UI may depend on, expressed as ports. */
export interface Services {
  readonly auth: AuthProvider;
  readonly accessRequests: AccessRequestRepository;
  readonly availability: AvailabilityRepository;
  readonly sessionRequests: SessionRequestRepository;
  readonly notifier: Notifier;
}

/**
 * Composition root: builds the services for the given configuration.
 * The skeleton always wires in-memory adapters; the Supabase adapters will be
 * selected here once `config.supabaseUrl` and `config.supabaseAnonKey` are set.
 */
export function createContainer(_config: AppConfig): Services {
  const availability = new InMemoryAvailabilityRepository();
  return {
    auth: new InMemoryAuthProvider(),
    accessRequests: new InMemoryAccessRequestRepository(),
    availability,
    sessionRequests: new InMemorySessionRequestRepository({ availability }),
    notifier: new InMemoryNotifier(),
  };
}
