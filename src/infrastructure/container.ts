import type { AppConfig } from '../core/config';
import type {
  AccessRequestRepository,
  AuthProvider,
  AvailabilityRepository,
  BlockedTimeRepository,
  CalendarEventRepository,
  IcsParser,
  Notifier,
  SessionRequestRepository,
} from '../core/ports';
import { IcalJsParser } from './ics';
import {
  InMemoryAccessRequestRepository,
  InMemoryAuthProvider,
  InMemoryAvailabilityRepository,
  InMemoryBlockedTimeRepository,
  InMemoryCalendarEventRepository,
  InMemoryNotifier,
  InMemorySessionRequestRepository,
} from './memory';
import {
  SupabaseAccessRequestRepository,
  SupabaseAuthProvider,
  SupabaseBlockedTimeRepository,
  SupabaseCalendarEventRepository,
  createSupabaseClient,
  supabaseSettings,
} from './supabase';

/** Everything the UI may depend on, expressed as ports. */
export interface Services {
  readonly auth: AuthProvider;
  readonly accessRequests: AccessRequestRepository;
  readonly availability: AvailabilityRepository;
  readonly calendarEvents: CalendarEventRepository;
  readonly blockedTime: BlockedTimeRepository;
  readonly icsParser: IcsParser;
  readonly sessionRequests: SessionRequestRepository;
  readonly notifier: Notifier;
}

/** Environment values the container needs besides the config. */
export interface ContainerEnvironment {
  /** Origin the site is served from, e.g. `https://bjornpijpops.github.io`. */
  readonly origin: string;
}

/**
 * Composition root: builds the services for the given configuration.
 * Auth, access requests and calendar data use Supabase when `supabaseUrl` and `supabaseAnonKey`
 * are set, otherwise in-memory adapters; the not-yet-built features always use in-memory ones.
 */
export function createContainer(
  config: AppConfig,
  { origin }: ContainerEnvironment = { origin: window.location.origin },
): Services {
  const availability = new InMemoryAvailabilityRepository();
  const memoryCalendarEvents = new InMemoryCalendarEventRepository();
  const settings = supabaseSettings(config);
  const client = settings ? createSupabaseClient(settings) : undefined;

  return {
    auth: client
      ? new SupabaseAuthProvider(client, `${origin}${config.basePath}`)
      : new InMemoryAuthProvider(),
    accessRequests: client
      ? new SupabaseAccessRequestRepository(client)
      : new InMemoryAccessRequestRepository(),
    availability,
    calendarEvents: client ? new SupabaseCalendarEventRepository(client) : memoryCalendarEvents,
    blockedTime: client
      ? new SupabaseBlockedTimeRepository(client)
      : new InMemoryBlockedTimeRepository(memoryCalendarEvents),
    icsParser: new IcalJsParser(),
    sessionRequests: new InMemorySessionRequestRepository({ availability }),
    notifier: new InMemoryNotifier(),
  };
}
