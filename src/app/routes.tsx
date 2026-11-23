import { Route, Routes } from 'react-router';
import { LoginPage } from '../features/auth/login-page';
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
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
