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
import { createTestServices, renderWithServices } from './render-with-services';

const TUTOR: Session = { user: { id: 't', role: 'tutor' } };
const TUTEE: Session = { user: { id: 'u', role: 'tutee' } };

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
    await screen.findByText('You are signed in as the tutor.');
    await expectNoViolations(container);
  });

  it('home page without access', async () => {
    const services = { ...createTestServices(), auth: new InMemoryAuthProvider(TUTEE) };
    const { container } = renderWithServices(<HomePage />, { services });
    await screen.findByText('You are signed in, but the tutor has not given you access yet.');
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
    await userEvent.click(await screen.findByRole('button', { name: 'Add blocked time' }));
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
    await screen.findByRole('table');
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
