import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../core/domain/calendar-event';
import { todayInBrussels } from '../../shared/dates/brussels';
import { expectNoViolations } from '../../test/axe';
import {
  InMemoryBlockedTimeRepository,
  InMemoryCalendarEventRepository,
} from '../../test/in-memory-calendar';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { AvailabilityPage } from './availability-page';
import { localRangeToInterval } from './time-grid-selection';

vi.mock('../../shared/hooks/use-media-query', () => ({ useMediaQuery: () => false }));

function blockedAt(startMinutes: number, endMinutes: number): CalendarEvent {
  const range = localRangeToInterval({ date: todayInBrussels(), startMinutes, endMinutes });
  return { id: 'e1', title: 'Secret dentist', source: 'manual', ...range };
}

function setup(events: readonly CalendarEvent[]) {
  const repo = new InMemoryCalendarEventRepository({ seed: events });
  return renderWithServices(<AvailabilityPage />, {
    services: { ...createTestServices(), blockedTime: new InMemoryBlockedTimeRepository(repo) },
  });
}

describe('availability on mobile (one-day list)', () => {
  it('renders the day list with native full-width actions instead of the week grid', async () => {
    const { container } = setup([]);
    expect(await screen.findByRole('button', { name: 'Next day' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /, 08:00/ }).length).toBeGreaterThan(0);
    await expectNoViolations(container);
  });

  it('selects a free hour with one tap and opens the confirmation without saving', async () => {
    setup([]);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /, 09:00/ }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Request this tutoring time?' });
    expect(dialog).toHaveTextContent('09:00');
    expect(dialog).toHaveTextContent('10:00');
    expect(dialog).toHaveTextContent('1 hour');
    expect(within(dialog).getByRole('button', { name: 'Send request' })).toBeEnabled();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shrinks a tap to 30 minutes when the next interval is blocked', async () => {
    setup([blockedAt(660, 720)]);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /, 10:30/ }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Request this tutoring time?' });
    expect(dialog).toHaveTextContent('10:30');
    expect(dialog).toHaveTextContent('11:00');
    expect(dialog).toHaveTextContent('30 minutes');
  });

  it('shows blocked intervals anonymously and offers no action on them', async () => {
    const { container } = setup([blockedAt(660, 720)]);
    const blocked = await screen.findAllByRole('button', { name: /^Not available/ });
    expect(blocked[0]).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(blocked[0] as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('Secret dentist');
  });
});
