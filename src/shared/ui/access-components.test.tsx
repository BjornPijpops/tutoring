import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  CharacterCounter,
  DefinitionList,
  EmptyState,
  Field,
  FilterTabs,
  StatusAnnouncer,
  StatusBadge,
  TextArea,
} from '.';

describe('TextArea', () => {
  it('is a labelled multi-line textbox with 4 rows by default', () => {
    render(<Field label="Message">{(props) => <TextArea {...props} />}</Field>);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('rows', '4');
  });
});

describe('CharacterCounter', () => {
  it('shows length against the maximum', () => {
    render(<CharacterCounter value="abc" max={500} />);
    expect(screen.getByText('3 / 500')).toBeInTheDocument();
  });

  it('switches to characters left near the limit and too many over it', () => {
    const { rerender } = render(<CharacterCounter value={'a'.repeat(450)} max={500} />);
    expect(screen.getByText('50 characters left')).toBeInTheDocument();
    rerender(<CharacterCounter value={'a'.repeat(499)} max={500} />);
    expect(screen.getByText('1 character left')).toBeInTheDocument();
    rerender(<CharacterCounter value={'a'.repeat(503)} max={500} />);
    expect(screen.getByText('3 characters too many')).toBeInTheDocument();
  });

  it('only announces threshold states, not every keystroke', () => {
    const { rerender } = render(<CharacterCounter value="a" max={500} />);
    const region = screen.getAllByRole('status')[0];
    expect(region).toHaveTextContent('');
    rerender(<CharacterCounter value={'a'.repeat(460)} max={500} />);
    expect(region).toHaveTextContent('Close to the limit.');
    rerender(<CharacterCounter value={'a'.repeat(470)} max={500} />);
    expect(region).toHaveTextContent('Close to the limit.');
    rerender(<CharacterCounter value={'a'.repeat(501)} max={500} />);
    expect(region).toHaveTextContent('Over the limit.');
  });
});

describe('StatusBadge', () => {
  it('shows its text, or hides it when decorative', () => {
    const { rerender } = render(<StatusBadge status="success">Approved</StatusBadge>);
    expect(screen.getByText('Approved')).not.toHaveAttribute('aria-hidden');
    rerender(
      <StatusBadge status="info" decorative>
        3
      </StatusBadge>,
    );
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('StatusAnnouncer', () => {
  it('is a persistent polite status region', () => {
    render(<StatusAnnouncer message="Alex approved." />);
    expect(screen.getByRole('status')).toHaveTextContent('Alex approved.');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('FilterTabs', () => {
  function Harness() {
    const [value, setValue] = useState<'a' | 'b'>('a');
    return (
      <FilterTabs
        label="Show"
        value={value}
        onChange={setValue}
        options={[
          { value: 'a', label: 'Pending', count: 3 },
          { value: 'b', label: 'Approved' },
        ]}
      />
    );
  }

  it('exposes pressed state and changes the selection', async () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Show' });
    expect(within(group).getByRole('button', { name: 'Pending (3)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(group).getByRole('button', { name: 'Approved' }));
    expect(within(group).getByRole('button', { name: 'Approved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: 'Pending (3)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('EmptyState and DefinitionList', () => {
  it('renders text and an optional action', () => {
    render(<EmptyState action={<button type="button">Do</button>}>Nothing here.</EmptyState>);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Do' })).toBeInTheDocument();
  });

  it('renders terms and definitions', () => {
    render(<DefinitionList items={[{ label: 'Name', value: 'Alex' }]} />);
    expect(screen.getByText('Name').tagName).toBe('DT');
    expect(screen.getByText('Alex').tagName).toBe('DD');
  });
});
