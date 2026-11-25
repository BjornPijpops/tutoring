import type { ReactNode } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import styles from './dialog.module.css';
import { StatusMessage } from './status-message';

/** Props of {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body text describing what will happen. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  /** Error from a previous confirm attempt. */
  error?: string;
  /** True while the confirmed action runs. */
  busy?: boolean;
}

/** Confirmation for destructive actions. Focus starts on the safe (cancel) action. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  error,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} title={title} onClose={busy ? () => undefined : onCancel}>
      <div>{children}</div>
      {error ? <StatusMessage status="error">{error}</StatusMessage> : null}
      <div className={styles['actions']}>
        <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus>
          {cancelLabel}
        </Button>
        <Button
          loading={busy}
          onClick={() => {
            void onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
