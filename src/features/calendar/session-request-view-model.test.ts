import { describe, expect, it } from 'vitest';
import type { SessionRequest } from '../../core/domain/session-request';
import { sessionBlocks } from './session-request-view-model';

describe('sessionBlocks', () => {
  const own = (id: string, status: SessionRequest['status']): SessionRequest => ({
    id,
    userId: 'me',
    status,
    startsAt: '2027-03-10T09:00:00Z',
    endsAt: '2027-03-10T10:00:00Z',
    createdAt: '2027-03-01T00:00:00Z',
  });

  it('emits anonymous striped blocks and only own pending/accepted generic busy blocks', () => {
    const blocks = sessionBlocks(
      [{ startsAt: '2027-03-11T09:00:00Z', endsAt: '2027-03-11T10:00:00Z' }],
      [own('a', 'pending'), own('b', 'accepted'), own('c', 'declined'), own('d', 'cancelled')],
    );
    expect(blocks.map((b) => [b.kind, b.label])).toEqual([
      ['blocked', 'Not available'],
      ['busy', 'Pending'],
      ['busy', 'Accepted'],
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/me"|userId|requester/);
  });
});
