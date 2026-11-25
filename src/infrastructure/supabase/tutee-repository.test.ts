import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseTuteeRepository } from './tutee-repository';

const summaryRow = {
  user_id: 'u1',
  display_name: 'Alex',
  email: 'alex@example.test',
  status: 'approved',
  created_at: '2026-11-24T09:00:00+00:00',
  requested_at: '2026-11-24T09:00:00+00:00',
  decided_at: null,
  next_request_at: null,
  request_count: 1,
  pending_sessions: 0,
  accepted_future_sessions: 0,
};

function setup(response: unknown) {
  const rpc = vi.fn().mockResolvedValue(response);
  return { repo: new SupabaseTuteeRepository({ rpc } as unknown as SupabaseClient), rpc };
}

const counts = { all: 1, pending: 0, approved: 1, denied: 0, revoked: 0, blocked: 0 };

describe('SupabaseTuteeRepository', () => {
  it('sends unset list filters as null and maps the page', async () => {
    const { repo, rpc } = setup({
      data: { items: [summaryRow], total: 1, counts },
      error: null,
    });
    const result = await repo.list({});
    expect(rpc).toHaveBeenCalledWith('list_tutees', {
      p_status: null,
      p_search: null,
      p_limit: null,
      p_offset: null,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { total: 1, items: [{ userId: 'u1', displayName: 'Alex', status: 'approved' }] },
    });
  });

  it('passes the filters on', async () => {
    const { repo, rpc } = setup({ data: { items: [], total: 0, counts }, error: null });
    await repo.list({ status: 'blocked', search: 'al', limit: 20, offset: 40 });
    expect(rpc).toHaveBeenCalledWith('list_tutees', {
      p_status: 'blocked',
      p_search: 'al',
      p_limit: 20,
      p_offset: 40,
    });
  });

  it('rejects malformed data instead of guessing', async () => {
    const { repo } = setup({
      data: { items: [{ ...summaryRow, status: 'weird' }], total: 1, counts },
      error: null,
    });
    expect(await repo.list({})).toMatchObject({ ok: false });
  });

  it('calls act_on_tutee with the session policy, keep by default', async () => {
    const { repo, rpc } = setup({
      data: { status: 'revoked', pending_declined: 2, accepted_cancelled: 1 },
      error: null,
    });
    const result = await repo.act('u1', 'revoke');
    expect(rpc).toHaveBeenCalledWith('act_on_tutee', {
      p_user_id: 'u1',
      p_action: 'revoke',
      p_session_policy: 'keep',
    });
    expect(result).toEqual({
      ok: true,
      value: { status: 'revoked', pendingDeclined: 2, acceptedCancelled: 1 },
    });
    await repo.act('u1', 'block', 'cancel_all');
    expect(rpc).toHaveBeenLastCalledWith('act_on_tutee', {
      p_user_id: 'u1',
      p_action: 'block',
      p_session_policy: 'cancel_all',
    });
  });

  it('calls the detail, allow-again and cancel RPCs by name', async () => {
    const { repo, rpc } = setup({ data: null, error: null });
    await repo.get('u1');
    expect(rpc).toHaveBeenLastCalledWith('get_tutee_detail', { p_user_id: 'u1' });
    await repo.allowAgain('u1');
    expect(rpc).toHaveBeenLastCalledWith('allow_access_request_again', { p_user_id: 'u1' });
    await repo.cancelSession('r1');
    expect(rpc).toHaveBeenLastCalledWith('cancel_session_as_tutor', { p_request_id: 'r1' });
  });

  it.each([
    [{ code: 'TR003', message: 'x' }, 'conflict'],
    [{ code: 'P0002', message: 'x' }, 'not-found'],
    [{ code: '42501', message: 'x' }, 'forbidden'],
    [{ code: '22023', message: 'x' }, 'validation'],
  ])('maps database error %o to %s', async (error, kind) => {
    const { repo } = setup({ data: null, error });
    expect(await repo.get('u1')).toMatchObject({ ok: false, error: { kind } });
  });

  it('reports unavailable when the call throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('offline'));
    const repo = new SupabaseTuteeRepository({ rpc } as unknown as SupabaseClient);
    expect(await repo.get('u1')).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});
