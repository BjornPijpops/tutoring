import type { Session } from '../core/domain/user';
import type { Services } from '../infrastructure/container';
import { InMemoryAccessRequestRepository, InMemoryAuthProvider } from '../infrastructure/memory';
import { createTestServices } from './render-with-services';

export { InMemoryAccessRequestRepository };

/**
 * Services for access-request tests. `repo` acts as the tutor and holds the shared data, so
 * a test can seed requests with `repo.as({ id, role: 'tutee' }).requestAccess(...)`; the app
 * under test gets the view that matches `session` (the tutor, or that tutee).
 */
export function createAccessServices(
  session: Session | null,
  repo: InMemoryAccessRequestRepository = new InMemoryAccessRequestRepository({
    now: () => new Date().toISOString(),
  }),
): { services: Services; repo: InMemoryAccessRequestRepository; auth: InMemoryAuthProvider } {
  const auth = new InMemoryAuthProvider(session);
  const accessRequests =
    session === null || session.user.role === 'tutor'
      ? repo
      : repo.as({ id: session.user.id, role: 'tutee' });
  return { services: { ...createTestServices(), auth, accessRequests }, repo, auth };
}
