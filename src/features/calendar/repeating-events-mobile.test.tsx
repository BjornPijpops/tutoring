import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

vi.mock('../../shared/hooks/use-media-query', () => ({ useMediaQuery: () => false }));

const TUTOR: Session = { user: { id: 't', role: 'tutor', accessState: 'none' } };

describe('repeating events on mobile', () => {
  it('shows a Repeats line in the day list and a working scope step', async () => {
    const today = todayInBrussels();
    const rule: RecurrenceRule = {
      startDate: today,
      intervalWeeks: 1,
      weekdays: [weekdayOf(today) ?? 1],
      startMinutes: 600,
      endMinutes: 660,
      end: { kind: 'count', count: 3 },
    };
    const repo = new InMemoryCalendarEventRepository();
    await repo.addSeries({
      rule,
      title: 'Piano',
      occurrences: expandRecurrence(rule, today).occurrences,
    });
    const { container } = renderWithServices(<CalendarPage />, {
      services: {
        ...createTestServices(),
        auth: new InMemoryAuthProvider(TUTOR),
        calendarEvents: repo,
        blockedTime: new InMemoryBlockedTimeRepository(repo),
      },
    });
    const event = await screen.findByRole('button', { name: /^Piano/ });
    expect(within(event).getByText('Repeats')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Events this week' })).not.toBeInTheDocument();
    await userEvent.click(event);
    const dialog = await screen.findByRole('dialog', { name: 'Edit blocked time' });
    await within(dialog).findByText(/^Repeats: /);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    const scope = await screen.findByRole('dialog', { name: 'Delete repeating event' });
    expect(within(scope).getAllByRole('radio')).toHaveLength(3);
    await expectNoViolations(container);
  });
});
