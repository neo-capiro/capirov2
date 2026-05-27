/**
 * Section 1 — Snapshot
 * Fetches comment alerts, recent changes, meetings, and client profile.
 * Renders: hero metrics, Clio briefing, top alerts, 90-day activity strip.
 */
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from 'antd';
import { useApi } from '../../../../lib/use-api.js';
import type { ClientIntelProfile, HealthScore, CommentAlert } from '../mappers.js';
import { daysUntil, formatDate, type ClientProfileV1 } from '../mappers.js';
import { TrajectoryChipSparkline } from '../components/TrajectoryChipSparkline.js';
import { BriefingCard } from '../components/BriefingCard.js';
import { TopAlertsList } from '../components/TopAlertsList.js';

interface SnapshotSectionProps {
  clientId: string;
  clientName: string;
  aggregate?: ClientProfileV1;
}

export function SnapshotSection({ clientId, clientName, aggregate }: SnapshotSectionProps) {
  const api = useApi();
  const navigate = useNavigate();

  /* ── Profile (shared key with rest of app) ── */
  const profileQuery = useQuery<ClientIntelProfile>({
    queryKey: ['client-intel-profile', clientId],
    queryFn: async () =>
      (
        await api.get<ClientIntelProfile>(
          `/api/intelligence/client-profile/${clientId}`,
        )
      ).data,
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
  });

  /* ── Engagement health score ── */
  const healthQuery = useQuery<HealthScore | null>({
    queryKey: ['client-health-score', clientId],
    queryFn: async () => {
      try {
        return (
          await api.get<HealthScore>(`/api/intelligence/clients/${clientId}/health-score`)
        ).data;
      } catch {
        return null;
      }
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  /* ── Comment alerts (global; filter by client) ── */
  const alertsQuery = useQuery<{ alerts: CommentAlert[] }>({
    queryKey: ['comment-alerts'],
    queryFn: async () =>
      (await api.get<{ alerts: CommentAlert[] }>('/api/intelligence/comment-alerts')).data,
    staleTime: 5 * 60 * 1000,
  });

  /* ── Recent intelligence changes (7 days) ── */
  const sinceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }, []);

  const changesQuery = useQuery<{ id: string; title: string; severity: string }[]>({
    queryKey: ['intel-changes-snap', clientId, sinceDate],
    queryFn: async () => {
      try {
        return (
          await api.get<{ id: string; title: string; severity: string }[]>(
            '/api/intelligence/changes',
            { params: { clientId, since: sinceDate, limit: 50 } },
          )
        ).data;
      } catch {
        return [];
      }
    },
    staleTime: 2 * 60 * 1000,
  });

  /* ── Meetings (last 90 days) ── */
  const meetingsFrom = useMemo(
    () => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );
  const meetingsQuery = useQuery<unknown[]>({
    queryKey: ['client-meetings-snap', clientId, meetingsFrom],
    queryFn: async () => {
      try {
        return (
          await api.get<unknown[]>('/api/engagement/meetings', {
            params: { clientId, from: meetingsFrom },
          })
        ).data;
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const profile = profileQuery.data ?? null;
  const health = healthQuery.data ?? null;
  const fallbackAlerts = (alertsQuery.data?.alerts ?? []).filter((a) => a.clientId === clientId);
  const clientAlerts = aggregate?.sections.snapshot.topAlerts?.length
    ? aggregate.sections.snapshot.topAlerts.map((a, idx) => ({
        documentId: `${a.type}-${idx}`,
        title: a.title,
        type: a.type,
        commentEndDate: a.when,
        daysToDeadline: daysUntil(a.when) ?? 0,
        severity: a.severity,
        agencies: a.subtitle ? [a.subtitle] : [],
        clientId,
        clientName,
        relevanceScore: 1,
      }))
    : fallbackAlerts;
  const criticalAlerts = clientAlerts.filter((a) => (a.daysToDeadline ?? 99) <= 7);
  const changes = changesQuery.data ?? [];
  const meetings = meetingsQuery.data ?? [];
  const trackedTotal = aggregate?.sections.legislativeRegulatory.kanban.total ?? profile?.relevantBills?.total ?? 0;
  const healthScore = aggregate?.sections.snapshot.health?.score ?? health?.score ?? null;
  const trajectory = aggregate?.sections.snapshot.trajectory?.label ?? profile?.lobbyIntel?.trajectory ?? null;
  const activityRows = aggregate?.sections.snapshot.activity14d ?? null;
  const activityMeetings = activityRows ? activityRows.reduce((sum, d) => sum + d.meetings, 0) : meetings.length;
  const activityMax = Math.max(
    activityRows
      ? activityRows.reduce((sum, d) => sum + d.meetings + d.emails + d.tasks + d.debriefs, 0)
      : meetings.length,
    trackedTotal,
    criticalAlerts.length,
    1,
  );
  return (
    <section id="snapshot" className="iv1-section">
      {/* ── Section heading ── */}
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">1</span>
        <h2>Snapshot</h2>
        <span className="iv1-sec-sub">30-second status · what changed today</span>
      </div>

      {/* ── Hero: trajectory · health · Clio briefing ── */}
      {profileQuery.isLoading || healthQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} style={{ marginBottom: 14 }} />
      ) : (
        <div className="iv1-snap-hero">
          {/* Trajectory */}
          <div className="iv1-snap-cell">
            <span className="iv1-snap-label">Trajectory · 8q</span>
            <TrajectoryChipSparkline
              trajectory={trajectory}
              series={buildQuarterlySeries(profile)}
            />
            <span className="iv1-snap-delta">
              {profile?.lda?.totalSpending != null && (profile?.lda?.totalFilings ?? 0) > 0
                ? `$${Math.round(profile.lda.totalSpending / profile.lda.totalFilings / 1_000)}K/filing avg`
                : 'No LDA data yet'}
            </span>
          </div>

          {/* Engagement health */}
          <div className="iv1-snap-cell">
            <span className="iv1-snap-label">Engagement health</span>
            <HealthGauge score={healthScore} />
          </div>

          {/* Clio briefing */}
          <BriefingCard
            briefing={aggregate?.sections.snapshot.dailyBriefing ?? null}
            fallbackSummary={clioText(profile, clientAlerts, changes.length, meetings.length, clientName)}
            ctaHref={aggregate?.links.changesInbox ?? '/intelligence/changes'}
          />
        </div>
      )}

      {/* ── Bottom row: Alerts | Activity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, marginTop: 14 }}>
        {/* Top alerts */}
        <TopAlertsList
          aggregate={aggregate}
          fallbackAlerts={clientAlerts}
          loading={alertsQuery.isLoading}
          links={{
            viewAllHref: aggregate?.links.changesInbox ?? '/intelligence/changes',
            mappingsHref: aggregate?.links.mappingsAdmin ?? '/settings/intelligence-mappings',
          }}
        />

        {/* Activity 90-day summary */}
        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>Activity · 90 days</h3>
            <span className="iv1-surface-sub">CRM signals</span>
          </div>
          <div className="iv1-surface-body">
            <ActivityBar
              label="Meetings"
              value={activityMeetings}
              max={activityMax}
              color={activityMeetings === 0 ? 'var(--ink-4)' : 'var(--accent)'}
              criticalIfZero
            />
            <ActivityBar
              label="Bills tracked"
              value={trackedTotal}
              max={Math.max(trackedTotal, 1)}
              color="var(--info)"
            />
            <ActivityBar
              label="Critical alerts"
              value={criticalAlerts.length}
              max={Math.max(criticalAlerts.length, clientAlerts.length, 1)}
              color={criticalAlerts.length > 0 ? 'var(--critical)' : 'var(--ink-4)'}
            />
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--border-1)',
                display: 'flex',
                gap: 8,
              }}
            >
              <button
                type="button"
                className="iv1-btn-primary iv1-btn-sm"
                style={{ flex: 1, textAlign: 'center' }}
                onClick={() => navigate('/intelligence/changes')}
              >
                Changes inbox
              </button>
              <button
                type="button"
                className="iv1-btn iv1-btn-sm"
                style={{ flex: 1, textAlign: 'center' }}
                onClick={() => navigate('/explorer')}
              >
                Explorer
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function HealthGauge({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const color =
    pct < 30 ? 'var(--critical)' : pct < 70 ? 'var(--notable)' : 'var(--success)';
  // CSS-only semi-circle gauge (no canvas/chart dep)
  const deg = Math.round((pct / 100) * 180) - 180;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: 70, height: 35, flexShrink: 0 }}>
        {/* Background track */}
        <div
          style={{
            position: 'absolute',
            width: 70, height: 70,
            borderRadius: '50%',
            border: '7px solid var(--bg-sunken)',
            top: 0, left: 0,
            clipPath: 'inset(0 0 50% 0)',
          }}
        />
        {/* Filled arc */}
        <div
          style={{
            position: 'absolute',
            width: 70, height: 70,
            borderRadius: '50%',
            border: `7px solid ${color}`,
            top: 0, left: 0,
            clipPath: 'inset(0 0 50% 0)',
            transform: `rotate(${deg}deg)`,
            transformOrigin: '50% 100%',
            transition: 'transform 0.6s ease',
          }}
        />
      </div>
      <div>
        <div
          className="num"
          style={{ fontSize: 24, fontWeight: 600, color, lineHeight: 1 }}
        >
          {score ?? '—'}
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>/100</span>
        </div>
        <div
          className="iv1-snap-delta"
          style={{
            marginTop: 2,
            color: score != null && score < 30 ? 'var(--critical)' : 'var(--ink-3)',
          }}
        >
          {score == null
            ? 'No data'
            : score < 30
              ? '↓ needs activity'
              : score < 70
                ? 'at risk'
                : '✓ healthy'}
        </div>
      </div>
    </div>
  );
}

function ActivityBar({
  label,
  value,
  max,
  color,
  criticalIfZero = false,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  criticalIfZero?: boolean;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const isCritical = criticalIfZero && value === 0;
  return (
    <div className="iv1-activity-row">
      <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{label}</span>
      <div className="iv1-bar-track">
        <div className="iv1-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span
        className="num"
        style={{
          textAlign: 'right',
          fontWeight: 500,
          fontSize: 12,
          color: isCritical ? 'var(--critical)' : 'var(--ink-1)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function clioText(
  profile: ClientIntelProfile | null,
  alerts: CommentAlert[],
  changeCount: number,
  meetingCount: number,
  clientName: string,
): ReactNode {
  const critAlerts = alerts.filter((a) => a.daysToDeadline <= 7);
  const totalBills = profile?.relevantBills?.total ?? 0;
  const noMapping = !profile?.lda?.matched && !profile?.contracting?.matched;

  if (!profile) {
    return <>Loading intelligence data for <b>{clientName}</b>…</>;
  }

  if (noMapping) {
    return (
      <>
        No LDA or contract mapping confirmed for <b>{clientName}</b>. Visit{' '}
        <b>Manage sources</b> to confirm the intelligence mapping and unlock financial data.
        {totalBills > 0 ? ` ${totalBills} bills tracked via capability matching.` : ''}
      </>
    );
  }

  return (
    <>
      {critAlerts.length > 0 && (
        <>
          <mark className="crit">
            {critAlerts.length} comment deadline{critAlerts.length > 1 ? 's' : ''} in the
            next 7 days
          </mark>
          {' — '}
        </>
      )}
      {totalBills > 0 && (
        <>
          <mark>{totalBills} bills tracked</mark> via issue codes.{' '}
        </>
      )}
      {meetingCount === 0 && 'No meetings logged this quarter. '}
      {changeCount > 0
        ? `${changeCount} new intel event${changeCount === 1 ? '' : 's'} this week.`
        : 'No new events this week.'}
    </>
  );
}

function buildQuarterlySeries(profile: ClientIntelProfile | null): Array<{ label: string; value: number }> {
  const yearly = profile?.lda?.yearlySpend ?? [];

  if (!yearly.length) return [];

  const sorted = [...yearly]
    .filter((item) => Number.isFinite(item.amount) && Number.isFinite(item.year))
    .sort((a, b) => a.year - b.year)
    .slice(-8);

  return sorted.map((item) => ({ label: String(item.year), value: item.amount }));
}
