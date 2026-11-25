import type { RecurrenceScope } from '../../core/domain/recurrence';
import styles from './event-dialog.module.css';

export type ScopeAction = 'edit' | 'delete';

export interface ScopeStepProps {
  readonly action: ScopeAction;
  /** The clicked event as text, e.g. "Tue 2 Dec, 18:00-20:00". */
  readonly when: string;
  readonly scope: RecurrenceScope;
  readonly disabled: boolean;
  /** Only "This event" can be chosen: the date changed, or the series could not be loaded. */
  readonly onlyThis?: 'date' | 'details';
  readonly onChange: (scope: RecurrenceScope) => void;
}

interface Option {
  readonly scope: RecurrenceScope;
  readonly label: string;
  readonly hint: string;
}

function optionsFor(action: ScopeAction, when: string): readonly Option[] {
  const edit = action === 'edit';
  return [
    {
      scope: 'this',
      label: 'This event',
      hint: `Only ${when} ${edit ? 'changes' : 'is deleted'}.`,
    },
    {
      scope: 'following',
      label: 'This and following events',
      hint: edit
        ? 'This event and all later events in the series change.'
        : 'This event and all later events in the series are deleted. Earlier events stay.',
    },
    {
      scope: 'all',
      label: 'All events',
      hint: edit
        ? 'Every event in the series changes, including past ones.'
        : 'Every event in the series is deleted, including past ones. This cannot be undone.',
    },
  ];
}

const DATE_HINT = 'Dates can only be changed for a single event.';
const DETAILS_HINT = 'Repeat details are unavailable, so only this event can be changed.';

/** "Which events?" question of the edit and delete steps for a repeating event. */
export function ScopeStep({ action, when, scope, disabled, onlyThis, onChange }: ScopeStepProps) {
  const options = optionsFor(action, when).filter(
    (option) => onlyThis !== 'details' || option.scope === 'this',
  );
  return (
    <fieldset className={styles['fieldset']} disabled={disabled}>
      <legend className={styles['legend']}>
        {action === 'edit'
          ? 'Which events do you want to change?'
          : 'Which events do you want to delete?'}
      </legend>
      {options.map((option) => {
        const locked = onlyThis === 'date' && option.scope !== 'this';
        const hint = locked ? DATE_HINT : onlyThis === 'details' ? DETAILS_HINT : option.hint;
        const hintId = `scope-${option.scope}-hint`;
        return (
          <div key={option.scope} className={styles['option']}>
            <label className={styles['radioLabel']}>
              <input
                type="radio"
                name="scope"
                value={option.scope}
                checked={scope === option.scope}
                disabled={locked}
                aria-describedby={hintId}
                onChange={() => {
                  onChange(option.scope);
                }}
              />
              {option.label}
            </label>
            <p id={hintId} className={styles['hint']}>
              {hint}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
}
