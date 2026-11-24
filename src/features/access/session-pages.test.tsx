import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { err, ok } from '../../core/domain/result';
import type { SessionRequest, TutorSessionRequest } from '../../core/domain/session-request';
import type { SessionRequestRepository } from '../../core/ports/session-request-repository';
import { expectNoViolations } from '../../test/axe';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { MySessionsPage } from './my-sessions-page';
import { SessionRequestsPage } from './session-requests-page';

const base = { userId: 'u', createdAt: '2099-01-01T00:00:00Z' } as const;
const mine = (id: string, status: SessionRequest['status'], day = '02'): SessionRequest => ({
  ...base,
  id,
  status,
  startsAt: `2099-06-${day}T08:00:00Z`,
  endsAt: `2099-06-${day}T09:30:00Z`,
});
const tutorItem = (id: string, name: string): TutorSessionRequest => ({
  ...mine(id, 'pending'),
  requesterName: name,
  requesterEmail: `${name.toLowerCase()}@example.test`,
});
const unavailable = err({ kind: 'unavailable' as const, message: 'x' });

function stub(overrides: Partial<SessionRequestRepository>): SessionRequestRepository {
  return {
    create: () => Promise.resolve(unavailable),
    listMine: () => Promise.resolve(ok([])),
    listPending: () => Promise.resolve(ok([])),
    listAccepted: () => Promise.resolve(ok([])),
    decide: () => Promise.resolve(unavailable),
    cancel: () => Promise.resolve(unavailable),
    ...overrides,
  };
}
const withRepo = (repo: SessionRequestRepository) => ({
  ...createTestServices(),
  sessionRequests: repo,
});

describe('MySessionsPage', () => {
  it('shows loading, then grouped formatted rows without raw ISO strings', async () => {
    const { container } = renderWithServices(<MySessionsPage />, {
      services: withRepo(
        stub({
          listMine: () =>
            Promise.resolve(
              ok([mine('a', 'pending'), mine('b', 'accepted', '03'), mine('c', 'declined', '04')]),
            ),
        }),
      ),
    });
    expect(screen.getByText(/Loading your sessions/)).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Pending' });
    expect(screen.getByRole('heading', { name: 'Accepted' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Past and closed' })).toBeInTheDocument();
    expect(screen.getAllByText(/1 hour 30 minutes/).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/2099-06-0\dT/);
    await expectNoViolations(container);
  });

  it('shows an empty state and an error state with retry', async () => {
    let fail = true;
    const { container } = renderWithServices(<MySessionsPage />, {
      services: withRepo(stub({ listMine: () => Promise.resolve(fail ? unavailable : ok([])) })),
    });
    await screen.findByText(/couldn.t load your sessions/);
    await expectNoViolations(container);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('You have no sessions or requests yet.');
    await expectNoViolations(container);
  });

  it('cancels a pending request immediately', async () => {
    let cancelled = '';
    renderWithServices(<MySessionsPage />, {
      services: withRepo(
        stub({
          listMine: () => Promise.resolve(ok(cancelled ? [] : [mine('a', 'pending')])),
          cancel: (id) => {
            cancelled = id;
            return Promise.resolve(ok(mine(id, 'cancelled')));
          },
        }),
      ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
    await screen.findByText('Request cancelled.');
    expect(cancelled).toBe('a');
  });

  it('asks for confirmation before cancelling an accepted session', async () => {
    let cancelled = 0;
    renderWithServices(<MySessionsPage />, {
      services: withRepo(
        stub({
          listMine: () => Promise.resolve(ok([mine('b', 'accepted')])),
          cancel: (id) => {
            cancelled += 1;
            return Promise.resolve(ok(mine(id, 'cancelled')));
          },
        }),
      ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this session?' });
    expect(cancelled).toBe(0);
    await expectNoViolations(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep session' }));
    expect(cancelled).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel session' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel session' }),
    );
    await waitFor(() => {
      expect(cancelled).toBe(1);
    });
  });

  it('shows a stable error when cancelling fails', async () => {
    renderWithServices(<MySessionsPage />, {
      services: withRepo(stub({ listMine: () => Promise.resolve(ok([mine('a', 'pending')])) })),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
    await screen.findByText(/couldn.t update this request/);
  });
});

describe('SessionRequestsPage', () => {
  it('lists pending requests for the tutor and passes axe', async () => {
    const { container } = renderWithServices(<SessionRequestsPage />, {
      services: withRepo(stub({ listPending: () => Promise.resolve(ok([tutorItem('a', 'Sam')])) })),
    });
    await screen.findByText('Sam');
    expect(screen.getByText(/1 hour 30 minutes/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/2099-06-02T/);
    await expectNoViolations(container);
  });

  it('shows empty and error states', async () => {
    const { unmount } = renderWithServices(<SessionRequestsPage />);
    await screen.findByText('There are no pending session requests.');
    unmount();
    renderWithServices(<SessionRequestsPage />, {
      services: withRepo(stub({ listPending: () => Promise.resolve(unavailable) })),
    });
    await screen.findByText(/couldn.t load session requests/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('announces how many overlapping requests were declined', async () => {
    let pending = [tutorItem('a', 'Sam'), tutorItem('b', 'Kim')];
    renderWithServices(<SessionRequestsPage />, {
      services: withRepo(
        stub({
          listPending: () => Promise.resolve(ok(pending)),
          decide: (id) => {
            pending = [];
            return Promise.resolve(ok({ request: mine(id, 'accepted'), overlapDeclinedCount: 1 }));
          },
        }),
      ),
    });
    const [first] = await screen.findAllByRole('button', { name: 'Accept' });
    if (!first) throw new Error('no accept button');
    await userEvent.click(first);
    await screen.findByText('Request accepted. 1 overlapping requests were declined.');
  });

  it('shows the conflict message when accepting an unavailable time', async () => {
    renderWithServices(<SessionRequestsPage />, {
      services: withRepo(
        stub({
          listPending: () => Promise.resolve(ok([tutorItem('a', 'Sam')])),
          decide: () => Promise.resolve(err({ kind: 'conflict', message: 'x' })) as never,
        }),
      ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await screen.findByText(/no longer be accepted because the time is unavailable/);
  });
});
