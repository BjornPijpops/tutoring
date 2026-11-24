import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import type { ParsedIcs } from '../../core/domain/calendar-event';
import type { Session } from '../../core/domain/user';
import { todayInBrussels } from '../../shared/dates/brussels';
import {
  FakeIcsParser,
  InMemoryBlockedTimeRepository,
  InMemoryCalendarEventRepository,
} from '../../test/in-memory-calendar';
import { InMemoryAuthProvider } from '../../test/in-memory-auth';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { AvailabilityPage } from './availability-page';
import { CalendarPage } from './calendar-page';

const TUTOR: Session = { user: { id: 't', role: 'tutor' } };
const SECRET_TITLE = 'Dentist appointment';

function eventToday(id: string, title: string): CalendarEvent {
  const day = todayInBrussels();
  return {
    id,
    title,
    startsAt: `${day}T12:00:00Z`,
    endsAt: `${day}T13:00:00Z`,
    source: 'manual',
  };
}

function servicesFor(events: readonly CalendarEvent[], parsed?: ParsedIcs) {
  const repo = new InMemoryCalendarEventRepository({ seed: events });
  return {
    ...createTestServices(),
    auth: new InMemoryAuthProvider(TUTOR),
    calendarEvents: repo,
    blockedTime: new InMemoryBlockedTimeRepository(repo),
    ...(parsed ? { icsParser: new FakeIcsParser(parsed) } : {}),
  };
}

describe('CalendarPage', () => {
  it('shows the week and the events of the week', async () => {
    renderWithServices(<CalendarPage />, {
      services: servicesFor([eventToday('e1', SECRET_TITLE)]),
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect((await screen.findAllByText(SECRET_TITLE)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Delete Dentist appointment/ })).toBeInTheDocument();
  });

  it('adds a blocked time and confirms it', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([]) });
    await screen.findByText('No blocked events this week.');
    await userEvent.type(screen.getByLabelText(/^Date/), todayInBrussels());
    await userEvent.type(screen.getByLabelText(/^Start time/), '10:00');
    await userEvent.type(screen.getByLabelText(/^End time/), '11:00');
    await userEvent.type(screen.getByLabelText(/^Title/), 'Piano');
    await userEvent.click(screen.getByRole('button', { name: 'Add blocked time' }));
    expect(await screen.findByText(/Blocked time added/)).toBeInTheDocument();
    expect((await screen.findAllByText('Piano')).length).toBeGreaterThan(0);
  });

  it('shows an error summary for an empty form', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([]) });
    await userEvent.click(await screen.findByRole('button', { name: 'Add blocked time' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Date/)).toBeInvalid();
  });

  it('deletes an event after confirmation', async () => {
    renderWithServices(<CalendarPage />, {
      services: servicesFor([eventToday('e1', SECRET_TITLE)]),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: /^Delete Dentist appointment/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete this event?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    expect(await screen.findByText('No blocked events this week.')).toBeInTheDocument();
  });

  it('keeps the event when deletion is cancelled', async () => {
    renderWithServices(<CalendarPage />, {
      services: servicesFor([eventToday('e1', SECRET_TITLE)]),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: /^Delete Dentist appointment/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete this event?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep event' }));
    expect(screen.getByRole('button', { name: /^Delete Dentist appointment/ })).toBeInTheDocument();
  });

  it('navigates to the next week and back', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([]) });
    await screen.findByText('No blocked events this week.');
    await userEvent.click(screen.getByRole('button', { name: /next week/i }));
    expect(await screen.findByText('No blocked events this week.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('No blocked events this week.')).toBeInTheDocument();
  });

  it('reports a load failure with a retry', async () => {
    const services = servicesFor([]);
    const failing = services.calendarEvents;
    let fail = true;
    const original = failing.listEvents.bind(failing);
    failing.listEvents = async (range) => {
      if (fail) return { ok: false, error: { kind: 'unavailable', message: 'offline' } };
      return original(range);
    };
    renderWithServices(<CalendarPage />, { services });
    expect(await screen.findByText(/couldn't load the calendar/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No blocked events this week.')).toBeInTheDocument();
  });
});

describe('ImportPanel in the calendar page', () => {
  const day = todayInBrussels();
  const future = `${String(Number(day.slice(0, 4)) + 1)}-03-10`;
  const parsed: ParsedIcs = {
    occurrences: [
      {
        title: 'Imported meeting',
        startsAt: `${future}T09:00:00Z`,
        endsAt: `${future}T10:00:00Z`,
        externalId: 'uid-1#x',
      },
    ],
    skipped: [
      {
        title: 'Cancelled one',
        startsAt: `${future}T11:00:00Z`,
        endsAt: `${future}T12:00:00Z`,
        reason: 'cancelled',
      },
    ],
    warnings: [],
    importedUntil: `${future}T00:00:00Z`,
  };

  async function chooseFile(name = 'calendar.ics', type = 'text/calendar') {
    const input = await screen.findByLabelText(/^Calendar file/);
    const file = new File(['BEGIN:VCALENDAR'], name, { type });
    await userEvent.upload(input, file, { applyAccept: false });
  }

  it('previews, imports and offers removal of imported events', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([], parsed) });
    await chooseFile();
    expect(
      await screen.findByRole('heading', { name: 'Check before importing' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Imported meeting')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 event' }));
    expect(await screen.findByText(/1 event imported\./)).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove all imported events' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove all imported events?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove imported events' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Import another file' }));
    expect(
      screen.queryByRole('button', { name: 'Remove all imported events' }),
    ).not.toBeInTheDocument();
  });

  it('rejects files that are not calendar files', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([], parsed) });
    await chooseFile('notes.txt', 'text/plain');
    expect(await screen.findByText(/doesn't look like a calendar file/)).toBeInTheDocument();
  });

  it('shows an error when the file cannot be read', async () => {
    const services = {
      ...servicesFor([]),
      icsParser: new FakeIcsParser({ kind: 'validation', message: 'bad' }),
    };
    renderWithServices(<CalendarPage />, { services });
    await chooseFile();
    expect(await screen.findByText(/couldn't read this calendar file/)).toBeInTheDocument();
  });
});

describe('AvailabilityPage', () => {
  it('never puts event titles in the tutee DOM', async () => {
    const services = servicesFor([eventToday('e1', SECRET_TITLE)]);
    const { container } = renderWithServices(<AvailabilityPage />, { services });
    await screen.findByRole('heading', { level: 1, name: 'Availability' });
    await screen.findAllByText(/Blocked|Closed/i);
    expect(container.textContent).not.toContain(SECRET_TITLE);
  });
});
