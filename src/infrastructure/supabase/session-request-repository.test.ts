import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionRequestRepository } from './session-request-repository';

const row = {
  id: 'r1',
  user_id: 'u1',
  starts_at: '2026-12-01T09:00:00+00:00',
  ends_at: '2026-12-01T10:00:00+00:00',
  status: 'pending',
  created_at: '2026-11-24T09:00:00+00:00',
  updated_at: '2026-11-24T09:00:00+00:00',
  decided_at: null,
  cancelled_at: null,
};
const RANGE = { startsAt: row.starts_at, endsAt: row.ends_at };

function setup(response: unknown) {
  const rpc = vi.fn().mockResolvedValue(response);
  const repo = new SupabaseSessionRequestRepository({ rpc } as unknown as SupabaseClient);
  return { repo, rpc };
}

describe('SupabaseSessionRequestRepository', () => {
  it('creates through the RPC with the range and maps the row', async () => {
    const { repo, rpc } = setup({ data: row, error: null });
    const result = await repo.create(RANGE);
    expect(rpc).toHaveBeenCalledWith('create_session_request', {
      p_starts_at: RANGE.startsAt,
      p_ends_at: RANGE.endsAt,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { id: 'r1', userId: 'u1', status: 'pending', startsAt: RANGE.startsAt },
    });
  });

  it('lists only the caller range through list_my_session_requests', async () => {
    const { repo, rpc } = setup({ data: [row], error: null });
    const result = await repo.listMine({ startsAt: 'a', endsAt: 'b' });
    expect(rpc).toHaveBeenCalledWith('list_my_session_requests', { p_from: 'a', p_to: 'b' });
    expect(result.ok && result.value).toHaveLength(1);
  });

  it('maps the tutor projection with identity and the decision result', async () => {
    const tutor = setup({
      data: [{ ...row, requester_name: 'Alex', requester_email: 'alex@example.test' }],
      error: null,
    });
    expect(await tutor.repo.listPending()).toMatchObject({
      ok: true,
      value: [{ requesterName: 'Alex', requesterEmail: 'alex@example.test' }],
    });
    expect(tutor.rpc).toHaveBeenCalledWith('list_session_requests_for_tutor');
    const decided = setup({
      data: { request: { ...row, status: 'accepted' }, overlap_declined_count: 2 },
      error: null,
    });
    expect(await decided.repo.decide('r1', 'accepted')).toMatchObject({
      ok: true,
      value: { request: { status: 'accepted' }, overlapDeclinedCount: 2 },
    });
    expect(decided.rpc).toHaveBeenCalledWith('decide_session_request', {
      p_request_id: 'r1',
      p_decision: 'accepted',
    });
  });

  it('lists accepted sessions for the tutor calendar with only the name and range', async () => {
    const { repo, rpc } = setup({
      data: [{ id: 'r1', starts_at: row.starts_at, ends_at: row.ends_at, requester_name: 'Alex' }],
      error: null,
    });
    const result = await repo.listAccepted({ startsAt: 'a', endsAt: 'b' });
    expect(rpc).toHaveBeenCalledWith('list_accepted_sessions_for_tutor', {
      p_from: 'a',
      p_to: 'b',
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: 'r1', status: 'accepted', requesterName: 'Alex', requesterEmail: '' }],
    });
    expect(
      await setup({ data: null, error: { code: '42501', message: 'x' } }).repo.listAccepted(RANGE),
    ).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await setup({ data: [{ id: 1 }], error: null }).repo.listAccepted(RANGE)).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });

  it('cancels through the RPC', async () => {
    const { repo, rpc } = setup({ data: { ...row, status: 'cancelled' }, error: null });
    expect(await repo.cancel('r1')).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    expect(rpc).toHaveBeenCalledWith('cancel_session_request', { p_request_id: 'r1' });
  });

  it.each([
    ['42501', { kind: 'forbidden' }],
    ['TR001', { kind: 'conflict', code: 'pending_limit' }],
    ['TR002', { kind: 'conflict', code: 'schedule_unavailable' }],
    ['23P01', { kind: 'conflict', code: 'schedule_unavailable' }],
    ['TR003', { kind: 'conflict', code: 'state_conflict' }],
    ['22023', { kind: 'validation' }],
    ['XX000', { kind: 'unavailable' }],
  ])('maps SQLSTATE %s to a stable port error without SQL text', async (code, expected) => {
    const { repo } = setup({ data: null, error: { code, message: 'relation "x" secret detail' } });
    const result = await repo.create(RANGE);
    expect(result).toMatchObject({ ok: false, error: expected });
    expect(JSON.stringify(result)).not.toMatch(/relation|secret/);
  });

  it('treats malformed rows and thrown transport errors as unavailable', async () => {
    expect(await setup({ data: { id: 1 }, error: null }).repo.create(RANGE)).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
    expect(
      await setup({ data: [{ ...row, status: 'bogus' }], error: null }).repo.listMine(),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await setup({ data: { request: row }, error: null }).repo.decide('r1', 'declined'),
    ).toMatchObject({
      ok: false,
    });
    const rpc = vi.fn().mockRejectedValue(new Error('offline'));
    const repo = new SupabaseSessionRequestRepository({ rpc } as unknown as SupabaseClient);
    expect(await repo.cancel('r1')).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});
