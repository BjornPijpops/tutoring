import { Link, NavLink, Outlet } from 'react-router';
import { usePendingCount, useSessionPendingCount } from '../features/access/pending-count';
import { useAuth } from '../features/auth/auth-provider';
import { AuthControls, SignOutAlert } from '../features/auth/auth-controls';
import { StatusBadge } from '../shared/ui';
import { getNavItems } from './nav';
import styles from './layout.module.css';
import { RouteFocus } from './route-focus';
import { MAIN_ID } from './route-meta';
import { SkipLink } from './skip-link';

/** App shell: skip link, banner with navigation, `main` outlet and footer. */
export function Layout() {
  const { state } = useAuth();
  const user = state.status === 'signed-in' ? state.session.user : null;
  const pendingCount = usePendingCount(user?.role === 'tutor');
  const sessionPendingCount = useSessionPendingCount(user?.role === 'tutor');
  const navItems = getNavItems(user, pendingCount, sessionPendingCount);
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
            {navItems.map(({ to, label, pendingCount: pending }) => (
              <li key={to}>
                <NavLink to={to} end className={styles['navLink']}>
                  {label}
                  {pending ? (
                    <>
                      <span className="visually-hidden">{`, ${String(pending)} pending`}</span>
                      <span className={styles['badge']}>
                        <StatusBadge status="info" decorative>
                          {String(pending)}
                        </StatusBadge>
                      </span>
                    </>
                  ) : null}
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
