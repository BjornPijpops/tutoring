/** Props of {@link StatusAnnouncer}. */
export interface StatusAnnouncerProps {
  /** Changing this text makes screen readers announce it. */
  message: string;
}

/** Persistent, visually hidden polite live region; keep one mounted per page. */
export function StatusAnnouncer({ message }: StatusAnnouncerProps) {
  return (
    <div role="status" aria-live="polite" className="visually-hidden">
      {message}
    </div>
  );
}
