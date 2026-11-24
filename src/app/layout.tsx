import { Link, NavLink, Outlet } from 'react-router';
import { AuthControls, SignOutAlert } from '../features/auth/auth-controls';
import styles from './layout.module.css';
import { RouteFocus } from './route-focus';
import { MAIN_ID } from './route-meta';
import { SkipLink } from './skip-link';

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/calendar', label: 'Calendar' },
] as const;

/** App shell: skip link, banner with navigation, `main` outlet and footer. */
export function Layout() {
  return (
    <div className={styles['page']}>
      <RouteFocus />
      <SkipLink />
      <header className={styles['header']}>
        <Link to="/" className={styles['brand']}>
          Tutoring
        </Link>
        <nav aria-label="Main">
          <ul className={styles['navList']}>
            {NAV_ITEMS.map(({ to, label }) => (
              <li key={to}>
                <NavLink to={to} end className={styles['navLink']}>
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <AuthControls />
      </header>
      <SignOutAlert />
      <main id={MAIN_ID} tabIndex={-1} className={styles['main']}>
        <Outlet />
      </main>
      <footer className={styles['footer']}>
        <small>© {new Date().getFullYear()} Tutoring</small>
      </footer>
    </div>
  );
}
