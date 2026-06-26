import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { DirectoryApiResponse, DirectoryEntry } from '../directory/directoryData.js';
import {
  addClientTarget,
  getClientTargets,
  getOfficeRecommendations,
  refreshOfficeRecommendations,
  removeClientTarget,
  type ClientTarget,
  type OfficeRecommendationsResult,
} from './targets-api.js';

/**
 * Client Targets tab. Search the congressional directory to add target offices
 * for a client; a "Suggested by Meri" sidebar ranks offices via the Office
 * Recommender (committee jurisdiction + issue overlap + facility geography).
 *
 * Targets are firm-wide per client. Add/remove are optimistic with rollback.
 *
 * The Meri recommendations are EXPENSIVE to compute, so the server persists them
 * (computed lazily on the first view) and serves the cache thereafter — this tab
 * reads the dedicated /target-recommendations endpoint rather than waiting on the
 * full profile-v1 aggregate, and offers a manual "Refresh" to recompute.
 */

interface MeriSuggestion {
  memberId: string;
  office: string;
  party: 'R' | 'D' | 'I' | null;
  state: string | null;
  chamber: 'House' | 'Senate' | null;
  committee: string | null;
  score: number;
  billCount: number;
}

interface Props {
  clientId: string;
  /** Whether the user can mutate targets (read-only clients hide add/remove). */
  canManage: boolean;
  /** Navigate to the Intelligence tab (Relationships section). */
  onViewIntelligence?: () => void;
}

const partyColor = (p: string | null | undefined): string =>
  p === 'R' ? '#b91c1c' : p === 'D' ? '#1d4ed8' : '#374151';
const partyBg = (p: string | null | undefined): string =>
  p === 'R' ? '#fee2e2' : p === 'D' ? '#dbeafe' : '#f3f4f6';

/** "Sen." for Senate, "Rep." otherwise. */
const titleFor = (chamber: string | null | undefined): string =>
  chamber === 'Senate' ? 'Sen.' : 'Rep.';

/** Last name from "Sen. Cornyn, John" / "Cornyn, John". */
export function lastNameOf(name: string): string {
  const head = name.includes(', ') ? name.split(', ')[0]! : name;
  return head.split(' ').pop() ?? head;
}

/** Compact "updated X ago" label for the recommendations timestamp. */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function TargetsTab({ clientId, canManage, onViewIntelligence }: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Debounced search term — the directory search fires off this, not the raw
  // input, so typing a name doesn't kick off a request on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const targetsQuery = useQuery<ClientTarget[]>({
    queryKey: ['client-targets', clientId],
    queryFn: async () => getClientTargets(api, clientId),
  });
  const targets = targetsQuery.data ?? [];

  // Persisted Meri recommendations. The GET computes-and-stores on the first
  // view (a few seconds) and is instant thereafter; staleTime keeps re-entry to
  // the tab from re-fetching needlessly.
  const recsQuery = useQuery<OfficeRecommendationsResult>({
    queryKey: ['client-target-recommendations', clientId],
    queryFn: async () => getOfficeRecommendations(api, clientId),
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => refreshOfficeRecommendations(api, clientId),
    onMutate: async () => {
      // Cancel any in-flight background GET refetch so its (older) response can't
      // land after — and clobber — the freshly recomputed result.
      await qc.cancelQueries({ queryKey: ['client-target-recommendations', clientId] });
    },
    onSuccess: (data) => {
      qc.setQueryData(['client-target-recommendations', clientId], data);
    },
    onError: () => message.error('Could not refresh recommendations. Please try again.'),
  });

  const meriSuggestions = useMemo<MeriSuggestion[]>(
    () =>
      (recsQuery.data?.recommendations ?? [])
        // Only member-identified rows can be added as targets.
        .filter((r) => typeof r?.memberId === 'string' && r.memberId.length > 0)
        .slice(0, 6)
        .map((r) => ({
          memberId: r.memberId,
          office: String(r.office ?? ''),
          party: r.party ?? null,
          state: r.state ?? null,
          chamber: r.chamber ?? null,
          committee: r.committee ?? null,
          score: Number(r.score ?? 0),
          billCount: Number(r.billCount ?? 0),
        })),
    [recsQuery.data],
  );

  const addedIds = useMemo(() => new Set(targets.map((t) => t.memberId)), [targets]);
  const meriIds = useMemo(() => new Set(meriSuggestions.map((m) => m.memberId)), [meriSuggestions]);

  const search = useQuery<DirectoryApiResponse>({
    queryKey: ['targets-directory-search', debouncedQuery],
    enabled: debouncedQuery.length > 0,
    queryFn: async () =>
      (
        await api.get<DirectoryApiResponse>('/api/directory/contacts', {
          params: { q: debouncedQuery, pageSize: 25, sort: 'name-asc' },
        })
      ).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['client-targets', clientId] });
    // Portfolio card pills read the same targets list.
    qc.invalidateQueries({ queryKey: ['clients'] });
  };

  const addMutation = useMutation({
    mutationFn: async (v: { memberId: string; source: 'manual' | 'meri' }) =>
      addClientTarget(api, clientId, v.memberId, v.source),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['client-targets', clientId] });
      const prev = qc.getQueryData<ClientTarget[]>(['client-targets', clientId]);
      // Optimistic insert with a synthetic row; reconciled on settle.
      const optimistic: ClientTarget = {
        id: `optimistic-${v.memberId}`,
        clientId,
        memberId: v.memberId,
        memberName: null,
        party: null,
        state: null,
        chamber: null,
        committee: null,
        source: v.source,
        addedByUserId: null,
        addedAt: new Date().toISOString(),
      };
      qc.setQueryData<ClientTarget[]>(['client-targets', clientId], [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['client-targets', clientId], ctx.prev);
      message.error('Could not add target. Please try again.');
    },
    onSettled: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => removeClientTarget(api, clientId, memberId),
    onMutate: async (memberId) => {
      await qc.cancelQueries({ queryKey: ['client-targets', clientId] });
      const prev = qc.getQueryData<ClientTarget[]>(['client-targets', clientId]);
      qc.setQueryData<ClientTarget[]>(
        ['client-targets', clientId],
        (prev ?? []).filter((t) => t.memberId !== memberId),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['client-targets', clientId], ctx.prev);
      message.error('Could not remove target. Please try again.');
    },
    onSettled: invalidate,
  });

  const add = (memberId: string, source: 'manual' | 'meri') => {
    if (!canManage || addedIds.has(memberId)) return;
    addMutation.mutate({ memberId, source });
  };
  const remove = (memberId: string) => {
    if (!canManage) return;
    removeMutation.mutate(memberId);
  };

  const trimmed = query.trim();
  // True while the input is ahead of the last completed search (debounce pending
  // or request in flight) — drives the "Searching…" label.
  const searching = search.isFetching || trimmed !== debouncedQuery;
  // Don't render rows while a new search is pending: search.data still holds the
  // PREVIOUS query's results during the debounce window, which would otherwise
  // show stale offices under the "Searching…" header.
  const hits: DirectoryEntry[] =
    trimmed && searchOpen && !searching ? (search.data?.contacts ?? []) : [];

  const recsLoading = recsQuery.isLoading;
  const recsError = recsQuery.isError;
  const refreshing = refreshMutation.isPending;
  const computedAt = recsQuery.data?.computedAt ?? null;

  return (
    // Clicking anywhere outside the search wrap dismisses the results dropdown
    // (the wrap itself stops propagation, so inside-clicks are preserved).
    <div className="tg-layout" onClick={() => setSearchOpen(false)}>
      {/* Main column */}
      <div className="tg-main">
        <div className="help-box">
          <span className="help-ico" aria-hidden="true">
            ⓘ
          </span>
          <span className="help-txt">
            Search the congressional directory to add target offices for this client. Targets appear
            on the portfolio card and help your team track outreach priorities at a glance.
          </span>
        </div>

        {canManage ? (
          <div className="srch-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="srch-lbl">Search Congressional Directory</div>
            <div className="srch-row">
              <span className="srch-ico" aria-hidden="true">
                🔍
              </span>
              <input
                type="text"
                className="srch-inp"
                placeholder="Search by member, staffer, state, committee, or party…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
              />
              {query ? (
                <button
                  className="srch-x"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    setSearchOpen(false);
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>

            {trimmed && searchOpen ? (
              <div className="results-drop">
                <div className="res-count">
                  {searching
                    ? 'Searching…'
                    : hits.length === 0
                      ? `No results for "${trimmed}"`
                      : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
                </div>
                {hits.map((m) => {
                  const added = addedIds.has(m.id);
                  const isMeri = meriIds.has(m.id);
                  const stateLabel = m.chamber === 'House' && m.district ? m.district : m.state;
                  const staffMatch = m.matchedStaff?.[0];
                  return (
                    <div className="res-row" key={m.id}>
                      <div
                        className={`party-dot ${m.party}`}
                        style={{ background: partyBg(m.party), color: partyColor(m.party) }}
                      >
                        {m.party}
                      </div>
                      <div className="res-info">
                        <div className="res-name">{m.fullName}</div>
                        <div className="res-sub">
                          <span
                            className={`res-pty ${m.party}`}
                            style={{ color: partyColor(m.party) }}
                          >
                            [{m.party}-{stateLabel}]
                          </span>
                          {m.committees?.[0] ? <span>· {m.committees[0]}</span> : null}
                          {isMeri ? <span className="meri-chip">⊙ Meri pick</span> : null}
                        </div>
                        {staffMatch ? (
                          <div className="res-staff-match">
                            ↳ matched staffer: {staffMatch.fullName}
                            {staffMatch.title ? ` · ${staffMatch.title}` : ''}
                            {m.matchedStaff && m.matchedStaff.length > 1
                              ? ` +${m.matchedStaff.length - 1} more`
                              : ''}
                          </div>
                        ) : null}
                      </div>
                      <div>
                        {added ? (
                          <button className="btn-mini added">✓ Added</button>
                        ) : (
                          <button
                            className="btn-mini add"
                            onClick={() => {
                              add(m.id, 'manual');
                              // Close the dropdown so it stops floating over the
                              // target list once a selection is made.
                              setSearchOpen(false);
                            }}
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <div className="tgh">
            <div className="tgh-title">
              My Target Offices
              <span className="cnt-bdg">{targets.length}</span>
            </div>
          </div>

          {targets.length === 0 ? (
            <div className="tgt-empty">
              <div className="te-ico" aria-hidden="true">
                🎯
              </div>
              <div className="te-title">No targets added yet</div>
              <div className="te-desc">
                Search the congressional directory above to add target offices for this client.
              </div>
            </div>
          ) : (
            <div className="tgt-list">
              {targets.map((t) => {
                const isMeri = meriIds.has(t.memberId);
                const name = t.memberName ?? t.memberId;
                return (
                  <div className="tgt-row" key={t.memberId}>
                    <div
                      className={`tgt-badge ${t.party}`}
                      style={{ background: partyBg(t.party), color: partyColor(t.party) }}
                    >
                      {t.party ?? '·'}
                    </div>
                    <div className="tgt-info">
                      <div className="tgt-name">
                        {name}{' '}
                        {t.party || t.state ? (
                          <span
                            style={{ fontSize: 12, fontWeight: 400, color: partyColor(t.party) }}
                          >
                            [{t.party}-{t.state}]
                          </span>
                        ) : null}
                      </div>
                      <div className="tgt-meta">
                        <span className="tgt-cmte">
                          {[t.chamber, t.committee].filter(Boolean).join(' · ') || '—'}
                        </span>
                        {isMeri ? <span className="tgt-meri">⊙ Meri pick</span> : null}
                      </div>
                    </div>
                    {canManage ? (
                      <button className="tgt-rm" onClick={() => remove(t.memberId)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Meri sidebar */}
      <div className="tg-side">
        <div className="meri-panel">
          <div className="mp-hd">
            <div className="mp-title">
              <div className="mp-m">M</div> Suggested by Meri
            </div>
            {canManage ? (
              <button
                className="mp-refresh"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshing || recsLoading}
                title="Recompute recommendations from the latest tracked bills and facilities"
              >
                {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
              </button>
            ) : (
              <span className="mp-sub">top 6 · weighted score</span>
            )}
          </div>
          <div className="mp-desc">
            Ranked by committee jurisdiction over tracked bills, with issue overlap and
            facility-district nexus layered in when available.
          </div>
          {computedAt && !recsLoading ? (
            <div className="mp-updated">Updated {relativeTime(computedAt)}</div>
          ) : null}

          {recsLoading ? (
            <div className="mp-empty" style={{ padding: '16px', fontSize: 12, color: '#9ca3af' }}>
              Computing recommendations… this runs once, then it&apos;s saved for instant loads.
            </div>
          ) : recsError ? (
            <div className="mp-empty" style={{ padding: '16px', fontSize: 12, color: '#9ca3af' }}>
              Couldn&apos;t load recommendations.{' '}
              {canManage ? (
                <button className="mp-inline-link" onClick={() => refreshMutation.mutate()}>
                  Try again
                </button>
              ) : null}
            </div>
          ) : meriSuggestions.length === 0 ? (
            <div className="mp-empty" style={{ padding: '16px', fontSize: 12, color: '#9ca3af' }}>
              No Meri suggestions yet. Confirm this client&apos;s LDA match and add tracked bills in
              the Intelligence tab, then Refresh to get recommendations.
            </div>
          ) : (
            meriSuggestions.map((m, idx) => {
              const added = addedIds.has(m.memberId);
              return (
                <div className="mp-row" key={m.memberId}>
                  <div className="mp-rank">{idx + 1}</div>
                  <div className="mp-info">
                    <div className="mp-name">{m.office}</div>
                    <div className="mp-pty">
                      <span style={{ color: partyColor(m.party), fontWeight: 600 }}>
                        [{m.party}-{m.state}]
                      </span>
                    </div>
                    <div className="mp-bills">
                      {m.billCount} tracked bill{m.billCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="mp-right">
                    <span className="mp-score">{m.score.toFixed(2)}</span>
                    {added ? (
                      <button
                        className="btn-mini added"
                        style={{ fontSize: 11, padding: '3px 7px' }}
                      >
                        ✓ Added
                      </button>
                    ) : canManage ? (
                      <button
                        className="btn-mini add"
                        style={{ fontSize: 11, padding: '3px 7px' }}
                        onClick={() => add(m.memberId, 'meri')}
                      >
                        + Add
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}

          <div className="mp-foot">
            <a
              onClick={(e) => {
                e.preventDefault();
                onViewIntelligence?.();
              }}
              href="#intelligence"
            >
              View all in Intelligence →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
