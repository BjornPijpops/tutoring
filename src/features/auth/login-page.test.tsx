import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Session } from '../../core/domain/user';
import { InMemoryAuthProvider } from '../../test/in-memory-auth';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { LoginPage } from './login-page';

const MICROSOFT = 'Continue with Microsoft (coming soon)';
const TUTOR: Session = { user: { id: 't', role: 'tutor', accessState: 'none' } };
const TUTEE: Session = { user: { id: 'u', role: 'tutee', accessState: 'approved' } };

function Where() {
  return <p>Page: {useLocation().pathname}</p>;
}

function renderRoutes(session: Session | null) {
  renderWithServices(
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { services: { ...createTestServices(), auth: new InMemoryAuthProvider(session) } },
  );
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

  it('signs in with Google and goes to the page for the new session', async () => {
    renderRoutes(null);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Page: /access')).toBeInTheDocument();
  });

  it('does nothing when the Microsoft button is clicked', async () => {
    renderWithServices(<LoginPage />);
    await userEvent.click(await screen.findByRole('button', { name: MICROSOFT }));
    expect(screen.queryByText('Page: /access')).not.toBeInTheDocument();
  });

  it.each([
    ['the tutor', TUTOR, '/calendar'],
    ['an approved tutee', TUTEE, '/availability'],
    ['a tutee without a request', { user: { ...TUTEE.user, accessState: 'none' } }, '/access'],
    ['a denied tutee', { user: { ...TUTEE.user, accessState: 'denied' } }, '/access'],
  ] as const)('redirects %s who is already signed in', async (_name, session, path) => {
    renderRoutes(session);
    expect(await screen.findByText(`Page: ${path}`)).toBeInTheDocument();
  });
});
