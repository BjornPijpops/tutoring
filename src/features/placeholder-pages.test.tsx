import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../core/domain/user';
import { createAccessServices } from '../test/in-memory-access';
import { InMemoryAuthProvider } from '../test/in-memory-auth';
import { renderWithServices, createTestServices } from '../test/render-with-services';
import { HomePage } from './home/home-page';
import { NotFoundPage } from './not-found/not-found-page';

const TUTOR: Session = { user: { id: 'tutor', role: 'tutor', accessState: 'none' } };

describe('HomePage', () => {
  it('shows the heading and a sign-in link to the login page while signed out', async () => {
    renderWithServices(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tutoring' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows the checking state while the session is resolving', () => {
    const auth = new InMemoryAuthProvider();
    vi.spyOn(auth, 'getSession').mockImplementation(() => new Promise(() => undefined));
    renderWithServices(<HomePage />, { services: { ...createTestServices(), auth } });
    expect(screen.getByRole('status')).toHaveTextContent('Checking your sign-in...');
  });

  it('offers the tutor the calendar and the access requests', async () => {
    renderWithServices(<HomePage />, {
      services: { ...createTestServices(), auth: new InMemoryAuthProvider(TUTOR) },
    });
    expect(await screen.findByText('Manage your calendar and access requests.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );
    expect(screen.getByRole('link', { name: 'Access requests' })).toHaveAttribute(
      'href',
      '/access-requests',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows the number of pending requests to the tutor', async () => {
    const { services, repo } = createAccessServices(TUTOR);
    await repo.as({ id: 'u-9', role: 'tutee' }).requestAccess('');
    renderWithServices(<HomePage />, { services });
    expect(
      await screen.findByRole('link', { name: 'Access requests (1 pending)' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['none', 'Ask for access to see my availability.', 'Request access', '/access'],
    ['approved', 'You have access.', 'See availability', '/availability'],
  ] as const)('shows the %s state to a tutee', async (accessState, lead, link, href) => {
    renderWithServices(<HomePage />, {
      services: {
        ...createTestServices(),
        auth: new InMemoryAuthProvider({ user: { id: 'u', role: 'tutee', accessState } }),
      },
    });
    expect(await screen.findByText(new RegExp(lead))).toBeVisible();
    expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', href);
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it.each([
    ['pending', 'Your request is waiting for the tutor.'],
    ['denied', "You don't have access right now."],
  ] as const)('shows the %s state with a link to the request status', async (accessState, text) => {
    renderWithServices(<HomePage />, {
      services: {
        ...createTestServices(),
        auth: new InMemoryAuthProvider({ user: { id: 'u', role: 'tutee', accessState } }),
      },
    });
    expect(await screen.findByText(text)).toBeVisible();
    expect(screen.getByRole('link', { name: 'See request status' })).toHaveAttribute(
      'href',
      '/access',
    );
  });
});
describe('NotFoundPage', () => {
  it('shows the heading and a link back home', () => {
    renderWithServices(<NotFoundPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
