import { MAIN_ID } from './route-meta';
import styles from './skip-link.module.css';

/**
 * First tab stop; moves focus to `main`. A button rather than `href="#main"`
 * because hash links would change the HashRouter route.
 */
export function SkipLink() {
  return (
    <button
      type="button"
      className={styles['skipLink']}
      onClick={() => document.getElementById(MAIN_ID)?.focus()}
    >
      Skip to main content
    </button>
  );
}
