import { describe, expect, it } from 'vitest';
import { InMemoryAccessRequestRepository } from './in-memory-access-request-repository';

describe('InMemoryAccessRequestRepository', () => {
  it('lists a new request as pending, then removes it once decided', async () => {
    const repo = new InMemoryAccessRequestRepository();
    const created = await repo.request();
    expect(created).toMatchObject({
      ok: true,
      value: { status: 'pending', id: 'access-request-1' },
    });

    const pending = await repo.listPending();
    expect(pending.ok && pending.value).toHaveLength(1);

    const decided = await repo.decide('access-request-1', 'approved');
    expect(decided).toMatchObject({ ok: true, value: { status: 'approved' } });
    const after = await repo.listPending();
    expect(after.ok && after.value).toHaveLength(0);
  });

  it('returns not-found for an unknown id', async () => {
    const result = await new InMemoryAccessRequestRepository().decide('nope', 'denied');
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-found' } });
  });

  it('rejects a second request from the same user', async () => {
    const repo = new InMemoryAccessRequestRepository();
    await repo.request();
    expect(await repo.request()).toMatchObject({ ok: false, error: { kind: 'conflict' } });
  });

  it('returns the current user request from getMine', async () => {
    const repo = new InMemoryAccessRequestRepository();
    expect(await repo.getMine()).toEqual({ ok: true, value: null });
    await repo.request();
    expect(await repo.getMine()).toMatchObject({ ok: true, value: { userId: 'user-1' } });
  });

  it('forbids tutor-only operations for a tutee', async () => {
    const repo = new InMemoryAccessRequestRepository({ actor: { id: 't', role: 'tutee' } });
    expect(await repo.listPending()).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await repo.decide('x', 'approved')).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });
});
