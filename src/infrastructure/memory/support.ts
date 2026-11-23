import type { PortError } from '../../core/ports';
import type { Role } from '../../core/domain/user';

/** Produces unique ids; injected so tests are deterministic. */
export type IdGenerator = () => string;

/** Returns the current instant as an ISO-8601 string; injected so tests are deterministic. */
export type Clock = () => string;

/** The user on whose behalf an in-memory repository acts. */
export interface Actor {
  readonly id: string;
  readonly role: Role;
}

/** Creates ids like `request-1`, `request-2`, … */
export function sequentialIds(prefix: string): IdGenerator {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

/** Clock that always returns the same instant. */
export function fixedClock(instant = '2026-01-01T00:00:00Z'): Clock {
  return () => instant;
}

/** Default actor: a tutor, so a single repository instance can exercise every operation. */
export const DEFAULT_ACTOR: Actor = { id: 'user-1', role: 'tutor' };

/** Error returned by tutor-only operations when the actor is not the tutor. */
export function forbiddenUnlessTutor(actor: Actor): PortError | undefined {
  return actor.role === 'tutor'
    ? undefined
    : { kind: 'forbidden', message: 'Only the tutor can do this.' };
}

/** Error for an unknown entity id. */
export function notFound(what: string, id: string): PortError {
  return { kind: 'not-found', message: `${what} ${id} was not found.` };
}
