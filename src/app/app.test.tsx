import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServices } from '../test/render-with-services';
import { App } from './app';

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App services={createTestServices()} />);
}

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('renders the home page at #/', () => {
    renderApp('#/');
    expect(screen.getByRole('heading', { level: 1, name: 'Tutoring' })).toBeInTheDocument();
    expect(document.title).toBe('Home · Tutoring');
  });

  it('renders the calendar at #/calendar', () => {
    renderApp('#/calendar');
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
  });

  it('renders the not-found page for an unknown route', () => {
    renderApp('#/nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeInTheDocument();
  });

  it('navigates from home to the login page via the hash', async () => {
    renderApp('#/');
    await userEvent.click(screen.getByRole('main').querySelector('a') as HTMLElement);
    expect(window.location.hash).toBe('#/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
