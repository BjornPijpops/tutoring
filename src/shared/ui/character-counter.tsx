import styles from './character-counter.module.css';

/** Props of {@link CharacterCounter}. */
export interface CharacterCounterProps {
  value: string;
  max: number;
  /** Id for `aria-describedby` on the field. */
  id?: string;
}

const WARN_AT = 50;

/**
 * Length of `value` against `max`. Always visible text; a separate polite live region only
 * speaks when the state changes (near the limit, over it), not on every keystroke.
 */
export function CharacterCounter({ value, max, id }: CharacterCounterProps) {
  const length = value.length;
  const left = max - length;
  let text = `${String(length)} / ${String(max)}`;
  let state: 'ok' | 'near' | 'over' = 'ok';
  if (left < 0) {
    state = 'over';
    text = `${String(-left)} ${left === -1 ? 'character' : 'characters'} too many`;
  } else if (left <= WARN_AT) {
    state = 'near';
    text = `${String(left)} ${left === 1 ? 'character' : 'characters'} left`;
  }
  const announcement = { ok: '', near: 'Close to the limit.', over: 'Over the limit.' }[state];

  return (
    <>
      <p id={id} className={`${styles['counter']} ${state === 'over' ? styles['over'] : ''}`}>
        {text}
      </p>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
