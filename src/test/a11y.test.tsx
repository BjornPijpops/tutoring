import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it } from 'vitest';
import { AuthControls } from '../features/auth/auth-controls';
import { LoginPage } from '../features/auth/login-page';
import { HomePage } from '../features/home/home-page';
import { RequireRole } from '../features/auth/require-role';
import { AvailabilityPage } from '../features/calendar/availability-page';
import { CalendarPage } from '../features/calendar/calendar-page';
import { ConfirmDialog } from '../shared/ui/confirm-dialog';
import { ErrorSummary } from '../shared/ui/error-summary';
import { Field } from '../shared/ui/field';
import { todayInBrussels } from '../shared/dates/brussels';
import type { Session } from '../core/domain/user';
import { expectNoViolations } from './axe';
import { InMemoryAuthProvider } from './in-memory-auth';
import {
  InMemoryBlockedTimeRepository,
  InMemoryCalendarEventRepository,
} from './in-memory-calendar';
import { Layout } from '../app/layout';
import { AccessPage } from '../features/access/access-page';
import { AccessRequestsPage } from '../features/access/access-requests-page';
import { createAccessServices } from './in-memory-access';
import { createTestServices, renderWithServices } from './render-with-services';

const TUTOR: Session = { user: { id: 't', role: 'tutor', accessState: 'none' } };
const NO_REQUEST: Session = { user: { id: 'n', role: 'tutee', accessState: 'none' } };
const TUTEE: Session = { user: { id: 'u', role: 'tutee', accessState: 'approved' } };

function tutorServices() {
  const day = todayInBrussels();
  const repo = new InMemoryCalendarEventRepository({
    seed: [
      {
        id: 'e1',
        title: 'Dentist appointment',
        startsAt: `${day}T12:00:00Z`,
        endsAt: `${day}T13:00:00Z`,
        source: 'manual',
      },
    ],
  });
  return {
    ...createTestServices(),
    auth: new InMemoryAuthProvider(TUTOR),
    calendarEvents: repo,
    blockedTime: new InMemoryBlockedTimeRepository(repo),
  };
}

describe('accessibility (axe)', () => {
  it('home page signed-in states', async () => {
    const { container } = renderWithServices(<HomePage />, { services: tutorServices() });
    await screen.findByText('Manage your calendar and access requests.');
    await expectNoViolations(container);
  });

  it('home page without access', async () => {
    const services = { ...createTestServices(), auth: new InMemoryAuthProvider(NO_REQUEST) };
    const { container } = renderWithServices(<HomePage />, { services });
    await screen.findByText(/Ask for access to see my availability/);
    await expectNoViolations(container);
  });

  it('access page: form, pending and denied states', async () => {
    const first = createAccessServices(NO_REQUEST);
    const form = renderWithServices(<AccessPage />, { services: first.services });
    await screen.findByText('alex@example.test');
    await expectNoViolations(form.container);
    form.unmount();

    const second = createAccessServices(NO_REQUEST);
    await second.repo.as({ id: 'n', role: 'tutee' }).requestAccess('Hello');
    const pending = renderWithServices(<AccessPage />, { services: second.services });
    await screen.findByRole('heading', { level: 1, name: 'Request sent' });
    await expectNoViolations(pending.container);
    pending.unmount();

    await second.repo.decide('n', 'denied');
    const denied = renderWithServices(<AccessPage />, { services: second.services });
    await screen.findByRole('heading', { level: 1, name: 'No access right now' });
    await expectNoViolations(denied.container);
  });

  it('access requests page with a list and the Manage link', async () => {
    const { services, repo } = createAccessServices(TUTOR);
    await repo.as({ id: 'a', role: 'tutee' }).requestAccess('Hi');
    await repo.as({ id: 'b', role: 'tutee' }).requestAccess('');
    await repo.decide('b', 'approved');
    const { container } = renderWithServices(<AccessRequestsPage />, { services });
    await screen.findByRole('button', { name: /^Approve / });
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole('button', { name: /Approved/ }));
    await screen.findByRole('link', { name: /^Manage / });
    await expectNoViolations(container);
  });

  it('layout with the tutor navigation and pending badge', async () => {
    const { services, repo } = createAccessServices({
      user: { id: 'user-1', role: 'tutor', accessState: 'none' },
    });
    await repo.as({ id: 'a', role: 'tutee' }).requestAccess('');
    const { container } = renderWithServices(<Layout />, { services });
    await screen.findByRole('link', { name: /^Access requests/ });
    await expectNoViolations(container);
  });

  it('availability page for an approved tutee', async () => {
    const { container } = renderWithServices(<AvailabilityPage />, {
      services: { ...tutorServices(), auth: new InMemoryAuthProvider(TUTEE) },
    });
    await screen.findByText('Times when the tutor is not available.');
    await expectNoViolations(container);
  });
  it('login page', async () => {
    const { container } = renderWithServices(<LoginPage />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    await expectNoViolations(container);
  });

  it('calendar page for the tutor: week table, day list and forms', async () => {
    const { container } = renderWithServices(<CalendarPage />, { services: tutorServices() });
    await screen.findAllByText('Dentist appointment');
    await expectNoViolations(container);
  });

  it('calendar page with form errors', async () => {
    const { container } = renderWithServices(<CalendarPage />, { services: tutorServices() });
    await userEvent.click(
      (await screen.findAllByRole('gridcell', { name: /08:00/ }))[0] as HTMLElement,
    );
    await userEvent.clear(screen.getByLabelText(/^Date/));
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await screen.findByRole('alert');
    await expectNoViolations(container);
  });

  it('calendar page with the delete dialog open', async () => {
    const { container } = renderWithServices(<CalendarPage />, { services: tutorServices() });
    await userEvent.click(
      await screen.findByRole('button', { name: /^Delete Dentist appointment/ }),
    );
    await screen.findByRole('dialog', { name: 'Delete this event?' });
    await expectNoViolations(container);
  });

  it('calendar page when signed out', async () => {
    const services = { ...createTestServices(), auth: new InMemoryAuthProvider(null, TUTOR) };
    const { container } = renderWithServices(
      <RequireRole requiredRole="tutor" heading="Calendar" noAccessText="Tutor only.">
        <CalendarPage />
      </RequireRole>,
      { services },
    );
    await screen.findByRole('button', { name: 'Sign in with Google' });
    await expectNoViolations(container);
  });

  it('calendar page without access', async () => {
    const services = { ...createTestServices(), auth: new InMemoryAuthProvider(TUTEE) };
    const { container } = renderWithServices(
      <RequireRole requiredRole="tutor" heading="Calendar" noAccessText="Tutor only.">
        <CalendarPage />
      </RequireRole>,
      { services },
    );
    await screen.findByText("You don't have access yet");
    await expectNoViolations(container);
  });

  it('availability page', async () => {
    const { container } = renderWithServices(<AvailabilityPage />, {
      services: tutorServices(),
    });
    await screen.findByRole('grid');
    await expectNoViolations(container);
  });

  it('auth controls', async () => {
    const { container } = renderWithServices(<AuthControls />, {
      services: tutorServices(),
    });
    await screen.findByRole('button', { name: /sign out/i });
    await expectNoViolations(container);
  });

  it('field with hint and error, and the error summary', async () => {
    const { container } = render(
      <>
        <ErrorSummary errors={[{ fieldId: 'f1', message: 'Enter a title' }]} />
        <Field label="Title" hint="Short" error="Enter a title" required>
          {(props) => <input {...props} />}
        </Field>
      </>,
    );
    await expectNoViolations(container);
  });

  it('confirm dialog', async () => {
    const { baseElement } = render(
      <ConfirmDialog
        open
        title="Delete?"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={() => undefined}
        onCancel={() => undefined}
        error="Failed"
      >
        Sure?
      </ConfirmDialog>,
    );
    await expectNoViolations(baseElement);
  });
});
