import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusMessage, type Status } from './status-message';

describe('StatusMessage', () => {
  it('announces errors with role="alert"', () => {
    render(<StatusMessage status="error">Could not save.</StatusMessage>);
    expect(screen.getByRole('alert')).toHaveTextContent('Error: Could not save.');
  });

  it.each<[Status, string]>([
    ['info', 'Information:'],
    ['success', 'Success:'],
    ['warning', 'Warning:'],
  ])('uses role="status" and a text prefix for %s', (status, prefix) => {
    render(<StatusMessage status={status}>Message</StatusMessage>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`${prefix} Message`);
  });

  it('hides the icon from assistive technology', () => {
    render(<StatusMessage status="info">Message</StatusMessage>);
    expect(screen.getByText('ℹ')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders an optional title', () => {
    render(
      <StatusMessage status="warning" title="Heads up">
        Message
      </StatusMessage>,
    );
    expect(screen.getByText('Heads up')).toBeInTheDocument();
  });
});
