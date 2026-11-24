import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createAccessServices } from '../test/in-memory-access';
import { InMemoryAuthProvider } from '../test/in-memory-auth';
import { createTestServices, renderWithServices } from '../test/render-with-services';
import { Layout } from './layout';

function LayoutRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<h1>Home page</h1>} />
        <Route path="calendar" element={<h1>Calendar page</h1>} />
        <Route path="login" element={<h1>Login page</h1>} />
        <Route path="*" element={<h1>Missing</h1>} />
      </Route>
    </Routes>
  );
}

function renderLayout(route = '/') {
  return renderWithServices(<LayoutRoutes />, { route });
}

describe('Layout', () => {
  it('provides the page landmarks', () => {
    renderLayout();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  });

  it('makes the skip link the first tab stop', async () => {
    renderLayout();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Skip to main content' })).toHaveFocus();
  });

  it('moves focus to main from the skip link without changing the URL hash', async () => {
    renderLayout();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('');
  });

  it('lists only Home while signed out and marks the current page', () => {
    renderLayout('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.querySelectorAll('a')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('gives the tutor the calendar and access requests with the pending count in the name', async () => {
    const { services, repo } = createAccessServices({
      user: { id: 't', role: 'tutor', accessState: 'none' },
    });
    await repo.as({ id: 'u-9', role: 'tutee' }).requestAccess('');
    renderWithServices(<LayoutRoutes />, { route: '/calendar', services });
    const link = await screen.findByRole('link', { name: /^Access requests\s*,\s*1 pending/ });
    expect(link).toHaveAttribute('href', '/access-requests');
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  });

  it('gives an approved tutee Availability and no tutor links', async () => {
    renderWithServices(<LayoutRoutes />, {
      services: {
        ...createTestServices(),
        auth: new InMemoryAuthProvider({
          user: { id: 'u', role: 'tutee', accessState: 'approved' },
        }),
      },
    });
    expect(await screen.findByRole('link', { name: 'Availability' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Access requests/ })).not.toBeInTheDocument();
  });
  it('sets the document title on load without stealing focus', () => {
    renderLayout('/calendar');
    expect(document.title).toBe('Calendar · Tutoring');
    expect(screen.getByRole('main')).not.toHaveFocus();
  });

  it('updates the title, focuses main and the current link on navigation', async () => {
    renderLayout();
    expect(document.title).toBe('Home · Tutoring');

    await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));

    expect(document.title).toBe('Sign in · Tutoring');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('aria-current', 'page');
  });

  it('uses the not-found title for unknown routes', () => {
    renderLayout('/does-not-exist');
    expect(document.title).toBe('Page not found · Tutoring');
  });
});
