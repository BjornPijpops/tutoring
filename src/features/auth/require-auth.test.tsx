import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { err } from '../../core/domain/result';
import type { Session } from '../../core/domain/user';
import type { AuthProvider } from '../../core/ports';
import { InMemoryAuthProvider } from '../../test/in-memory-auth';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { AuthControls } from './auth-controls';
import { RequireAuth } from './require-auth';
import { RequireRole } from './require-role';

const TUTOR: Session = { user: { id: 't', role: 'tutor' } };
const TUTEE: Session = { user: { id: 'u', role: 'tutee' } };

function servicesWith(auth: AuthProvider) {
  return { ...createTestServices(), auth };
}

describe('RequireAuth', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('shows the gate and signs in with Google when signed out', async () => {
    renderWithServices(
      <RequireAuth heading="Calendar">
        <p>secret</p>
      </RequireAuth>,
      { services: servicesWith(new InMemoryAuthProvider(null, TUTOR)) },
    );
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('shows an error when the session cannot be read', async () => {
    const auth = new InMemoryAuthProvider();
    auth.getSession = () => Promise.resolve(err({ kind: 'unavailable', message: 'offline' }));
    renderWithServices(
      <RequireAuth heading="Calendar">
        <p>secret</p>
      </RequireAuth>,
      { services: servicesWith(auth) },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't reach");
  });

  it('shows a problem when sign-in fails', async () => {
    const auth = new InMemoryAuthProvider();
    auth.signIn = () => Promise.resolve(err({ kind: 'unavailable', message: 'offline' }));
    renderWithServices(
      <RequireAuth heading="Calendar">
        <p>secret</p>
      </RequireAuth>,
      { services: servicesWith(auth) },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't reach");
  });
});

describe('RequireRole', () => {
  const ui = (
    <RequireRole requiredRole="tutor" heading="Calendar" noAccessText="Tutor only.">
      <p>secret</p>
    </RequireRole>
  );

  it('shows content to the tutor', async () => {
    renderWithServices(ui, { services: servicesWith(new InMemoryAuthProvider(TUTOR)) });
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('shows no-access to a tutee', async () => {
    renderWithServices(ui, { services: servicesWith(new InMemoryAuthProvider(TUTEE)) });
    expect(await screen.findByText("You don't have access yet")).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});

describe('AuthProvider OAuth callback', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('goes to the calendar and removes the query on a successful callback', async () => {
    window.history.replaceState(null, '', '/?code=oauth-code');
    renderWithServices(
      <RequireAuth heading="Calendar">
        <p>secret</p>
      </RequireAuth>,
    );
    await waitFor(() => {
      expect(window.location.hash).toBe('#/calendar');
    });
    expect(window.location.search).toBe('');
  });
  it('goes to the login page and removes the query on a cancelled callback', async () => {
    window.history.replaceState(null, '', '/?error=access_denied');
    renderWithServices(
      <RequireAuth heading="Calendar">
        <p>secret</p>
      </RequireAuth>,
    );
    await waitFor(() => {
      expect(window.location.hash).toBe('#/login');
    });
    expect(window.location.search).toBe('');
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
  });
});

describe('AuthControls', () => {
  it('signs out and navigates home', async () => {
    renderWithServices(
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AuthControls />
              <main id="main" tabIndex={-1} />
            </>
          }
        />
      </Routes>,
      { services: servicesWith(new InMemoryAuthProvider(TUTOR)) },
    );
    const button = await screen.findByRole('button', { name: 'Sign out' });
    await userEvent.click(button);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('shows a sign-in link while signed out', async () => {
    renderWithServices(<AuthControls />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
