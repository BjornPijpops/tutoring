import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { addDays } from '../../core/domain/local-time';
import { err, ok } from '../../core/domain/result';
import type { SessionRequestRepository } from '../../core/ports/session-request-repository';
import { todayInBrussels } from '../../shared/dates/brussels';
import { expectNoViolations } from '../../test/axe';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { AvailabilityPage } from './availability-page';
import { localRangeToInterval } from './time-grid-selection';
import type { LocalTimeRange } from './time-grid-model';

let pick: LocalTimeRange;
vi.mock('./selectable-time-grid', () => ({
  SelectableTimeGrid: ({ onSelect }: { onSelect: (range: LocalTimeRange) => void }) => (
    <button
      type="button"
      onClick={() => {
        onSelect(pick);
      }}
    >
      Pick range
    </button>
  ),
}));

const range = (startMinutes: number, endMinutes: number, days = 3): LocalTimeRange => ({
  date: addDays(todayInBrussels(), days),
  startMinutes,
  endMinutes,
});

function setup(create: SessionRequestRepository['create']) {
  const services = createTestServices();
  const sessionRequests = {
    ...services.sessionRequests,
    create,
    listMine: () => Promise.resolve(ok([])),
  } as unknown as SessionRequestRepository;
  return renderWithServices(<AvailabilityPage />, { services: { ...services, sessionRequests } });
}

describe('AvailabilityPage request flow', () => {
  it('confirms in a dialog, does not save on selection, and sends once confirmed', async () => {
    pick = range(600, 690);
    const create = vi.fn(() => Promise.resolve(ok({ id: 'x' }))) as never;
    setup(create);
    await userEvent.click(await screen.findByRole('button', { name: 'Pick range' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request this tutoring time?' });
    expect(create).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('10:00');
    expect(dialog).toHaveTextContent('11:30');
    expect(dialog).toHaveTextContent('1 hour 30 minutes');
    expect(dialog).toHaveTextContent('Your tutor must accept this request');
    await expectNoViolations(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await screen.findByText('Request sent. It is pending tutor approval.');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('go back closes without saving', async () => {
    pick = range(600, 690);
    const create = vi.fn() as never;
    setup(create);
    await userEvent.click(await screen.findByRole('button', { name: 'Pick range' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows a client validation error for a too-short range without calling the server', async () => {
    pick = range(600, 615);
    const create = vi.fn() as never;
    setup(create);
    await userEvent.click(await screen.findByRole('button', { name: 'Pick range' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/at least 30 minutes/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects requests under 24 hours notice on the client', async () => {
    pick = range(600, 690, 0);
    setup(vi.fn() as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Pick range' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/at least 24 hours/)).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the server error', async () => {
    pick = range(600, 690);
    setup((() =>
      Promise.resolve(
        err({ kind: 'conflict', message: 'That time is no longer available.' }),
      )) as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Pick range' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('That time is no longer available.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('rejects a selection across a blocked interval without opening the dialog or saving', async () => {
    pick = range(600, 720);
    const create = vi.fn() as never;
    const services = createTestServices();
    const day = addDays(todayInBrussels(), 3);
    const blocked = localRangeToInterval({ date: day, startMinutes: 660, endMinutes: 690 });
    const sessionRequests = {
      ...services.sessionRequests,
      create,
      listMine: () => Promise.resolve(ok([])),
    } as unknown as SessionRequestRepository;
    const blockedTime = {
      ...services.blockedTime,
      listBlockedIntervals: () => Promise.resolve(ok([blocked])),
    } as unknown as typeof services.blockedTime;
    renderWithServices(<AvailabilityPage />, {
      services: { ...services, sessionRequests, blockedTime },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Pick range' }));
    expect(
      await screen.findByText('This time is no longer available. Choose another time.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    pick = range(540, 660);
    await userEvent.click(screen.getByRole('button', { name: 'Pick range' }));
    expect(
      await screen.findByRole('dialog', { name: 'Request this tutoring time?' }),
    ).toBeVisible();
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  });

  it('also rejects a selection over the callers own accepted session', async () => {
    pick = range(600, 660);
    const services = createTestServices();
    const day = addDays(todayInBrussels(), 3);
    const accepted = {
      ...localRangeToInterval({ date: day, startMinutes: 630, endMinutes: 720 }),
      id: 'a',
      userId: 'me',
      status: 'accepted' as const,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const sessionRequests = {
      ...services.sessionRequests,
      listMine: () => Promise.resolve(ok([accepted])),
    } as unknown as SessionRequestRepository;
    renderWithServices(<AvailabilityPage />, { services: { ...services, sessionRequests } });
    await userEvent.click(await screen.findByRole('button', { name: 'Pick range' }));
    expect(await screen.findByText(/no longer available/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error with retry when availability cannot load', async () => {
    const services = createTestServices();
    const blockedTime = {
      ...services.blockedTime,
      listBlockedIntervals: () => Promise.resolve(err({ kind: 'unavailable', message: 'x' })),
    } as unknown as typeof services.blockedTime;
    const { container } = renderWithServices(<AvailabilityPage />, {
      services: { ...services, blockedTime },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load availability/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await expectNoViolations(container);
  });
});
