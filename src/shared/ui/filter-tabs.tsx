import styles from './filter-tabs.module.css';

/** One choice of a {@link FilterTabs}. */
export interface FilterOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Props of {@link FilterTabs}. */
export interface FilterTabsProps<T extends string> {
  options: readonly FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
}

/** Toggle buttons that pick which list is shown; simple buttons, not ARIA tabs. */
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: FilterTabsProps<T>) {
  return (
    <div role="group" aria-label={label} className={styles['group']}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={styles['option']}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.count === undefined ? option.label : `${option.label} (${String(option.count)})`}
        </button>
      ))}
    </div>
  );
}
