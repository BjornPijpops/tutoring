import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import type { Session } from '../../core/domain/user';
import { todayInBrussels } from '../../shared/dates/brussels';
import { expectNoViolations } from '../../test/axe';
import { InMemoryAuthProvider } from '../../test/in-memory-auth';
import {
  InMemoryBlockedTimeRepository,
  InMemoryCalendarEventRepository,
} from '../../test/in-memory-calendar';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { CalendarPage } from './calendar-page';

const TUTOR: Session = { user: { id: 't', role: 'tutor', accessState: 'none' } };

function manual(id: string, title: string): CalendarEvent {
  const day = todayInBrussels();
  return {
    id,
    title,
    startsAt: `${day}T12:00:00Z`,
    endsAt: `${day}T13:00:00Z`,
    source: 'manual',
  };
}

function servicesFor(events: readonly CalendarEvent[]) {
  const repo = new InMemoryCalendarEventRepository({ seed: events });
  return {
    repo,
    services: {
      ...createTestServices(),
      auth: new InMemoryAuthProvider(TUTOR),
      calendarEvents: repo,
      blockedTime: new InMemoryBlockedTimeRepository(repo),
    },
  };
}

async function firstFreeCell(): Promise<HTMLElement> {
  return (await screen.findAllByRole('gridcell', { name: /Tue 24 Nov/ }))[0] as HTMLElement;
}

/** Holds repository writes until `release` is called, counting the calls. */
function gate<T extends (...args: never[]) => Promise<unknown>>(original: T) {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = { count: 0 };
  const wrapped = (async (...args: Parameters<T>) => {
    calls.count += 1;
    await opened;
    return original(...args);
  }) as T;
  return { wrapped, release, calls };
}

describe('calendar create dialog flow', () => {
  it('opens from the keyboard and returns focus to the cell on Cancel', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([]).services });
    const cell = await firstFreeCell();
    cell.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Create blocked time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cell).toHaveFocus();
  });

  it('returns focus to the originating cell after a successful create', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([]).services });
    const cell = await firstFreeCell();
    cell.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.type(await screen.findByLabelText(/^Title/), 'Piano');
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('Event created.')).toBeInTheDocument();
    await waitFor(() => {
      expect(cell).toHaveFocus();
    });
    expect(await screen.findByRole('button', { name: /Delete Piano/ })).toBeInTheDocument();
  });

  it('returns focus to the event after editing it', async () => {
    renderWithServices(<CalendarPage />, {
      services: servicesFor([manual('e1', 'Dentist')]).services,
    });
    const events = await screen.findAllByRole('button', { name: /^Dentist/ });
    const eventButton = events[0] as HTMLElement;
    eventButton.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Edit blocked time' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Event updated.')).toBeInTheDocument();
    await waitFor(() => {
      expect(eventButton).toHaveFocus();
    });
  });

  it('protects against double submit and shows saving and busy state', async () => {
    const { repo, services } = servicesFor([]);
    const held = gate(repo.addEvents.bind(repo));
    repo.addEvents = held.wrapped;
    renderWithServices(<CalendarPage />, { services });
    await userEvent.click(await firstFreeCell());
    const submit = await screen.findByRole('button', { name: 'Create event' });
    const form = submit.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('grid', { hidden: true })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(held.calls.count).toBe(1);
    held.release();
    expect(await screen.findByText('Event created.')).toBeInTheDocument();
    expect(held.calls.count).toBe(1);
  });

  it('keeps the dialog and values and allows a retry after a save failure', async () => {
    const { repo, services } = servicesFor([]);
    const original = repo.addEvents.bind(repo);
    let fail = true;
    repo.addEvents = async (events) =>
      fail ? { ok: false, error: { kind: 'unavailable', message: 'offline' } } : original(events);
    renderWithServices(<CalendarPage />, { services });
    await userEvent.click(await firstFreeCell());
    await userEvent.type(await screen.findByLabelText(/^Title/), 'Piano');
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText(/couldn't save this event/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Piano');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('Event created.')).toBeInTheDocument();
  });

  it('explains clipping to open hours and saves only after confirmation', async () => {
    const { repo, services } = servicesFor([]);
    renderWithServices(<CalendarPage />, { services });
    await userEvent.click(await firstFreeCell());
    fireEvent.change(await screen.findByLabelText(/^Start/), { target: { value: '07:00' } });
    fireEvent.change(screen.getByLabelText(/^End/), { target: { value: '23:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByText(/The time outside 08:00–22:00 was removed\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Start/)).toHaveValue('08:00');
    expect(screen.getByLabelText(/^End/)).toHaveValue('22:00');
    const range = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' };
    expect((await repo.listEvents(range)).ok && (await repo.listEvents(range))).toMatchObject({
      value: [],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('Event created.')).toBeInTheDocument();
  });

  it('rejects a closed-only time with an accessible message', async () => {
    renderWithServices(<CalendarPage />, { services: servicesFor([]).services });
    await userEvent.click(await firstFreeCell());
    fireEvent.change(await screen.findByLabelText(/^Start/), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText(/^End/), { target: { value: '23:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(
      (await screen.findAllByText('Choose a time between 08:00 and 22:00.')).length,
    ).toBeGreaterThan(0);
  });

  it('shows imported events as view and delete only', async () => {
    const day = todayInBrussels();
    const imported: CalendarEvent = {
      id: 'i1',
      title: 'Imported meeting',
      startsAt: `${day}T12:00:00Z`,
      endsAt: `${day}T13:00:00Z`,
      source: 'ics',
    };
    renderWithServices(<CalendarPage />, { services: servicesFor([imported]).services });
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /^Imported meeting/ }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Imported event' });
    expect(within(dialog).getByText(/Imported from calendar file/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Delete event' })).toBeInTheDocument();
  });

  it('reports a conflict from a stale edit and keeps the dialog open', async () => {
    const { repo, services } = servicesFor([manual('e1', 'Dentist')]);
    repo.updateEvent = () =>
      Promise.resolve({
        ok: false,
        error: { kind: 'conflict', message: 'stale' },
      });
    renderWithServices(<CalendarPage />, { services });
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /^Dentist/ }))[0] as HTMLElement,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('This time changed. Review the times and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit blocked time' })).toBeInTheDocument();
  });

  it('has no axe violations with the create dialog open', async () => {
    const { container } = renderWithServices(<CalendarPage />, {
      services: servicesFor([manual('e1', 'Dentist')]).services,
    });
    await userEvent.click(await firstFreeCell());
    await screen.findByRole('dialog', { name: 'Create blocked time' });
    await expectNoViolations(container);
  });
});
