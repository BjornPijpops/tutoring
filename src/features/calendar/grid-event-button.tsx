import type { CSSProperties } from 'react';
import { blockDetail } from './time-grid-labels';
import type { GridBlock } from './time-grid-model';
import styles from './calendar.module.css';

export interface GridEventButtonProps {
  readonly block: GridBlock;
  readonly clusterSize: number;
  readonly className: string;
  readonly style?: CSSProperties;
  readonly onActivate: (key: string) => void;
  readonly onDelete: (key: string) => void;
}

/** Focusable block with a visible `Overlap` cue; Delete is an intent, only if not read-only. */
export function GridEventButton({
  block,
  clusterSize,
  className,
  style,
  onActivate,
  onDelete,
}: GridEventButtonProps) {
  return (
    <button
      type="button"
      className={`${className} ${block.kind === 'blocked' && block.readOnly ? styles['anonymousBlocked'] : ''} ${block.kind === 'busy' ? styles['sessionBlock'] : ''}`}
      {...(style ? { style } : {})}
      aria-label={`${block.label}, ${blockDetail(block, clusterSize)}`}
      aria-disabled={block.readOnly ? true : undefined}
      onClick={() => {
        if (!block.readOnly) onActivate(block.key);
      }}
      onKeyDown={(keyboard) => {
        if (keyboard.key !== 'Delete' || block.readOnly) return;
        keyboard.preventDefault();
        onDelete(block.key);
      }}
    >
      <span className={styles['eventName']}>{block.label}</span>
      <span className="visually-hidden">, {blockDetail(block, clusterSize)}</span>
      {clusterSize > 1 ? (
        <span className={styles['overlapTag']} aria-hidden="true">
          Overlap
        </span>
      ) : null}
    </button>
  );
}
