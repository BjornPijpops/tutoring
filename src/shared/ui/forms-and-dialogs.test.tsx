import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';
import { Dialog } from './dialog';
import { ErrorSummary } from './error-summary';
import { Field } from './field';

describe('Field', () => {
  it('labels the control and links hint and error', () => {
    render(
      <Field label="Title" hint="Short" error="Required" required>
        {(props) => <input {...props} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Title/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Short Required');
    expect(input).toBeRequired();
  });
});

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setOpen(true);
          }}
        >
          Open
        </button>
        <Dialog
          open={open}
          title="Hello"
          onClose={() => {
            setOpen(false);
          }}
        >
          <p>Body</p>
        </Dialog>
      </>
    );
  }

  it('opens, closes on cancel and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Hello' })).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });
});

describe('ConfirmDialog', () => {
  it('confirms and cancels, cancel first in DOM order', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={onConfirm}
        onCancel={onCancel}
        error="Failed"
      >
        Sure?
      </ConfirmDialog>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Keep', 'Delete']);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('ErrorSummary', () => {
  it('takes focus and moves focus to the field on link click', async () => {
    render(
      <>
        <ErrorSummary errors={[{ fieldId: 'f1', message: 'Enter a title' }]} />
        <input id="f1" aria-label="Title" />
      </>,
    );
    expect(screen.getByText('Please fix 1 problem below.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Enter a title' }));
    expect(screen.getByLabelText('Title')).toHaveFocus();
    expect(window.location.hash).toBe('');
  });
});
