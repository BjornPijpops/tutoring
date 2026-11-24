import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Session } from '../../core/domain/user';
import { createAccessServices } from '../../test/in-memory-access';
import { renderWithServices } from '../../test/render-with-services';
import { AvailabilityPage } from '../calendar/availability-page';
import { AccessPage } from './access-page';
import { AccessRequestsPage } from './access-requests-page';
import { RequireAccess } from './require-access';

const TUTOR: Session = { user: { id: 'user-1', role: 'tutor', accessState: 'none' } };
const NEW_TUTEE: Session = { user: { id: 'u-2', role: 'tutee', accessState: 'none' } };
const OTHER = { id: 'u-9', role: 'tutee' } as const;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAccess(
  session: Session,
  route: string,
  repo?: Parameters<typeof createAccessServices>[1],
) {
  const ctx = createAccessServices(session, repo);
  renderWithServices(
    <>
      <Where />
      <Routes>
        <Route path="/access" element={<AccessPage />} />
        <Route path="/access-requests" element={<AccessRequestsPage />} />
        <Route
          path="/availability"
          element={
            <RequireAccess heading="Availability">
              <AvailabilityPage />
            </RequireAccess>
          }
        />
      </Routes>
    </>,
    { services: ctx.services, route },
  );
  return ctx;
}

describe('AccessPage', () => {
  it('shows the form with the account details and sends a request', async () => {
    const user = userEvent.setup();
    const { repo } = renderAccess(NEW_TUTEE, '/access');
    expect(await screen.findByRole('heading', { level: 1, name: 'Request access' })).toBeVisible();
    expect(await screen.findByText('alex@example.test')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: /Message/ }), 'Hi, it is me');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Request sent' })).toBeVisible();
    const list = await repo.listRequests('pending');
    expect(list.ok && list.value.map((r) => r.message)).toEqual(['Hi, it is me']);
  });

  it('shows pending state for an existing request', async () => {
    const repo = createAccessServices(null).repo;
    await repo.as({ id: 'u-2', role: 'tutee' }).requestAccess('');
    renderAccess(NEW_TUTEE, '/access', repo);
    expect(await screen.findByRole('heading', { level: 1, name: 'Request sent' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });

  it('explains a denial with the cooldown', async () => {
    const repo = createAccessServices(null).repo;
    await repo.as({ id: 'u-2', role: 'tutee' }).requestAccess('');
    await repo.decide('u-2', 'denied');
    renderAccess(NEW_TUTEE, '/access', repo);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No access right now' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });

  it('sends the tutor to the requests page and an approved tutee to availability', async () => {
    renderAccess(TUTOR, '/access');
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/access-requests');
    });
  });

  it('shows a retryable error when the request cannot be loaded', async () => {
    const ctx = createAccessServices(NEW_TUTEE);
    ctx.services.accessRequests.getMine = () =>
      Promise.resolve({ ok: false, error: { kind: 'unavailable', message: 'x' } });
    renderWithServices(<AccessPage />, { services: ctx.services, route: '/access' });
    expect(await screen.findByText(/couldn't load your request/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

describe('AccessRequestsPage', () => {
  it('approves a request and moves focus on', async () => {
    const user = userEvent.setup();
    const repo = createAccessServices(null).repo;
    await repo.as({ id: 'u-8', role: 'tutee' }).requestAccess('first');
    await repo.as(OTHER).requestAccess('second');
    renderAccess(TUTOR, '/access-requests', repo);
    const approve = await screen.findAllByRole('button', { name: /^Approve / });
    expect(approve).toHaveLength(2);
    await user.click(approve[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Approve / })).toHaveLength(1);
    });
    const res = await repo.listRequests('approved');
    expect(res.ok && res.value).toHaveLength(1);
  });

  it('asks for confirmation before revoking', async () => {
    const user = userEvent.setup();
    const repo = createAccessServices(null).repo;
    await repo.as(OTHER).requestAccess('');
    await repo.decide(OTHER.id, 'approved');
    renderAccess(TUTOR, '/access-requests', repo);
    await user.click(await screen.findByRole('button', { name: /Approved/ }));
    await user.click(await screen.findByRole('button', { name: /^Revoke access for / }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep access' }));
    const res = await repo.listRequests('approved');
    expect(res.ok && res.value).toHaveLength(1);
  });

  it('renders messages as text only', async () => {
    const repo = createAccessServices(null).repo;
    const evil = '<script>alert(1)</script>' + 'x'.repeat(300);
    await repo.as(OTHER).requestAccess(evil.slice(0, 500));
    const { container } =
      (renderAccess(TUTOR, '/access-requests', repo), { container: document.body });
    expect(await screen.findByText(/<script>alert\(1\)<\/script>/)).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows an empty state', async () => {
    renderAccess(TUTOR, '/access-requests');
    expect(await screen.findByText(/No requests waiting/)).toBeVisible();
  });
});

describe('RequireAccess', () => {
  it('sends someone without access to /access', async () => {
    renderAccess(NEW_TUTEE, '/availability');
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/access');
    });
  });

  it('lets an approved tutee in and keeps URLs free of personal data', async () => {
    renderAccess({ user: { id: 'u-2', role: 'tutee', accessState: 'approved' } }, '/availability');
    expect(await screen.findByText('Times when the tutor is free or not.')).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/availability$/);
  });
});
