import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Container } from './container';
import { PageHeading } from './page-heading';

describe('PageHeading', () => {
  it('renders exactly one h1', () => {
    render(<PageHeading>Calendar</PageHeading>);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
  });

  it('renders the lead paragraph after the heading', () => {
    render(<PageHeading lead="Welcome back">Home</PageHeading>);
    const heading = screen.getByRole('heading', { level: 1 });
    const lead = screen.getByText('Welcome back');
    expect(lead.tagName).toBe('P');
    expect(heading.nextElementSibling).toBe(lead);
  });

  it('omits the lead when not given', () => {
    const { container } = render(<PageHeading>Home</PageHeading>);
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('Container', () => {
  it('renders children in a div by default', () => {
    render(<Container>content</Container>);
    expect(screen.getByText('content').tagName).toBe('DIV');
  });

  it('can render a section', () => {
    render(<Container as="section">content</Container>);
    expect(screen.getByText('content').tagName).toBe('SECTION');
  });
});
