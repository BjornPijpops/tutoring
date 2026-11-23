import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithServices } from '../../test/render-with-services';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  it('renders the heading and both provider buttons', () => {
    renderWithServices(<LoginPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['Continue with Google', 'Continue with Microsoft'])(
    'shows a not-available message when "%s" is clicked',
    async (name) => {
      renderWithServices(<LoginPage />);
      await userEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByRole('status')).toHaveTextContent('Sign-in is not available yet.');
    },
  );
});
