import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseAccessRequestRepository } from './access-request-repository';
import { mapAccessError } from './access-rows';

const row = {
  user_id: 'u1',
  status: 'pending',
  message: 'Hi',
  created_at: '2026-11-24T09:00:00+00:00',
  requested_at: '2026-11-24T09:00:00+00:00',
  decided_at: null,
  next_request_at: null,
  request_count: 1,
};

const summary = { ...row, display_name: 'Alex', email: 'alex@example.test' };

function setup(response: unknown) {
  const rpc = vi.fn().mockResolvedValue(response);
  const from = vi.fn();
  const client = { rpc, from } as unknown as SupabaseClient;
  return { repo: new SupabaseAccessRequestRepository(client), rpc, from };
}

describe('SupabaseAccessRequestRepository', () => {
  it('requests access through the RPC and maps the row', async () => {
    const { repo, rpc } = setup({ data: row, error: null });
    const result = await repo.requestAccess('Hi');
    expect(rpc).toHaveBeenCalledWith('request_access', { p_message: 'Hi' });
    expect(result).toMatchObject({ ok: true, value: { status: 'pending', requestCount: 1 } });
  });

  it('reads the own request through the projecting RPC, never the table', async () => {
    const { repo, rpc, from } = setup({ data: [{ ...row, can_ask_again: true }], error: null });
    const result = await repo.getMine();
    expect(rpc).toHaveBeenCalledWith('get_my_access_request', {});
    expect(from).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { status: 'pending', canAskAgain: true } });
  });

  it('returns null when there is no request', async () => {
    expect(await setup({ data: [], error: null }).repo.getMine()).toEqual({
      ok: true,
      value: null,
    });
  });

  it('rejects a response with more than one row', async () => {
    expect(await setup({ data: [row, row], error: null }).repo.getMine()).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });

  it('shows a blocked row as denied without a retry date', async () => {
    const blocked = {
      ...row,
      status: 'denied',
      decided_at: '2026-11-24T10:00:00+00:00',
      next_request_at: '2026-11-25T10:00:00+00:00',
      can_ask_again: false,
    };
    const result = await setup({ data: [blocked], error: null }).repo.getMine();
    expect(result).toMatchObject({
      ok: true,
      value: { status: 'denied', nextRequestAt: null, canAskAgain: false },
    });
  });

  it.each(['revoked', 'blocked'])('projects a leaked %s row to denied', async (status) => {
    const leaked = { ...row, status, decided_at: '2026-11-24T10:00:00+00:00' };
    const result = await setup({ data: leaked, error: null }).repo.decide('u1', 'denied');
    expect(result).toMatchObject({ ok: true, value: { status: 'denied' } });
  });

  it('lists requests with the status filter', async () => {
    const { repo, rpc } = setup({ data: [summary], error: null });
    const result = await repo.listRequests('pending');
    expect(rpc).toHaveBeenCalledWith('list_access_requests', { p_status: 'pending' });
    expect(result).toMatchObject({ ok: true, value: [{ displayName: 'Alex' }] });
  });

  it('lists without a filter as null', async () => {
    const { repo, rpc } = setup({ data: [], error: null });
    await repo.listRequests();
    expect(rpc).toHaveBeenCalledWith('list_access_requests', { p_status: null });
  });

  it('decides and allows again through the RPCs', async () => {
    const { repo, rpc } = setup({ data: { ...row, status: 'approved' }, error: null });
    await repo.decide('u1', 'approved');
    expect(rpc).toHaveBeenCalledWith('decide_access_request', {
      p_user_id: 'u1',
      p_decision: 'approved',
    });
    await repo.allowRequestAgain('u1');
    expect(rpc).toHaveBeenCalledWith('allow_access_request_again', { p_user_id: 'u1' });
  });

  it('rejects malformed rows without leaking them', async () => {
    const result = await setup({
      data: { ...row, status: 'weird' },
      error: null,
    }).repo.requestAccess('');
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });

  it('maps thrown errors to unavailable', async () => {
    const { repo, rpc } = setup({});
    rpc.mockRejectedValue(new Error('offline'));
    expect(await repo.requestAccess('')).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });
});

describe('mapAccessError', () => {
  it.each([
    [{ code: '42501', message: 'x' }, 'forbidden'],
    [{ code: 'PGRST301', message: 'x' }, 'forbidden'],
    [{ code: 'P0002', message: 'x' }, 'not-found'],
    [{ code: '22023', message: 'x' }, 'validation'],
    [{ code: '23514', message: 'x' }, 'validation'],
    [{ code: '23505', message: 'x' }, 'conflict'],
    [{ code: 'TR003', message: 'stale access state' }, 'conflict'],
    [{ code: 'P0001', message: 'access request blocked' }, 'conflict'],
    [{ code: 'XX000', message: 'x' }, 'unavailable'],
  ])('maps %j to %s', (error, kind) => {
    expect(mapAccessError(error).kind).toBe(kind);
  });

  it('never exposes the database message', () => {
    expect(mapAccessError({ code: 'XX000', message: 'secret detail' }).message).not.toContain(
      'secret',
    );
  });
});
