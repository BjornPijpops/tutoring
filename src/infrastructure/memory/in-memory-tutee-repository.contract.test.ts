import { defineTuteeContract, type ContractFactory } from '../../test/tutee-contract';
import { InMemoryTuteeRepository } from './in-memory-tutee-repository';
import type { SessionRequest } from '../../core/domain/session-request';
import type { TuteeSummary } from '../../core/domain/tutee';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const factory: ContractFactory = (tutees, sessions = []) => {
  const nowMs = Date.now();
  const seed: TuteeSummary[] = tutees.map((t) => {
    const status = t.status ?? 'approved';
    const requested = new Date(nowMs - (t.requestedMinutesAgo ?? 1440) * 60000).toISOString();
    const cooling = (status === 'denied' || status === 'revoked') && t.cooldownActive;
    return {
      userId: id(t.n),
      displayName: t.name ?? `Tutee ${String(t.n)}`,
      email: t.email ?? `tutee-${String(t.n)}@example.test`,
      status,
      createdAt: requested,
      requestedAt: requested,
      decidedAt: status === 'pending' ? null : requested,
      nextRequestAt: cooling ? new Date(nowMs + 36e5).toISOString() : null,
      requestCount: 1,
      pendingSessions: 0,
      acceptedFutureSessions: 0,
    };
  });
  const seeded: SessionRequest[] = sessions.map((s, index) => {
    const startsAt = new Date(nowMs + s.startsInHours * 36e5).toISOString();
    return {
      id: `00000000-0000-0000-0001-${String(index + 1).padStart(12, '0')}`,
      userId: id(s.n),
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 30 * 60000).toISOString(),
      status: s.status,
      createdAt: new Date(nowMs - 36e5).toISOString(),
    };
  });
  const repo = new InMemoryTuteeRepository({
    seed,
    sessions: seeded,
    now: () => new Date().toISOString(),
  });
  return Promise.resolve({ repo, sessionIds: seeded.map((s) => s.id), userId: id });
};

defineTuteeContract('memory', factory);
