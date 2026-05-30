/**
 * Section 1, Snapshot
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
  profile?: ClientIntelProfile | null;
  aggregate?: ClientProfileV1;
}

export function SnapshotSection({ clientId, clientName, profile: profileFromParent, aggregate }: SnapshotSectionProps) {
  const api = useApi();
  const navigate = useNavigate();

  const profile = profileFromParent ?? null;

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

  /* ── Meetings (last 14 days) ── */
  // Kept at 14 days to match the "Activity · 14 days" panel header. This is
  // only used as a fallback meetings count when the aggregate profile-v1
  // endpoint doesn't supply activity14d; using a 90-day window here made the
  // "Meetings" bar silently represent a different window than its label.
  const meetingsFrom = useMemo(
    () => new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
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
  const trajectorySection = aggregate?.sections.snapshot.trajectory;
  const trajectory = trajectorySection?.label ?? profile?.lobbyIntel?.trajectory ?? null;
  const activityRows = aggregate?.sections.snapshot.activity14d ?? null;
  const activityMeetings = activityRows ? activityRows.reduce((sum, d) => sum + d.meetings, 0) : meetings.length;
  // Aggregate the 14-day breakdown into 5 totals the mockup specifies:
  // Meetings / Outreach sent / Tasks done / Bills tracked / Critical alerts.
  // `outreach` is optional on the row type (older API responses didn't
  // include it); treat undefined as 0.
  const activityOutreach = activityRows
    ? activityRows.reduce((sum, d) => sum + (d.outreach ?? 0), 0)
    : 0;
  const activityTasks = activityRows
    ? activityRows.reduce((sum, d) => sum + d.tasks, 0)
    : 0;
  // Bars are scaled to the largest single category so the visual emphasis
  // is "which kind of activity dominates", not the absolute totals.
  const activityMax = Math.max(
    activityMeetings,
    activityOutreach,
    activityTasks,
    trackedTotal,
    criticalAlerts.length,
    1,
  );
  // Whether there is any CRM activity at all in the window. When everything is
  // zero we render a compact empty state instead of five flat zero-bars, which
  // read as a broken/empty chart.
  const hasActivity =
    activityMeetings > 0 ||
    activityOutreach > 0 ||
    activityTasks > 0 ||
    trackedTotal > 0 ||
    criticalAlerts.length > 0;
  return (
    <section id="snapshot" className="iv1-section">
      {/* ── Section heading ── */}
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">1</span>
        <h2>Snapshot</h2>
        <span className="iv1-sec-sub">30-second status · what changed today</span>
      </div>

      {/* ── Hero: trajectory · health · Clio briefing ── */}
      {healthQuery.isLoading && !aggregate && !profile ? (
        <Skeleton active paragraph={{ rows: 3 }} style={{ marginBottom: 14 }} />
      ) : (
        <div className="iv1-snap-hero">
          {/* Trajectory */}
          <div className="iv1-snap-cell">
            <span className="iv1-snap-label">Trajectory · 8q</span>
            <TrajectoryChipSparkline
              trajectory={trajectory}
              series={buildQuarterlySeries(profile)}
              model={trajectorySection?.model ?? null}
              fallback={trajectorySection?.fallback ?? null}
            />
            <span className="iv1-snap-delta">
              {profile?.lda?.totalSpending != null && (profile?.lda?.totalFilings ?? 0) > 0
                ? `$${Math.round(profile.lda.totalSpending / profile.lda.totalFilings / 1_000)}K/filing avg · all-time`
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

        {/* Activity 14-day summary */}
        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>Activity · 14 days</h3>
            <span className="iv1-surface-sub">CRM signals</span>
          </div>
          <div className="iv1-surface-body">
            {/* When the client has any CRM activity in the window we show the
                sparkline + per-category bars; otherwise a compact empty state
                so the panel doesn't read as a broken chart of flat zero-bars. */}
            {hasActivity ? (
              <>
                {activityRows && activityRows.length > 0 && (
                  <ActivitySparkline rows={activityRows} />
                )}
                <ActivityBar
                  label="Meetings"
                  value={activityMeetings}
                  max={activityMax}
                  color={activityMeetings === 0 ? 'var(--ink-4)' : 'var(--accent)'}
                  criticalIfZero
                />
                <ActivityBar
                  label="Outreach sent"
                  value={activityOutreach}
                  max={activityMax}
                  color={activityOutreach === 0 ? 'var(--ink-4)' : 'var(--info)'}
                />
                <ActivityBar
                  label="Tasks done"
                  value={activityTasks}
                  max={activityMax}
                  color={activityTasks === 0 ? 'var(--ink-4)' : 'var(--success)'}
                />
                <ActivityBar
                  label="Bills tracked"
                  value={trackedTotal}
                  max={Math.max(trackedTotal, activityMax, 1)}
                  color="var(--info)"
                />
                <ActivityBar
                  label="Critical alerts"
                  value={criticalAlerts.length}
                  max={Math.max(criticalAlerts.length, clientAlerts.length, 1)}
                  color={criticalAlerts.length > 0 ? 'var(--critical)' : 'var(--ink-4)'}
                />
              </>
            ) : (
              <div
                className="iv1-empty"
                style={{ padding: '20px 8px 16px', textAlign: 'center' }}
              >
                <b>No activity in the last 14 days</b>
                <span>Logged meetings, outreach, tasks, and tracked bills will appear here.</span>
              </div>
            )}
            <div
              style={{
                marginTop: hasActivity ? 12 : 4,
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
                onClick={() =>
                  navigate(
                    aggregate?.links.changesInbox ??
                      `/intelligence/changes?clientId=${encodeURIComponent(clientId)}`,
                  )
                }
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
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const color =
    pct < 30 ? 'var(--critical)' : pct < 70 ? 'var(--notable)' : 'var(--success)';

  // SVG semi-circle gauge using stroke-dasharray. The track is a half-circle
  // path (left→right across the top); the colored arc is the same path with
  // its dash length set to `pct`% of the arc, so it fills left→right and is
  // geometrically correct at every score (the old rotated-clipped-div
  // approach pointed the arc the wrong way at low scores).
  //
  // Path: semicircle of radius R centered at (W/2, R+stroke/2), drawn from the
  // left end to the right end over the top.
  const W = 70;
  const STROKE = 7;
  const R = (W - STROKE) / 2; // 31.5
  const CX = W / 2;
  const CY = R + STROKE / 2; // baseline of the semicircle
  const arcLength = Math.PI * R; // length of a half-circle arc
  const dash = (pct / 100) * arcLength;
  // Start at left (CX-R, CY), sweep over the top to right (CX+R, CY).
  const d = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg
        width={W}
        height={CY + STROKE / 2}
        viewBox={`0 0 ${W} ${CY + STROKE / 2}`}
        style={{ flexShrink: 0, display: 'block' }}
        role="img"
        aria-label={score == null ? 'No health score' : `Engagement health ${pct} of 100`}
      >
        {/* Background track */}
        <path
          d={d}
          fill="none"
          stroke="var(--bg-sunken)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Filled arc */}
        {pct > 0 && (
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${arcLength}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        )}
      </svg>
      <div>
        <div
          className="num"
          style={{ fontSize: 24, fontWeight: 600, color, lineHeight: 1 }}
        >
          {score ?? '-'}
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

/**
 * Tiny inline-SVG sparkline above the Activity row list.
 *
 * Renders one stacked bar per day from `activity14d`. Total daily activity
 * is meetings + outreach + tasks + debriefs (emails intentionally excluded
 *, they're noisy and not in the 5-row breakdown below). Height is fixed
 * at 28px; width fills the parent.
 *
 * Empty input → renders nothing (the caller already gates with a length
 * check). Single-spike-day → that bar reaches the full height; quieter
 * days sit proportionally low.
 */
function ActivitySparkline({
  rows,
}: {
  rows: Array<{
    date: string;
    meetings: number;
    tasks: number;
    debriefs: number;
    outreach?: number;
  }>;
}) {
  const totals = rows.map(
    (d) => d.meetings + d.tasks + d.debriefs + (d.outreach ?? 0),
  );
  const max = Math.max(...totals, 1);
  const barW = 100 / rows.length;
  const gap = 0.5;
  return (
    <div
      style={{
        marginBottom: 14,
        paddingBottom: 12,
        borderBottom: '1px solid var(--border-1)',
      }}
    >
      <svg
        viewBox="0 0 100 28"
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily activity over the last 14 days"
        style={{ width: '100%', height: 28, display: 'block' }}
      >
        {totals.map((value, i) => {
          const h = (value / max) * 26;
          // Days with no activity still get a 1px nub so the user can
          // scan the cadence without empty gaps reading as "no chart".
          const minH = 1;
          const finalH = value === 0 ? minH : Math.max(h, 2);
          return (
            <rect
              key={i}
              x={i * barW + gap / 2}
              y={28 - finalH}
              width={barW - gap}
              height={finalH}
              rx={0.6}
              fill={value === 0 ? 'var(--ink-4)' : 'var(--accent)'}
              opacity={value === 0 ? 0.4 : 0.85}
            />
          );
        })}
      </svg>
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
          {', '}
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
