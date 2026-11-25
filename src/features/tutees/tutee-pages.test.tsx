/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index elements they just rendered */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { TuteesPage } from './tutees-page';
import { TuteeDetailPage } from './tutee-detail-page';
import { InMemoryTuteeRepository } from '../../test/in-memory-tutee';
import type { TuteeSummary } from '../../core/domain/tutee';
import type { SessionRequest } from '../../core/domain/session-request';
import { err } from '../../core/domain/result';
import { createTestServices, renderWithServices } from '../../test/render-with-services';
import { expectNoViolations } from '../../test/axe';
import { CANCEL_ACCEPTED_LABEL, blockDialog, revokeDialog } from './tutee-messages';

const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

const base: TuteeSummary = {
  userId: 'u1',
  displayName: 'Alex Example',
  email: 'alex@example.test',
  status: 'approved',
  createdAt: '2026-01-01T10:00:00.000Z',
  requestedAt: '2026-01-01T10:00:00.000Z',
  decidedAt: '2026-01-01T10:05:00.000Z',
  nextRequestAt: null,
  requestCount: 1,
  pendingSessions: 0,
  acceptedFutureSessions: 0,
};
const tutee = (patch: Partial<TuteeSummary>): TuteeSummary => ({ ...base, ...patch });

const session = (
  id: string,
  status: SessionRequest['status'],
  startHours: number,
  userId = 'u1',
): SessionRequest => ({
  id,
  userId,
  status,
  startsAt: at(startHours),
  endsAt: at(startHours + 1),
  createdAt: at(-100),
});

function renderApp(repo: InMemoryTuteeRepository, route: string) {
  return renderWithServices(
    <Routes>
      <Route path="/tutees" element={<TuteesPage />} />
      <Route path="/tutees/:userId" element={<TuteeDetailPage />} />
    </Routes>,
    { route, services: { ...createTestServices(), tutees: repo } },
  );
}

const renderList = (repo: InMemoryTuteeRepository) => renderApp(repo, '/tutees');
const renderDetail = (repo: InMemoryTuteeRepository) => renderApp(repo, '/tutees/u1');

const detailRepo = (patch: Partial<TuteeSummary> = {}) =>
  new InMemoryTuteeRepository({
    seed: [tutee(patch)],
    now: () => new Date().toISOString(),
    sessions: [
      session('s-future', 'accepted', 72),
      session('s-pending', 'pending', 48),
      session('s-past', 'accepted', -48),
    ],
  });

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    tutee({
      userId: `m${String(i).padStart(3, '0')}`,
      displayName: `Person ${String(i).padStart(3, '0')}`,
      email: `p${String(i)}@example.test`,
      requestedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }),
  );

const announced = (text: string, exact = true) =>
  screen
    .getAllByRole('status')
    .some((s) => (exact ? s.textContent === text : s.textContent.includes(text)));

describe('tutees list page', () => {
  it('renders controls and the card without axe violations', async () => {
    const { container } = renderList(new InMemoryTuteeRepository({ seed: [base] }));
    expect(await screen.findByRole('heading', { name: 'Tutees' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search tutees' })).toHaveAttribute(
      'placeholder',
      'Name or email',
    );
    expect(await screen.findByRole('link', { name: 'Alex Example, Approved' })).toBeInTheDocument();
    expect(screen.getByText('View tutee')).toBeInTheDocument();
    expect(screen.getByText('1 access request')).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('marks the results region busy during the initial load and names the filter group', async () => {
    const { container } = renderList(new InMemoryTuteeRepository({ seed: [base] }));
    const region = container.querySelector('[aria-busy]');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('group', { name: 'Filter tutees' })).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Alex Example, Approved' });
    expect(region).toHaveAttribute('aria-busy', 'false');
  });

  it('shows the empty state without a clear button', async () => {
    renderList(new InMemoryTuteeRepository());
    expect(await screen.findByText('No tutees yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('shows counts on the chips and filters by status with aria-pressed', async () => {
    const user = userEvent.setup();
    renderList(
      new InMemoryTuteeRepository({
        seed: [
          base,
          tutee({ userId: 'u2', displayName: 'Blake', status: 'blocked' }),
          tutee({ userId: 'u3', displayName: 'Casey', status: 'pending' }),
        ],
      }),
    );
    await screen.findByText('Alex Example');
    expect(screen.getByRole('button', { name: 'All (3)', pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Blocked (1)' }));
    await waitFor(() => {
      expect(screen.queryByText('Alex Example')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Blocked (1)', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (3)', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blake, Blocked' })).toBeInTheDocument();
  });

  it('searches, reports no match, and clears filters', async () => {
    const user = userEvent.setup();
    renderList(new InMemoryTuteeRepository({ seed: [base] }));
    await screen.findByText('Alex Example');
    await user.type(screen.getByRole('textbox', { name: 'Search tutees' }), 'zzz{Enter}');
    expect(await screen.findByText(/No tutees match “zzz”\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Alex Example')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search tutees' })).toHaveValue('');
  });

  it('announces progress and loads more rows', async () => {
    const user = userEvent.setup();
    renderList(new InMemoryTuteeRepository({ seed: many(60) }));
    await screen.findByText('Person 059');
    expect(announced('Showing 50 of 60 tutees.')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(screen.getAllByRole('link')).toHaveLength(60);
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('keeps the rows and says so when loading more fails', async () => {
    const user = userEvent.setup();
    const repo = new InMemoryTuteeRepository({ seed: many(60) });
    renderList(repo);
    await screen.findByText('Person 059');
    vi.spyOn(repo, 'list').mockResolvedValueOnce(err({ kind: 'unavailable', message: 'down' }));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load more tutees");
    expect(screen.getByText('Person 049')).toBeInTheDocument();
  });

  it('shows an error with retry and focuses it, then recovers', async () => {
    const user = userEvent.setup();
    const repo = new InMemoryTuteeRepository({ seed: [base] });
    vi.spyOn(repo, 'list').mockResolvedValueOnce(err({ kind: 'unavailable', message: 'down' }));
    renderList(repo);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load tutees");
    await waitFor(() => {
      expect(alert.parentElement).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alex Example')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps previous results when a search fails', async () => {
    const user = userEvent.setup();
    const repo = new InMemoryTuteeRepository({ seed: [base] });
    renderList(repo);
    await screen.findByText('Alex Example');
    vi.spyOn(repo, 'list').mockResolvedValueOnce(err({ kind: 'unavailable', message: 'down' }));
    await user.type(screen.getByRole('textbox', { name: 'Search tutees' }), 'x{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('previous results are still shown');
    expect(screen.getByText('Alex Example')).toBeInTheDocument();
  });

  it('shows the cooldown line and the session summary on cards', async () => {
    renderList(
      new InMemoryTuteeRepository({
        seed: [tutee({ status: 'denied', nextRequestAt: '2099-01-01T10:00:00.000Z' })],
        sessions: [session('a', 'pending', 5), session('b', 'accepted', 9)],
      }),
    );
    expect(await screen.findByText(/Can ask again after/)).toBeInTheDocument();
    expect(
      screen.getByText('1 pending session requests · 1 accepted future sessions'),
    ).toBeInTheDocument();
  });

  it('restores filter and rows when coming back from a detail page', async () => {
    const user = userEvent.setup();
    renderList(
      new InMemoryTuteeRepository({
        seed: [base, tutee({ userId: 'u2', displayName: 'Blake', status: 'blocked' })],
      }),
    );
    await screen.findByText('Alex Example');
    await user.click(screen.getByRole('button', { name: 'Blocked (1)' }));
    await user.click(await screen.findByRole('link', { name: 'Blake, Blocked' }));
    await screen.findByRole('heading', { name: 'Blake' });
    await user.click(screen.getByRole('link', { name: 'Back to Tutees' }));
    expect(await screen.findByRole('link', { name: 'Blake, Blocked' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blocked (1)', pressed: true })).toBeInTheDocument();
    expect(screen.queryByText('Alex Example')).not.toBeInTheDocument();
  });

  it('stacks cards as a list on a 320px screen without violations', async () => {
    window.innerWidth = 320;
    const { container } = renderList(new InMemoryTuteeRepository({ seed: [base] }));
    const link = await screen.findByRole('link', { name: 'Alex Example, Approved' });
    expect(link.closest('li')).toBeInTheDocument();
    expect(container.querySelectorAll('table')).toHaveLength(0);
    await expectNoViolations(container);
  });
});

describe('tutee detail page', () => {
  it('renders facts, sessions and history without axe violations', async () => {
    const { container } = renderDetail(detailRepo({ decidedAt: null }));
    expect(await screen.findByRole('heading', { name: 'Alex Example' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Access actions' })).toBeInTheDocument();
    expect(screen.getByText('Not decided yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Cancel session on/ })).toHaveLength(2);
    expect(screen.getByText('Past')).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it.each<[Partial<TuteeSummary>, string[]]>([
    [{ status: 'pending' }, ['Approve', 'Deny', 'Block']],
    [
      { status: 'denied', nextRequestAt: '2099-01-01T00:00:00.000Z' },
      ['Approve', 'Block', 'Allow to ask again now'],
    ],
    [{ status: 'revoked' }, ['Restore access', 'Block']],
    [{ status: 'blocked' }, ['Unblock']],
  ])('offers the right actions for %o', async (patch, labels) => {
    renderDetail(detailRepo(patch));
    await screen.findByRole('heading', { name: 'Alex Example' });
    const region = screen.getByRole('region', { name: 'Access actions' });
    const names = within(region)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect([...names].sort()).toEqual([...labels].sort());
  });

  it('says a revoked tutee whose cooldown is over can ask again now', async () => {
    renderDetail(detailRepo({ status: 'revoked' }));
    await screen.findByRole('heading', { name: 'Alex Example' });
    expect(screen.getAllByText('Can ask again now').length).toBeGreaterThan(0);
  });

  it('approves a pending tutee and announces it', async () => {
    const user = userEvent.setup();
    renderDetail(detailRepo({ status: 'pending' }));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(announced('Alex Example was approved.')).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeInTheDocument();
  });

  it('lets a denied tutee ask again and announces that access is not granted', async () => {
    const user = userEvent.setup();
    renderDetail(detailRepo({ status: 'denied', nextRequestAt: '2099-01-01T00:00:00.000Z' }));
    await user.click(await screen.findByRole('button', { name: 'Allow to ask again now' }));
    await waitFor(() => {
      expect(announced('Access is not granted', false)).toBe(true);
    });
    expect(
      screen.queryByRole('button', { name: 'Allow to ask again now' }),
    ).not.toBeInTheDocument();
  });

  it('shows an error beside the action when it fails', async () => {
    const user = userEvent.setup();
    const repo = detailRepo({ status: 'pending' });
    renderDetail(repo);
    const button = await screen.findByRole('button', { name: 'Approve' });
    vi.spyOn(repo, 'act').mockResolvedValueOnce(err({ kind: 'unavailable', message: 'down' }));
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't update access");
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('refreshes and announces a stale change on conflict', async () => {
    const user = userEvent.setup();
    const repo = detailRepo({ status: 'pending' });
    renderDetail(repo);
    const button = await screen.findByRole('button', { name: 'Approve' });
    vi.spyOn(repo, 'act').mockResolvedValueOnce(
      err({ kind: 'conflict', code: 'state_conflict', message: 'changed' }),
    );
    await user.click(button);
    await waitFor(() => {
      expect(announced('changed elsewhere', false)).toBe(true);
    });
  });

  it('shows not-found for a missing tutee', async () => {
    renderWithServices(
      <Routes>
        <Route path="/tutees/:userId" element={<TuteeDetailPage />} />
      </Routes>,
      {
        route: '/tutees/nobody',
        services: { ...createTestServices(), tutees: new InMemoryTuteeRepository() },
      },
    );
    expect(await screen.findByText(/This tutee was not found/)).toBeInTheDocument();
  });

  it('shows a load error with retry', async () => {
    const user = userEvent.setup();
    const repo = detailRepo();
    vi.spyOn(repo, 'get').mockResolvedValueOnce(err({ kind: 'unavailable', message: 'down' }));
    renderDetail(repo);
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load this tutee");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Alex Example' })).toBeInTheDocument();
  });

  it('cancels a session through its dialog', async () => {
    const user = userEvent.setup();
    const { container } = renderDetail(detailRepo());
    await screen.findByRole('heading', { name: 'Alex Example' });
    await user.click(screen.getAllByRole('button', { name: /^Cancel session on/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this session?' });
    expect(within(dialog).getByRole('button', { name: 'Keep session' })).toHaveFocus();
    await expectNoViolations(container);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel session' }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Cancel session on/ })).toHaveLength(1);
    });
    expect(announced('The session was cancelled and the time is available again.')).toBe(true);
  });
});

describe('revoke and block dialogs', () => {
  it('opens the revoke dialog with exact copy, unchecked checkbox, safe focus and no violations', async () => {
    const user = userEvent.setup();
    const { container } = renderDetail(detailRepo());
    await user.click(await screen.findByRole('button', { name: 'Revoke access' }));
    const copy = revokeDialog('Alex Example');
    const dialog = await screen.findByRole('dialog', { name: copy.title });
    expect(within(dialog).getByText(copy.body)).toBeInTheDocument();
    const box = within(dialog).getByRole('checkbox', { name: CANCEL_ACCEPTED_LABEL });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(copy.help);
    expect(within(dialog).getByRole('button', { name: 'Keep access' })).toHaveFocus();
    await expectNoViolations(container);
  });

  it('opens the block dialog with its own copy', async () => {
    const user = userEvent.setup();
    const { container } = renderDetail(detailRepo());
    await user.click(await screen.findByRole('button', { name: 'Block' }));
    const copy = blockDialog('Alex Example');
    const dialog = await screen.findByRole('dialog', { name: copy.title });
    expect(within(dialog).getByText(copy.body)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Block tutee' })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('closes on Escape and returns focus to the opener, changing nothing', async () => {
    const user = userEvent.setup();
    const repo = detailRepo();
    const act = vi.spyOn(repo, 'act');
    renderDetail(repo);
    const opener = await screen.findByRole('button', { name: 'Revoke access' });
    await user.click(opener);
    await screen.findByRole('dialog');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
    expect(act).not.toHaveBeenCalled();
  });

  it('revokes keeping accepted sessions by default', async () => {
    const user = userEvent.setup();
    const repo = detailRepo();
    const act = vi.spyOn(repo, 'act');
    renderDetail(repo);
    await user.click(await screen.findByRole('button', { name: 'Revoke access' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => {
      expect(act).toHaveBeenCalledWith('u1', 'revoke', 'keep');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        announced('Access for Alex Example was revoked. Pending session requests were declined.'),
      ).toBe(true);
    });
    expect(screen.getByRole('heading', { name: 'Alex Example' })).toHaveFocus();
  });

  it('revokes and cancels accepted sessions when the checkbox is ticked, with counts', async () => {
    const user = userEvent.setup();
    const repo = detailRepo();
    const act = vi.spyOn(repo, 'act');
    renderDetail(repo);
    await user.click(await screen.findByRole('button', { name: 'Revoke access' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: CANCEL_ACCEPTED_LABEL }));
    await user.click(within(dialog).getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => {
      expect(act).toHaveBeenCalledWith('u1', 'revoke', 'cancel_all');
    });
    await waitFor(() => {
      expect(announced('1 accepted future sessions were cancelled.', false)).toBe(true);
    });
  });

  it('blocks and cancels accepted sessions', async () => {
    const user = userEvent.setup();
    const repo = detailRepo();
    const act = vi.spyOn(repo, 'act');
    renderDetail(repo);
    await user.click(await screen.findByRole('button', { name: 'Block' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: CANCEL_ACCEPTED_LABEL }));
    await user.click(within(dialog).getByRole('button', { name: 'Block tutee' }));
    await waitFor(() => {
      expect(act).toHaveBeenCalledWith('u1', 'block', 'cancel_all');
    });
    expect(await screen.findByRole('button', { name: 'Unblock' })).toBeInTheDocument();
    expect(announced('Alex Example was blocked.', false)).toBe(true);
  });

  it('resets the checkbox each time the dialog opens', async () => {
    const user = userEvent.setup();
    renderDetail(detailRepo());
    await user.click(await screen.findByRole('button', { name: 'Revoke access' }));
    await user.click(await screen.findByRole('checkbox', { name: CANCEL_ACCEPTED_LABEL }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Revoke access' }));
    expect(await screen.findByRole('checkbox', { name: CANCEL_ACCEPTED_LABEL })).not.toBeChecked();
  });

  it('keeps the dialog open with an error when revoking fails', async () => {
    const user = userEvent.setup();
    const repo = detailRepo();
    renderDetail(repo);
    await user.click(await screen.findByRole('button', { name: 'Revoke access' }));
    const dialog = await screen.findByRole('dialog');
    vi.spyOn(repo, 'act').mockResolvedValueOnce(err({ kind: 'unavailable', message: 'down' }));
    await user.click(within(dialog).getByRole('button', { name: 'Revoke access' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "We couldn't revoke access. Try again.",
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Revoke access' })).toBeEnabled();
    });
  });

  it('refreshes and closes the dialog on a stale conflict', async () => {
    const user = userEvent.setup();
    const repo = detailRepo();
    renderDetail(repo);
    await user.click(await screen.findByRole('button', { name: 'Block' }));
    const dialog = await screen.findByRole('dialog');
    vi.spyOn(repo, 'act').mockResolvedValueOnce(
      err({ kind: 'conflict', code: 'state_conflict', message: 'changed' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Block tutee' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(announced('changed elsewhere', false)).toBe(true);
  });
});
