import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithServices } from '../test/render-with-services';
import { CalendarPage } from './calendar/calendar-page';
import { HomePage } from './home/home-page';
import { NotFoundPage } from './not-found/not-found-page';

describe('HomePage', () => {
  it('shows the heading and a sign-in link to the login page', () => {
    renderWithServices(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tutoring' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

describe('CalendarPage', () => {
  it('shows the heading and the coming-soon message', () => {
    renderWithServices(<CalendarPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The availability calendar is coming soon.',
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
