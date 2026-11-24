import { Route, Routes } from 'react-router';
import { AccessPage } from '../features/access/access-page';
import { AccessRequestsPage } from '../features/access/access-requests-page';
import { RequireAccess } from '../features/access/require-access';
import { LoginPage } from '../features/auth/login-page';
import { RequireAuth } from '../features/auth/require-auth';
import { RequireRole } from '../features/auth/require-role';
import { AvailabilityPage } from '../features/calendar/availability-page';
import { CalendarPage } from '../features/calendar/calendar-page';
import { HomePage } from '../features/home/home-page';
import { NotFoundPage } from '../features/not-found/not-found-page';
import { Layout } from './layout';

/** Route table; page titles live in `route-meta.ts`. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="calendar"
          element={
            <RequireRole
              requiredRole="tutor"
              heading="Calendar"
              noAccessText="The calendar is only available to the tutor."
            >
              <CalendarPage />
            </RequireRole>
          }
        />
        <Route
          path="access"
          element={
            <RequireAuth heading="Request access" signInText="Sign in to ask the tutor for access.">
              <AccessPage />
            </RequireAuth>
          }
        />
        <Route
          path="access-requests"
          element={
            <RequireRole
              requiredRole="tutor"
              heading="Access requests"
              noAccessText="Access requests are only available to the tutor."
            >
              <AccessRequestsPage />
            </RequireRole>
          }
        />
        <Route
          path="availability"
          element={
            <RequireAccess heading="Availability">
              <AvailabilityPage />
            </RequireAccess>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
