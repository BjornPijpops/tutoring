import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { addDays } from '../../core/domain/local-time';
import { expandRecurrence, type RecurrenceRule } from '../../core/domain/recurrence';
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
import { weekdayOf } from './repeat-form';

const TUTOR: Session = { user: { id: 't', role: 'tutor', accessState: 'none' } };

function setup(seedSeries = false) {
  const repo = new InMemoryCalendarEventRepository();
  const today = todayInBrussels();
  const startDate = addDays(today, 7);
  const rule: RecurrenceRule = {
    startDate,
    intervalWeeks: 1,
    weekdays: [weekdayOf(startDate) ?? 1],
    startMinutes: 600,
    endMinutes: 660,
    end: { kind: 'count', count: 3 },
  };
  const ready = seedSeries
    ? repo.addSeries({
        rule,
        title: 'Piano',
        occurrences: expandRecurrence(rule, today).occurrences,
      })
    : Promise.resolve();
  const services = {
    ...createTestServices(),
    auth: new InMemoryAuthProvider(TUTOR),
    calendarEvents: repo,
    blockedTime: new InMemoryBlockedTimeRepository(repo),
  };
  return { repo, services, ready, startDate };
}

async function openNextWeek() {
  await screen.findAllByRole('gridcell', { name: /08:00/ });
  await userEvent.click(screen.getByRole('button', { name: /next week/i }));
}

async function openCreateDialog() {
  await openNextWeek();
  const cell = (await screen.findAllByRole('gridcell', { name: /08:00/ }))[0] as HTMLElement;
  await userEvent.click(cell);
  return screen.findByRole('dialog', { name: 'Create blocked time' });
}

async function openSeriesEvent() {
  await openNextWeek();
  await userEvent.click(
    (await screen.findAllByRole('button', { name: /^Piano/ }))[0] as HTMLElement,
  );
  return screen.findByRole('dialog', { name: 'Edit blocked time' });
}

describe('repeat controls in the create dialog', () => {
  it('offers a native Repeat select and has no axe violations', async () => {
    const { services } = setup();
    const { container } = renderWithServices(<CalendarPage />, { services });
    const dialog = await openCreateDialog();
    const select = within(dialog).getByRole('combobox', { name: 'Repeat' });
    expect(select.tagName).toBe('SELECT');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Does not repeat',
      expect.stringMatching(/^Every week on /),
      'Every weekday (Monday to Friday)',
      'Custom\u2026',
    ]);
    expect(within(dialog).queryByText('Ends')).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('shows the required Ends group and a summary for a weekly choice', async () => {
    const { services } = setup();
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openCreateDialog();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Repeat' }),
      'weekly',
    );
    expect(within(dialog).getByRole('group', { name: /^Ends/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'On date' })).toBeChecked();
    expect(within(dialog).getByText(/^Weekly on \w{3} until /)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create events' })).toBeInTheDocument();
  });

  it('shows the custom section and has no axe violations', async () => {
    const { services } = setup();
    const { container } = renderWithServices(<CalendarPage />, { services });
    const dialog = await openCreateDialog();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Repeat' }),
      'custom',
    );
    expect(within(dialog).getByRole('spinbutton', { name: /Repeat every/ })).toHaveValue(1);
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(7);
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .filter((box) => (box as HTMLInputElement).checked),
    ).toHaveLength(1);
    await expectNoViolations(container);
  });

  it('shows errors for an invalid interval and count, naming the allowed range', async () => {
    const { services } = setup();
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openCreateDialog();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Repeat' }),
      'custom',
    );
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Repeat every/ }), {
      target: { value: '13' },
    });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'After' }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Number of events/ }), {
      target: { value: '1' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create events' }));
    expect(
      (await within(dialog).findAllByText('Enter a number of weeks from 1 to 12.')).length,
    ).toBeGreaterThan(0);
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Repeat every/ }), {
      target: { value: '2' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create events' }));
    expect(
      (await within(dialog).findAllByText('Enter a number of events from 2 to 400.')).length,
    ).toBeGreaterThan(0);
  });

  it('creates the events and announces how many', async () => {
    const { services, repo } = setup();
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Piano');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Repeat' }),
      'weekly',
    );
    await userEvent.click(within(dialog).getByRole('radio', { name: 'After' }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Number of events/ }), {
      target: { value: '4' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create events' }));
    expect(await screen.findByText('4 events created.')).toBeInTheDocument();
    expect(repo.snapshot().filter((event) => event.seriesId)).toHaveLength(4);
  });
});

describe('repeating events in the grid and the edit flow', () => {
  it('marks repeating events and removes the events list', async () => {
    const { services, ready } = setup(true);
    await ready;
    const { container } = renderWithServices(<CalendarPage />, { services });
    await openNextWeek();
    const events = await screen.findAllByRole('button', { name: /^Piano/ });
    expect(events[0]).toHaveAccessibleName(/repeats/);
    expect(screen.queryByRole('heading', { name: 'Events this week' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete Piano/ })).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('does not delete with the Delete key', async () => {
    const { services, ready, repo } = setup(true);
    await ready;
    renderWithServices(<CalendarPage />, { services });
    await openNextWeek();
    const event = (await screen.findAllByRole('button', { name: /^Piano/ }))[0] as HTMLElement;
    event.focus();
    await userEvent.keyboard('{Delete}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(repo.snapshot()).toHaveLength(3);
  });

  it('shows the repeat pattern read-only in the edit dialog', async () => {
    const { services, ready } = setup(true);
    await ready;
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openSeriesEvent();
    expect(await within(dialog).findByText(/^Repeats: Weekly on /)).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Repeat' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/delete it and create a new one/)).toBeInTheDocument();
  });

  it('asks which events to change and updates the whole series', async () => {
    const { services, ready, repo } = setup(true);
    await ready;
    const { container } = renderWithServices(<CalendarPage />, { services });
    const dialog = await openSeriesEvent();
    await within(dialog).findByText(/^Repeats: /);
    const title = within(dialog).getByLabelText(/^Title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Violin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    const scope = await screen.findByRole('dialog', { name: 'Edit repeating event' });
    expect(within(scope).getByRole('radio', { name: 'This event' })).toBeChecked();
    expect(
      within(scope).getByRole('radio', { name: 'This and following events' }),
    ).toBeInTheDocument();
    await expectNoViolations(container);
    await userEvent.click(within(scope).getByRole('radio', { name: 'All events' }));
    await userEvent.click(within(scope).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('3 events updated.')).toBeInTheDocument();
    expect(repo.snapshot().every((event) => event.title === 'Violin')).toBe(true);
  });

  it('only allows This event when the date changes', async () => {
    const { services, ready, startDate } = setup(true);
    await ready;
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openSeriesEvent();
    await within(dialog).findByText(/^Repeats: /);
    fireEvent.change(within(dialog).getByLabelText(/^Date/), {
      target: { value: addDays(startDate, 1) },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    const scope = await screen.findByRole('dialog', { name: 'Edit repeating event' });
    expect(within(scope).getByRole('radio', { name: 'All events' })).toBeDisabled();
    expect(within(scope).getAllByText('Dates can only be changed for a single event.').length).toBe(
      2,
    );
  });

  it('returns from the scope step to the form with the values intact', async () => {
    const { services, ready } = setup(true);
    await ready;
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openSeriesEvent();
    await within(dialog).findByText(/^Repeats: /);
    const title = within(dialog).getByLabelText(/^Title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Violin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    const scope = await screen.findByRole('dialog', { name: 'Edit repeating event' });
    await userEvent.click(within(scope).getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText(/^Title/)).toHaveValue('Violin');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says nothing changed when a repeating event is saved unchanged', async () => {
    const { services, ready } = setup(true);
    await ready;
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openSeriesEvent();
    await within(dialog).findByText(/^Repeats: /);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Nothing has changed.')).toBeInTheDocument();
  });

  it('deletes from this event on and announces the count', async () => {
    const { services, ready, repo } = setup(true);
    await ready;
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openSeriesEvent();
    await within(dialog).findByText(/^Repeats: /);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    const scope = await screen.findByRole('dialog', { name: 'Delete repeating event' });
    await userEvent.click(within(scope).getByRole('radio', { name: 'This and following events' }));
    await userEvent.click(within(scope).getByRole('button', { name: 'Delete events' }));
    expect(await screen.findByText('3 events deleted.')).toBeInTheDocument();
    expect(repo.snapshot()).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Week view' })).toHaveFocus();
    });
  });

  it('shows a message when the event is already gone', async () => {
    const { services, ready, repo } = setup(true);
    await ready;
    renderWithServices(<CalendarPage />, { services });
    const dialog = await openSeriesEvent();
    await within(dialog).findByText(/^Repeats: /);
    repo.removeEvent = () =>
      Promise.resolve({ ok: false, error: { kind: 'not-found', message: 'gone' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete event' }));
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  });

  it('offers no scope step for imported events', async () => {
    const day = addDays(todayInBrussels(), 7);
    const imported: CalendarEvent = {
      id: 'i1',
      title: 'Imported meeting',
      startsAt: `${day}T12:00:00Z`,
      endsAt: `${day}T13:00:00Z`,
      source: 'ics',
    };
    const repo = new InMemoryCalendarEventRepository({ seed: [imported] });
    renderWithServices(<CalendarPage />, {
      services: {
        ...createTestServices(),
        auth: new InMemoryAuthProvider(TUTOR),
        calendarEvents: repo,
        blockedTime: new InMemoryBlockedTimeRepository(repo),
      },
    });
    await openNextWeek();
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /^Imported meeting/ }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Imported event' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    expect(await screen.findByRole('dialog', { name: 'Delete this event?' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
