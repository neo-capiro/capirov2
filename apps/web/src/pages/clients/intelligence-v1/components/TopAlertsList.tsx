import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Dropdown, Segmented, Skeleton, Tooltip } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  FileAddOutlined,
  SendOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useApi } from '../../../../lib/use-api.js';
import type { CommentAlert } from '../mappers.js';
import type { ClientProfileV1 } from '../mappers.js';
import { daysUntil, formatDate } from '../mappers.js';

type AlertState = 'acknowledged' | null;

type TopAlertItem = {
  id: string;
  type: string;
  severity: 'critical' | 'notable' | 'info' | string;
  title: string;
  subtitle: string;
  when: string;
  countdownDays: number | null;
  countdownLabel: string | null;
  href: string | null;
  state: AlertState;
};

interface TopAlertsListProps {
  aggregate: ClientProfileV1 | undefined;
  fallbackAlerts: CommentAlert[];
  loading: boolean;
  /** Client whose alerts these are — required for state/brief mutations. */
  clientId: string;
  /** How many alerts exist beyond the 5 shown (from the aggregate). */
  hiddenCount?: number;
  links: {
    viewAllHref: string;
    mappingsHref: string;
  };
}

const severityRank = (severity: string): number => {
  if (severity === 'critical') return 3;
  if (severity === 'notable') return 2;
  return 1;
};

const urgencyRank = (item: TopAlertItem): number => {
  if (item.countdownDays == null) return 0;
  return 100 - Math.max(-30, Math.min(item.countdownDays, 100));
};

const countdownColor = (days: number | null, severity: string): string => {
  if (days == null) {
    return severity === 'critical'
      ? 'var(--critical)'
      : severity === 'notable'
        ? 'var(--notable)'
        : 'var(--info)';
  }
  if (days <= 0) return 'var(--critical)';
  if (days <= 3) return 'var(--critical)';
  if (days <= 10) return 'var(--notable)';
  return 'var(--info)';
};

const countdownText = (days: number | null): string | null => {
  if (days == null) return null;
  if (days < 0) return `Overdue ${Math.abs(days)}d`;
  if (days === 0) return 'Due today';
  if (days === 1) return '1d left';
  return `${days}d left`;
};

// Comment-deadline-style alerts get calendar + outreach actions; everything else
// gets "add to brief". A deadline alert ALSO gets "add to brief".
const DEADLINE_TYPES = new Set(['comment_deadline', 'comment_overdue', 'hearing']);

export function TopAlertsList({
  aggregate,
  fallbackAlerts,
  loading,
  clientId,
  hiddenCount,
  links,
}: TopAlertsListProps) {
  const navigate = useNavigate();
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();

  // "Priority" = severity → urgency (the default). "Deadline" = soonest-closing
  // first (days ascending, nulls last) so a lobbyist can flip to a pure
  // what's-about-to-close-on-me view.
  const [sortMode, setSortMode] = useState<'priority' | 'deadline'>('priority');

  const rows = useMemo<TopAlertItem[]>(() => {
    const fromAggregate = aggregate?.sections.snapshot.topAlerts ?? [];
    if (fromAggregate.length > 0) {
      return fromAggregate.map<TopAlertItem>((alert, idx) => {
        const derivedDays = daysUntil(alert.when);
        const days = alert.countdownDays ?? derivedDays;
        return {
          id: alert.id ?? `${alert.type}-${idx}`,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          subtitle: alert.subtitle,
          when: alert.when,
          countdownDays: days,
          countdownLabel: alert.countdownLabel ?? countdownText(days),
          href: alert.href ?? null,
          state: alert.state ?? null,
        };
      });
    }

    return fallbackAlerts.map<TopAlertItem>((alert, idx) => {
      const days = typeof alert.daysToDeadline === 'number' ? alert.daysToDeadline : daysUntil(alert.commentEndDate);
      return {
        id: alert.documentId ? `comment:${alert.documentId}` : `fallback-${idx}`,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        subtitle: alert.agencies?.slice(0, 2).join(' / ') || 'Federal Register',
        when: alert.commentEndDate,
        countdownDays: days,
        countdownLabel: countdownText(days),
        href: null,
        state: null,
      };
    });
  }, [aggregate, fallbackAlerts]);

  const sortedRows = useMemo<TopAlertItem[]>(() => {
    const copy = [...rows];
    if (sortMode === 'deadline') {
      // Soonest-closing first. Alerts with no countdown (changes, awards,
      // competitor filings) sort to the bottom, ordered by recency.
      copy.sort((a, b) => {
        const aHas = a.countdownDays != null;
        const bHas = b.countdownDays != null;
        if (aHas && bHas) {
          if (a.countdownDays !== b.countdownDays) return (a.countdownDays as number) - (b.countdownDays as number);
          return b.when.localeCompare(a.when);
        }
        if (aHas) return -1;
        if (bHas) return 1;
        return b.when.localeCompare(a.when);
      });
    } else {
      copy.sort((a, b) => {
        const sev = severityRank(b.severity) - severityRank(a.severity);
        if (sev !== 0) return sev;
        const urgency = urgencyRank(b) - urgencyRank(a);
        if (urgency !== 0) return urgency;
        return b.when.localeCompare(a.when);
      });
    }
    return copy;
  }, [rows, sortMode]);

  const visibleRows = sortedRows.slice(0, 5);
  // Prefer the server's hidden count (computed off the full unsliced set); fall
  // back to the local count when the prop isn't supplied (fallback-alerts path).
  const moreCount = typeof hiddenCount === 'number' ? hiddenCount : Math.max(0, rows.length - 5);

  // ── Worklist-state mutation (ack / dismiss / snooze) ──────────────────────
  // Optimistic with rollback + a visible error toast — a failed persist must
  // never look like it worked (the row would silently reappear on refetch).
  const stateMutation = useMutation({
    mutationFn: async (vars: {
      alertId: string;
      state: 'acknowledged' | 'dismissed' | 'snoozed';
      snoozedUntil?: string;
    }) => {
      await api.post(`/api/intelligence/clients/${clientId}/alert-state`, {
        alertId: vars.alertId,
        state: vars.state,
        snoozedUntil: vars.snoozedUntil,
      });
    },
    onSuccess: (_d, vars) => {
      const verb =
        vars.state === 'dismissed' ? 'Dismissed' : vars.state === 'snoozed' ? 'Snoozed' : 'Acknowledged';
      message.success(`Alert ${verb.toLowerCase()}`);
      void qc.invalidateQueries({ queryKey: ['client-intel-v1-aggregate', clientId] });
    },
    onError: () => {
      message.error('Could not update the alert — please try again');
    },
  });

  const briefMutation = useMutation({
    mutationFn: async (row: TopAlertItem) => {
      await api.post(`/api/intelligence/clients/${clientId}/briefs`, {
        title: row.title,
        body: `${row.subtitle || ''}${row.countdownLabel ? ` · ${row.countdownLabel}` : ''}`.trim() || row.title,
        sourceAlertId: row.id,
        sourceType: row.type,
      });
    },
    onSuccess: () => {
      message.success('Added to client brief');
      void qc.invalidateQueries({ queryKey: ['client-briefs', clientId] });
    },
    onError: () => {
      message.error('Could not add to brief — please try again');
    },
  });

  const setState = (
    alertId: string,
    state: 'acknowledged' | 'dismissed' | 'snoozed',
    snoozeDays?: number,
  ) => {
    const snoozedUntil =
      state === 'snoozed' && snoozeDays
        ? new Date(Date.now() + snoozeDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
    stateMutation.mutate({ alertId, state, snoozedUntil });
  };

  const withClientFilter = (href: string): string => {
    const base = href?.trim() || '/intelligence/changes';
    const fallback = links.viewAllHref?.trim() || '/intelligence/changes';
    const clientIdFromLink = (() => {
      const ix = fallback.indexOf('?');
      const query = ix >= 0 ? fallback.slice(ix + 1) : '';
      const params = new URLSearchParams(query);
      return params.get('clientId');
    })();

    if (!clientIdFromLink) return base;
    if (base.includes('clientId=')) return base;

    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}clientId=${encodeURIComponent(clientIdFromLink)}`;
  };

  const onRowOpen = (row: TopAlertItem) => {
    if (row.href) {
      navigate(withClientFilter(row.href));
      return;
    }
    navigate(links.viewAllHref);
  };

  // One-click actions deep-link into the existing engagement + outreach surfaces,
  // carrying clientId + the originating alert so those flows open pre-contextualized.
  const startOutreach = (row: TopAlertItem) =>
    navigate(
      `/engagement/outreach?clientId=${encodeURIComponent(clientId)}&alertId=${encodeURIComponent(row.id)}`,
    );
  const addToCalendar = (row: TopAlertItem) =>
    navigate(
      `/engagement?clientId=${encodeURIComponent(clientId)}&deadline=${encodeURIComponent(row.when)}&alertId=${encodeURIComponent(row.id)}`,
    );

  return (
    <div className="iv1-surface">
      <div className="iv1-surface-head">
        <WarningOutlined style={{ color: 'var(--critical)', fontSize: 13 }} />
        <h3>Top alerts</h3>
        {rows.length > 0 && (
          <span className="iv1-surface-sub">
            {Math.min(5, rows.length)} of {Math.max(rows.length, 5 + moreCount)}
          </span>
        )}
        <span className="iv1-surface-right" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Segmented
            size="small"
            value={sortMode}
            onChange={(v) => setSortMode(v as 'priority' | 'deadline')}
            options={[
              { label: 'Priority', value: 'priority' },
              { label: 'Deadline', value: 'deadline' },
            ]}
          />
          <button type="button" className="iv1-link" onClick={() => navigate(links.viewAllHref)}>
            View all →
          </button>
        </span>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} style={{ padding: 16 }} />
      ) : visibleRows.length === 0 ? (
        <div className="iv1-empty">
          <div className="iv1-empty-icon">✓</div>
          <b>No open alerts</b>
          <span>No comment deadlines, hearings, or critical changes right now.</span>
        </div>
      ) : (
        visibleRows.map((row) => {
          const cls =
            row.severity === 'critical' ? 'critical' : row.severity === 'notable' ? 'notable' : 'info';
          const ctd = row.countdownLabel ?? countdownText(row.countdownDays);
          const isDeadlineType = DEADLINE_TYPES.has(row.type);
          const acked = row.state === 'acknowledged';
          return (
            <div
              key={row.id}
              className={`iv1-alert-row ${cls}`}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                opacity: acked ? 0.55 : 1,
              }}
            >
              <span className="iv1-alert-stripe" />
              <button
                type="button"
                className="iv1-alert-copy iv1-alert-row-btn"
                onClick={() => onRowOpen(row)}
                aria-label={`${row.title} ${ctd ?? ''}`.trim()}
                style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer' }}
              >
                <div className="iv1-alert-title">
                  {row.title}
                  {acked && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                        border: '1px solid var(--border-1)',
                        borderRadius: 999,
                        padding: '0 6px',
                      }}
                    >
                      Ack'd
                    </span>
                  )}
                </div>
                <div className="iv1-alert-dek">{row.subtitle || 'Federal Register'}</div>
              </button>

              <div
                className="iv1-alert-when"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 4 }}
              >
                <span>
                  {row.when ? formatDate(row.when) : '-'}
                  {ctd && (
                    <span className="iv1-ctd" style={{ color: countdownColor(row.countdownDays, row.severity), marginLeft: 6 }}>
                      {ctd}
                    </span>
                  )}
                </span>
                {/* Worklist + one-click action controls. */}
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  {isDeadlineType ? (
                    <>
                      <Tooltip title="Add to calendar">
                        <button type="button" className="iv1-icon-btn" aria-label="Add to calendar" onClick={() => addToCalendar(row)}>
                          <CalendarOutlined />
                        </button>
                      </Tooltip>
                      <Tooltip title="Start outreach">
                        <button type="button" className="iv1-icon-btn" aria-label="Start outreach" onClick={() => startOutreach(row)}>
                          <SendOutlined />
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    <Tooltip title="Add to client brief">
                      <button
                        type="button"
                        className="iv1-icon-btn"
                        aria-label="Add to client brief"
                        disabled={briefMutation.isPending}
                        onClick={() => briefMutation.mutate(row)}
                      >
                        <FileAddOutlined />
                      </button>
                    </Tooltip>
                  )}
                  {/* Deadline types ALSO support "add to brief" alongside calendar/outreach. */}
                  {isDeadlineType && (
                    <Tooltip title="Add to client brief">
                      <button
                        type="button"
                        className="iv1-icon-btn"
                        aria-label="Add to client brief"
                        disabled={briefMutation.isPending}
                        onClick={() => briefMutation.mutate(row)}
                      >
                        <FileAddOutlined />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip title={acked ? 'Acknowledged' : 'Acknowledge'}>
                    <button
                      type="button"
                      className="iv1-icon-btn"
                      aria-label="Acknowledge"
                      disabled={stateMutation.isPending}
                      onClick={() => setState(row.id, 'acknowledged')}
                    >
                      <CheckOutlined />
                    </button>
                  </Tooltip>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: '1', label: 'Snooze 1 day' },
                        { key: '3', label: 'Snooze 3 days' },
                        { key: '7', label: 'Snooze 7 days' },
                      ],
                      onClick: ({ key }) => setState(row.id, 'snoozed', Number(key)),
                    }}
                  >
                    <Tooltip title="Snooze">
                      <button type="button" className="iv1-icon-btn" aria-label="Snooze">
                        <ClockCircleOutlined />
                      </button>
                    </Tooltip>
                  </Dropdown>
                  <Tooltip title="Dismiss">
                    <button
                      type="button"
                      className="iv1-icon-btn"
                      aria-label="Dismiss"
                      disabled={stateMutation.isPending}
                      onClick={() => setState(row.id, 'dismissed')}
                    >
                      <CloseOutlined />
                    </button>
                  </Tooltip>
                </span>
              </div>
            </div>
          );
        })
      )}

      {moreCount > 0 && (
        <button
          type="button"
          className="iv1-link"
          style={{ display: 'block', width: '100%', textAlign: 'center', padding: '8px 0', borderTop: '1px solid var(--border-1)' }}
          onClick={() => navigate(links.viewAllHref)}
        >
          {moreCount} more {moreCount === 1 ? 'alert' : 'alerts'} →
        </button>
      )}

      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border-1)',
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        Add tracked issues via{' '}
        <button type="button" className="iv1-link" onClick={() => navigate(links.mappingsHref)}>
          source mappings →
        </button>
      </div>
    </div>
  );
}
