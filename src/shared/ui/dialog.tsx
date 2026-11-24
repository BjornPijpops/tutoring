import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './dialog.module.css';

/** Props of {@link Dialog}. */
export interface DialogProps {
  open: boolean;
  title: string;
  /** Called when the user dismisses the dialog (Esc); the parent decides whether to close. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal dialog on the native `<dialog>` element: focus trap, Esc and inert background come
 * from the browser. Focus returns to the element that opened it when that still exists.
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) {
        opener.current.focus();
      }
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles['dialog']}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open ? (
        <>
          <h2 id={titleId} className={styles['title']}>
            {title}
          </h2>
          {children}
        </>
      ) : null}
    </dialog>
  );
}
