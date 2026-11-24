import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../core/domain/user';
import { InMemoryAuthProvider } from '../test/in-memory-auth';
import { renderWithServices, createTestServices } from '../test/render-with-services';
import { HomePage } from './home/home-page';
import { NotFoundPage } from './not-found/not-found-page';

const TUTOR: Session = { user: { id: 'tutor', role: 'tutor' } };
const TUTEE: Session = { user: { id: 'tutee', role: 'tutee' } };

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

  it('shows the tutor calendar link when signed in as the tutor', async () => {
    renderWithServices(<HomePage />, {
      services: { ...createTestServices(), auth: new InMemoryAuthProvider(TUTOR) },
    });
    expect(await screen.findByText('You are signed in as the tutor.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows the no-access state for a signed-in tutee', async () => {
    renderWithServices(<HomePage />, {
      services: { ...createTestServices(), auth: new InMemoryAuthProvider(TUTEE) },
    });
    expect(
      await screen.findByText('You are signed in, but the tutor has not given you access yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});

describe('NotFoundPage', () => {
  it('shows the heading and a link back home', () => {
    renderWithServices(<NotFoundPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
