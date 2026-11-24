import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Session } from '../../core/domain/user';
import { InMemoryAuthProvider } from '../../test/in-memory-auth';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { LoginPage } from './login-page';

const MICROSOFT = 'Continue with Microsoft (coming soon)';
const TUTOR: Session = { user: { id: 't', role: 'tutor' } };
const TUTEE: Session = { user: { id: 'u', role: 'tutee' } };

function renderSignedIn(session: Session) {
  renderWithServices(<LoginPage />, {
    services: { ...createTestServices(), auth: new InMemoryAuthProvider(session) },
  });
}

describe('LoginPage', () => {
  it('renders the heading and both provider buttons', async () => {
    renderWithServices(<LoginPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(screen.getByRole('button', { name: MICROSOFT })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shows a checking message before the session is known', () => {
    renderWithServices(<LoginPage />);
    expect(screen.getByText('Checking your sign-in...')).toBeInTheDocument();
  });

  it('describes the Microsoft button as not available', async () => {
    renderWithServices(<LoginPage />);
    expect(await screen.findByRole('button', { name: MICROSOFT })).toHaveAccessibleDescription(
      'Microsoft sign-in is not available yet.',
    );
  });

  it('signs in with Google', async () => {
    renderWithServices(<LoginPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('does nothing when the Microsoft button is clicked', async () => {
    renderWithServices(<LoginPage />);
    await userEvent.click(await screen.findByRole('button', { name: MICROSOFT }));
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('offers the calendar to the tutor', async () => {
    renderSignedIn(TUTOR);
    expect(await screen.findByText('You are signed in.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );
  });

  it('tells other users they have no access yet', async () => {
    renderSignedIn(TUTEE);
    expect(await screen.findByText("You don't have access yet")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Go to calendar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });
});
