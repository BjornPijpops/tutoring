import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import styles from './dialog.module.css';

/** Props of {@link Dialog}. */
export interface DialogProps {
  open: boolean;
  title: string;
  /** Called when the user dismisses the dialog (Esc); the parent decides whether to close. */
  onClose: () => void;
  /** Gives the parent the title element, e.g. to move focus to it when the content changes. */
  titleRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}

/**
 * Modal dialog on the native `<dialog>` element: focus trap, Esc and inert background come
 * from the browser. Focus returns to the element that opened it when that still exists.
 */
export function Dialog({ open, title, onClose, titleRef, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const isOpen = useRef(open);
  const titleId = useId();

  useEffect(() => {
    isOpen.current = open;
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
      // A dialog may mark its safest control; the browser would otherwise pick the first field.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) {
        opener.current.focus();
      }
    }
  }, [open]);

  // A parent may unmount the dialog while it is open; the opener must still get focus back.
  useEffect(
    () => () => {
      if (isOpen.current && opener.current instanceof HTMLElement && opener.current.isConnected) {
        opener.current.focus();
      }
    },
    [],
  );

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
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={titleRef ? -1 : undefined}
            className={styles['title']}
          >
            {title}
          </h2>
          {children}
        </>
      ) : null}
    </dialog>
  );
}
