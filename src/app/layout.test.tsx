import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithServices } from '../test/render-with-services';
import { Layout } from './layout';

function renderLayout(route = '/') {
  return renderWithServices(
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<h1>Home page</h1>} />
        <Route path="calendar" element={<h1>Calendar page</h1>} />
        <Route path="login" element={<h1>Login page</h1>} />
        <Route path="*" element={<h1>Missing</h1>} />
      </Route>
    </Routes>,
    { route },
  );
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

  it('lists the navigation links and marks the current page', () => {
    renderLayout('/calendar');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.querySelectorAll('a')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
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
