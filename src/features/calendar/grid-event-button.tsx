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
  /** Mobile list: show "Repeats" as a second line instead of only the glyph. */
  readonly showRepeatsText?: boolean;
}

/** Focusable block with a visible `Overlap` cue and a repeat indicator. */
export function GridEventButton({
  block,
  clusterSize,
  className,
  style,
  onActivate,
  showRepeatsText = false,
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
    >
      <span className={styles['eventName']}>
        {block.repeats ? (
          <span className={styles['repeatGlyph']} aria-hidden="true">
            {'\u21BB'}
          </span>
        ) : null}
        {block.label}
      </span>
      <span className="visually-hidden">, {blockDetail(block, clusterSize)}</span>
      {block.repeats && showRepeatsText ? (
        <span className={styles['repeatTag']} aria-hidden="true">
          Repeats
        </span>
      ) : null}
      {clusterSize > 1 ? (
        <span className={styles['overlapTag']} aria-hidden="true">
          Overlap
        </span>
      ) : null}
    </button>
  );
}
