import { ok } from '../../core/domain/result';
import type { TutorNotification } from '../../core/domain/session-request';
import type { Notifier, PortResult } from '../../core/ports';

/** In-memory {@link Notifier} that records what would have been sent to the tutor. */
export class InMemoryNotifier implements Notifier {
  private readonly log: TutorNotification[] = [];

  /** Notifications sent so far, oldest first. */
  get sent(): readonly TutorNotification[] {
    return this.log;
  }

  notifyTutor(event: TutorNotification): PortResult<void> {
    this.log.push(event);
    return Promise.resolve(ok(undefined));
  }
}
