import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SessionRequest } from '../../core/domain/session-request';
import { InMemorySessionRequestRepository } from '../../test/in-memory-sessions';
import { todayInBrussels } from '../../shared/dates/brussels';
import { expectNoViolations } from '../../test/axe';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { AvailabilityPage } from './availability-page';
import { localRangeToInterval } from './time-grid-selection';

const TUTEE = { id: 'tutee-1', role: 'tutee' } as const;

function own(id: string, status: SessionRequest['status'], start: number): SessionRequest {
  const range = localRangeToInterval({
    date: todayInBrussels(),
    startMinutes: start,
    endMinutes: start + 60,
  });
  return { ...range, id, userId: TUTEE.id, status, createdAt: '2026-01-01T00:00:00Z' };
}

function setup(seed: readonly SessionRequest[]) {
  const sessionRequests = new InMemorySessionRequestRepository({ actor: TUTEE, seed });
  const view = renderWithServices(<AvailabilityPage />, {
    services: { ...createTestServices(), sessionRequests },
  });
  return { sessionRequests, ...view };
}

describe('own blocks on the availability grid', () => {
  it('opens details for a pending block and cancels it, then removes the block', async () => {
    const { sessionRequests, container } = setup([own('p1', 'pending', 600)]);
    await userEvent.click(await screen.findByRole('button', { name: /^Pending, / }));
    const dialog = await screen.findByRole('dialog', { name: 'Your session request' });
    expect(dialog).toHaveTextContent('10:00');
    expect(dialog).toHaveTextContent('11:00');
    expect(dialog).toHaveTextContent('1 hour');
    expect(dialog).toHaveTextContent('Status: Pending');
    expect(dialog).not.toHaveTextContent(TUTEE.id);
    await expectNoViolations(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByText('Request cancelled.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Pending, / })).not.toBeInTheDocument();
    });
    const mine = await sessionRequests.listMine();
    expect(mine.ok && mine.value[0]?.status).toBe('cancelled');
    await expectNoViolations(container);
  });

  it('asks for confirmation before cancelling an accepted session', async () => {
    const { sessionRequests } = setup([own('a1', 'accepted', 600)]);
    await userEvent.click(await screen.findByRole('button', { name: /^Accepted, / }));
    const details = await screen.findByRole('dialog', { name: 'Your session request' });
    expect(details).toHaveTextContent('Status: Accepted');
    await userEvent.click(within(details).getByRole('button', { name: 'Cancel session' }));
    const confirm = await screen.findByRole('dialog', { name: 'Cancel this session?' });
    expect(confirm).toHaveTextContent(
      'This accepted session will be cancelled and the time will become available again.',
    );
    const unchanged = await sessionRequests.listMine();
    expect(unchanged.ok && unchanged.value[0]?.status).toBe('accepted');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Keep session' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Accepted, / })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Accepted, / }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel session' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Cancel this session?' })).getByRole(
        'button',
        { name: 'Cancel session' },
      ),
    );
    expect(await screen.findByText('Request cancelled.')).toBeInTheDocument();
    const cancelled = await sessionRequests.listMine();
    expect(cancelled.ok && cancelled.value[0]?.status).toBe('cancelled');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Accepted, / })).not.toBeInTheDocument();
    });
  });

  it('keeps the dialog and shows a stable error when cancelling fails', async () => {
    const { sessionRequests } = setup([own('p1', 'pending', 600)]);
    sessionRequests.cancel = () =>
      Promise.resolve({ ok: false, error: { kind: 'unavailable', message: 'raw db error' } });
    await userEvent.click(await screen.findByRole('button', { name: /^Pending, / }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByText(/couldn.t update this request/)).toBeInTheDocument();
    expect(screen.queryByText('raw db error')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Your session request' })).toBeInTheDocument();
  });

  it('closes the details without changes', async () => {
    const { sessionRequests } = setup([own('p1', 'pending', 600)]);
    await userEvent.click(await screen.findByRole('button', { name: /^Pending, / }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const mine = await sessionRequests.listMine();
    expect(mine.ok && mine.value[0]?.status).toBe('pending');
  });
});
