import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { ButtonLink } from './button-link';

describe('Button', () => {
  it('defaults to type="button"', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('allows type="submit"', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
  });

  it('applies the secondary variant and full width', () => {
    render(
      <Button variant="secondary" fullWidth>
        More
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'More' });
    expect(button).toHaveClass('secondary');
    expect(button).toHaveClass('fullWidth');
  });

  it('is primary by default', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('primary');
  });

  it('when loading is busy, disabled and keeps its label', () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('calls onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([{ disabled: true }, { loading: true }])(
    'does not fire onClick when %o',
    async (props) => {
      const onClick = vi.fn();
      render(
        <Button onClick={onClick} {...props}>
          Go
        </Button>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Go' }));
      expect(onClick).not.toHaveBeenCalled();
    },
  );
});

describe('ButtonLink', () => {
  it('renders a link styled as a button', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/login">Sign in</ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveClass('button', 'primary');
  });
});
