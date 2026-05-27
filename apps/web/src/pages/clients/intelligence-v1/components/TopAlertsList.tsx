import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { CommentAlert } from '../mappers.js';
import type { ClientProfileV1 } from '../mappers.js';
import { daysUntil, formatDate } from '../mappers.js';

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
};

interface TopAlertsListProps {
  aggregate: ClientProfileV1 | undefined;
  fallbackAlerts: CommentAlert[];
  loading: boolean;
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

export function TopAlertsList({ aggregate, fallbackAlerts, loading, links }: TopAlertsListProps) {
  const navigate = useNavigate();

  const rows = useMemo(() => {
    const fromAggregate = aggregate?.sections.snapshot.topAlerts ?? [];
    if (fromAggregate.length > 0) {
      return fromAggregate
        .map<TopAlertItem>((alert, idx) => {
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
          };
        })
        .sort((a, b) => {
          const sev = severityRank(b.severity) - severityRank(a.severity);
          if (sev !== 0) return sev;
          const urgency = urgencyRank(b) - urgencyRank(a);
          if (urgency !== 0) return urgency;
          return b.when.localeCompare(a.when);
        });
    }

    return fallbackAlerts
      .map<TopAlertItem>((alert, idx) => {
        const days = typeof alert.daysToDeadline === 'number' ? alert.daysToDeadline : daysUntil(alert.commentEndDate);
        return {
          id: alert.documentId || `fallback-${idx}`,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          subtitle: alert.agencies?.slice(0, 2).join(' / ') || 'Federal Register',
          when: alert.commentEndDate,
          countdownDays: days,
          countdownLabel: countdownText(days),
          href: null,
        };
      })
      .sort((a, b) => {
        const sev = severityRank(b.severity) - severityRank(a.severity);
        if (sev !== 0) return sev;
        const urgency = urgencyRank(b) - urgencyRank(a);
        if (urgency !== 0) return urgency;
        return b.when.localeCompare(a.when);
      });
  }, [aggregate, fallbackAlerts]);

  const onRowClick = (row: TopAlertItem) => {
    if (row.href) {
      navigate(row.href);
      return;
    }
    navigate(links.viewAllHref);
  };

  return (
    <div className="iv1-surface">
      <div className="iv1-surface-head">
        <WarningOutlined style={{ color: 'var(--critical)', fontSize: 13 }} />
        <h3>Top alerts</h3>
        {rows.length > 0 && (
          <span className="iv1-surface-sub">
            {Math.min(5, rows.length)} of {rows.length}
          </span>
        )}
        <span className="iv1-surface-right">
          <button type="button" className="iv1-link" onClick={() => navigate(links.viewAllHref)}>
            View all →
          </button>
        </span>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} style={{ padding: 16 }} />
      ) : rows.length === 0 ? (
        <div className="iv1-empty">
          <div className="iv1-empty-icon">✓</div>
          <b>No open alerts</b>
          <span>No comment deadlines or critical changes right now.</span>
        </div>
      ) : (
        rows.slice(0, 5).map((row) => {
          const cls =
            row.severity === 'critical' ? 'critical' : row.severity === 'notable' ? 'notable' : 'info';
          const ctd = row.countdownLabel ?? countdownText(row.countdownDays);
          return (
            <button
              key={row.id}
              type="button"
              className={`iv1-alert-row ${cls} iv1-alert-row-btn`}
              onClick={() => onRowClick(row)}
              aria-label={`${row.title} ${ctd ?? ''}`.trim()}
            >
              <span className="iv1-alert-stripe" />
              <div className="iv1-alert-copy">
                <div className="iv1-alert-title">{row.title}</div>
                <div className="iv1-alert-dek">{row.subtitle || 'Federal Register'}</div>
              </div>
              <div className="iv1-alert-when">
                {row.when ? formatDate(row.when) : '—'}
                {ctd && (
                  <span className="iv1-ctd" style={{ color: countdownColor(row.countdownDays, row.severity) }}>
                    {ctd}
                  </span>
                )}
              </div>
            </button>
          );
        })
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
