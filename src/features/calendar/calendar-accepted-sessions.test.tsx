import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { err } from '../../core/domain/result';
import type { Session } from '../../core/domain/user';
import { InMemorySessionRequestRepository } from '../../test/in-memory-sessions';
import { todayInBrussels } from '../../shared/dates/brussels';
import { expectNoViolations } from '../../test/axe';
import { InMemoryAuthProvider } from '../../test/in-memory-auth';
import {
  InMemoryBlockedTimeRepository,
  InMemoryCalendarEventRepository,
} from '../../test/in-memory-calendar';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { CalendarPage } from './calendar-page';
import { localRangeToInterval } from './time-grid-selection';

const TUTOR: Session = { user: { id: 't', role: 'tutor', accessState: 'none' } };

const session = (id: string, userId: string, status: 'accepted' | 'pending' = 'accepted') => ({
  ...localRangeToInterval({ date: todayInBrussels(), startMinutes: 600, endMinutes: 660 }),
  id,
  userId,
  status,
  createdAt: '2026-01-01T00:00:00Z',
});

function setup(sessionRequests = new InMemorySessionRequestRepository({ seed: [] })) {
  const events = new InMemoryCalendarEventRepository({ seed: [] });
  return {
    events,
    ...renderWithServices(<CalendarPage />, {
      services: {
        ...createTestServices(),
        auth: new InMemoryAuthProvider(TUTOR),
        calendarEvents: events,
        blockedTime: new InMemoryBlockedTimeRepository(events),
        sessionRequests,
      },
    }),
  };
}

describe('tutor calendar: accepted sessions', () => {
  it('shows accepted sessions as read-only, non-striped blocks and ignores pending ones', async () => {
    const { container } = setup(
      new InMemorySessionRequestRepository({
        seed: [session('a', 'Alex'), session('p', 'Pending Pat', 'pending')],
      }),
    );
    const block = await screen.findByRole('button', { name: /^Accepted: Alex, / });
    expect(block).toHaveAttribute('aria-disabled', 'true');
    expect(block.className).not.toMatch(/anonymousBlocked/);
    expect(block.className).toMatch(/sessionBlock/);
    expect(screen.queryByText(/Pending Pat/)).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing is blocked this week.')).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('offers neither an edit dialog nor deletion for a session block', async () => {
    const { events } = setup(
      new InMemorySessionRequestRepository({ seed: [session('a', 'Alex')] }),
    );
    const block = await screen.findByRole('button', { name: /^Accepted: Alex, / });
    await userEvent.click(block);
    fireEvent.keyDown(block, { key: 'Delete' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Accepted/ })).not.toBeInTheDocument();
    const list = await events.listEvents({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    expect(list.ok && list.value).toEqual([]);
  });

  it('still lets the tutor add a manual event over an accepted session', async () => {
    const { events } = setup(
      new InMemorySessionRequestRepository({ seed: [session('a', 'Alex')] }),
    );
    await screen.findByRole('button', { name: /^Accepted: Alex, / });
    const today = (await screen.findAllByRole('gridcell', { name: /, 10:00/ }))[0] as HTMLElement;
    await userEvent.click(today);
    await userEvent.type(await screen.findByLabelText(/^Title/), 'Piano');
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('Event created.')).toBeInTheDocument();
    const list = await events.listEvents({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    expect(list.ok && list.value).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Accepted: Alex, / })).toBeInTheDocument();
    });
    expect(
      within(screen.getByRole('group', { name: 'Events' })).getAllByRole('button').length,
    ).toBe(2);
  });

  it('keeps the calendar working when sessions cannot be loaded', async () => {
    const repo = new InMemorySessionRequestRepository({ seed: [session('a', 'Alex')] });
    repo.listAccepted = () => Promise.resolve(err({ kind: 'unavailable', message: 'x' }));
    setup(repo);
    expect(await screen.findByText('Nothing is blocked this week.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Week view' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Accepted: / })).not.toBeInTheDocument();
  });
});
