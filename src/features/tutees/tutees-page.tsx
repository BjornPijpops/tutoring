import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useServices } from '../../app/services-context';
import {
  Button,
  Container,
  EmptyState,
  Field,
  FilterTabs,
  PageHeading,
  StatusAnnouncer,
  StatusBadge,
  StatusMessage,
  TextInput,
} from '../../shared/ui';
import {
  TUTEE_PAGE_DEFAULT,
  TUTEE_PAGE_MAX,
  TUTEE_SEARCH_MAX,
  type TuteeList,
  type TuteeStatus,
} from '../../core/domain/tutee';
import {
  FILTERS,
  LIST_MESSAGES,
  STATUS_LABEL,
  accessRequestCount,
  badgeStatus,
  listProgress,
  noMatchForSearch,
  sessionSummary,
} from './tutee-messages';
import { cooldownLine } from './tutee-view-model';
import styles from './tutees.module.css';

/** What the detail page hands back so the list reopens as the tutor left it. */
export interface TuteeListState {
  readonly status: TuteeStatus | 'all';
  readonly search: string;
  readonly loaded: number;
}

type Phase = 'loading' | 'ready' | 'error';
interface ListQueryState {
  readonly status: TuteeStatus | 'all';
  readonly search: string;
}
interface ListRequest {
  readonly query: ListQueryState;
  readonly mode: 'initial' | 'replace' | 'more' | 'retry';
  readonly offset: number;
  readonly limit: number;
  readonly seq: number;
}

function readState(value: unknown): TuteeListState {
  const raw = (value ?? {}) as Partial<TuteeListState>;
  const status = FILTERS.some((f) => f.value === raw.status) ? raw.status : 'all';
  const loaded =
    typeof raw.loaded === 'number' && raw.loaded > 0
      ? Math.min(raw.loaded, TUTEE_PAGE_MAX)
      : TUTEE_PAGE_DEFAULT;
  return {
    status: status ?? 'all',
    search: typeof raw.search === 'string' ? raw.search.slice(0, TUTEE_SEARCH_MAX) : '',
    loaded,
  };
}

/** The tutor's list of everyone who asked for access, with status filter and search. */
export function TuteesPage() {
  const { tutees } = useServices();
  const location = useLocation();
  const initial = useMemo(() => readState(location.state), [location.state]);

  const [applied, setApplied] = useState<{ status: TuteeStatus | 'all'; search: string }>({
    status: initial.status,
    search: initial.search,
  });
  const [draft, setDraft] = useState(initial.search);
  const [data, setData] = useState<TuteeList | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const alertRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<'alert' | 'retry' | null>(null);
  const [request, setRequest] = useState<ListRequest>({
    query: { status: initial.status, search: initial.search },
    mode: 'initial',
    offset: 0,
    limit: initial.loaded,
    seq: 0,
  });

  useEffect(() => {
    let active = true;
    const { query, mode, offset, limit } = request;
    void tutees
      .list({
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.search ? { search: query.search } : {}),
        limit,
        offset,
      })
      .then((result) => {
        if (!active) return;
        setBusy(false);
        if (!result.ok) {
          if (mode === 'more') setMoreError(true);
          else if (mode === 'replace') setSearchError(true);
          else {
            focusTarget.current = mode === 'retry' ? 'retry' : 'alert';
            setPhase('error');
          }
          return;
        }
        setMoreError(false);
        setSearchError(false);
        setPhase('ready');
        setData((previous) =>
          mode === 'more' && previous
            ? { ...result.value, items: [...previous.items, ...result.value.items] }
            : result.value,
        );
        const shown = offset + result.value.items.length;
        setAnnouncement(listProgress(shown, result.value.total));
      });
    return () => {
      active = false;
    };
  }, [tutees, request]);

  useEffect(() => {
    if (phase !== 'error') return;
    if (focusTarget.current === 'alert') alertRef.current?.focus();
    if (focusTarget.current === 'retry') alertRef.current?.querySelector('button')?.focus();
    focusTarget.current = null;
  }, [phase]);

  function go(
    query: ListQueryState,
    mode: ListRequest['mode'],
    offset = 0,
    limit = TUTEE_PAGE_DEFAULT,
  ) {
    setBusy(true);
    setRequest((previous) => ({ query, mode, offset, limit, seq: previous.seq + 1 }));
  }
  function apply(next: { status: TuteeStatus | 'all'; search: string }) {
    setApplied(next);
    go(next, 'replace');
  }

  function submitSearch(event: SyntheticEvent) {
    event.preventDefault();
    apply({ status: applied.status, search: draft.trim() });
  }

  function clearFilters() {
    setDraft('');
    apply({ status: 'all', search: '' });
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data !== null && items.length < total;
  const filtered = applied.status !== 'all' || applied.search !== '';
  const options = FILTERS.map((filter) => ({
    ...filter,
    ...(data ? { count: data.counts[filter.value] } : {}),
  }));
  const listState: TuteeListState = {
    status: applied.status,
    search: applied.search,
    loaded: Math.min(Math.max(items.length, TUTEE_PAGE_DEFAULT), TUTEE_PAGE_MAX),
  };
  const now = new Date();

  return (
    <Container>
      <PageHeading lead={LIST_MESSAGES.lead}>Tutees</PageHeading>
      <StatusAnnouncer message={announcement} />
      <div className={styles['toolbar']}>
        <form className={styles['searchRow']} role="search" onSubmit={submitSearch}>
          <Field label="Search tutees">
            {(props) => (
              <TextInput
                {...props}

                placeholder="Name or email"
                maxLength={TUTEE_SEARCH_MAX}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <FilterTabs
          label="Filter tutees"
          options={options}
          value={applied.status}
          onChange={(status) => {
            apply({ status, search: applied.search });
          }}
        />
      </div>

      <div className={styles['region']} aria-busy={busy || phase === 'loading'}>
        {phase === 'loading' ? (
          <StatusMessage status="info">{LIST_MESSAGES.loading}</StatusMessage>
        ) : null}

        {phase === 'error' ? (
          <div ref={alertRef} tabIndex={-1}>
            <StatusMessage status="error">{LIST_MESSAGES.loadError}</StatusMessage>
            <Button
              variant="secondary"
              onClick={() => {
                setPhase('loading');
                go(applied, 'retry', 0, request.limit);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {searchError ? (
          <StatusMessage status="error">{LIST_MESSAGES.searchError}</StatusMessage>
        ) : null}

        {phase === 'ready' && items.length === 0 ? (
          filtered ? (
            <EmptyState
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            >
              {applied.search ? noMatchForSearch(applied.search) : LIST_MESSAGES.filteredTitle}{' '}
              {LIST_MESSAGES.filteredHint}
            </EmptyState>
          ) : (
            <EmptyState>
              <strong>{LIST_MESSAGES.emptyTitle}</strong> {LIST_MESSAGES.emptyBody}
            </EmptyState>
          )
        ) : null}

        {items.length > 0 ? (
          <>
            <ul className={styles['list']} aria-label="Tutees">
              {items.map((tutee) => {
                const cooldown = cooldownLine(tutee, now);
                return (
                  <li key={tutee.userId} className={styles['card']}>
                    <Link
                      className={styles['cardLink']}
                      to={`/tutees/${tutee.userId}`}
                      state={listState}
                      aria-label={`${tutee.displayName}, ${STATUS_LABEL[tutee.status]}`}
                    >
                      <h2 className={styles['cardName']}>{tutee.displayName}</h2>
                      <span>
                        <StatusBadge status={badgeStatus(tutee.status)}>
                          {STATUS_LABEL[tutee.status]}
                        </StatusBadge>
                      </span>
                      <p className={styles['muted']}>{tutee.email}</p>
                      <p className={styles['fact']}>{accessRequestCount(tutee.requestCount)}</p>
                      {cooldown ? <p className={styles['muted']}>{cooldown}</p> : null}
                      <p className={styles['muted']}>
                        {sessionSummary(tutee.pendingSessions, tutee.acceptedFutureSessions)}
                      </p>
                      <span className={styles['view']}>View tutee</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {moreError ? (
              <StatusMessage status="error">{LIST_MESSAGES.loadMoreError}</StatusMessage>
            ) : null}
            {hasMore ? (
              <div className={styles['more']}>
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => {
                    go(applied, 'more', items.length);
                  }}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Container>
  );
}
