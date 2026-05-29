import { useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Empty, Skeleton, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/use-api.js';
import type { Client } from './clients/clientTypes.js';
import type { WorkflowInstance } from './workspace/workflowTypes.js';
import type { DailyBrief, IntelligenceChange } from './intelligence/types.js';

/* ── Local data shapes (lean projections of the API responses) ──────────── */

interface CommentAlertItem {
  documentId: string;
  title: string;
  type: string;
  commentEndDate: string;
  daysToDeadline: number;
  severity: string;
  agencies: string[];
  clientId: string;
  clientName: string;
  relevanceScore: number;
}

interface CommentAlertsResponse {
  alerts: CommentAlertItem[];
}

interface DashMeeting {
  id: string;
  subject: string;
  location: string | null;
  source: string;
  startsAt: string;
  endsAt: string;
  organizerName: string | null;
  client: { id: string; name: string } | null;
  attendees: Array<{ name: string | null; role: string | null }>;
  preps: Array<{ status: string }>;
  debriefs: Array<{ id: string }>;
}

interface DashOutreach {
  id: string;
  title: string;
  subject: string | null;
  body: string | null;
  status: 'draft' | 'sent' | 'opened_in_email' | 'failed';
  recipientCount: number;
  client: { id: string; name: string } | null;
  updatedAt: string;
}

const COMMENTS_LINK = '/explorer?source=comment-deadlines';

export function HomePage() {
  const api = useApi();
  const { user } = useUser();

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
    staleTime: 60_000,
  });

  const recentChanges = useQuery<IntelligenceChange[]>({
    queryKey: ['intel-changes-tracked'],
    queryFn: async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        return (
          await api.get<IntelligenceChange[]>('/api/intelligence/changes', { params: { since } })
        ).data;
      } catch {
        return [];
      }
    },
    staleTime: 2 * 60 * 1000,
  });

  const brief = useQuery<DailyBrief>({
    queryKey: ['daily-brief'],
    queryFn: async () => (await api.get<DailyBrief>('/api/intelligence/daily-brief')).data,
    staleTime: 10 * 60 * 1000,
  });

  const commentAlerts = useQuery<CommentAlertsResponse>({
    queryKey: ['comment-alerts-dashboard'],
    queryFn: async () =>
      (await api.get<CommentAlertsResponse>('/api/intelligence/comment-alerts')).data,
    staleTime: 5 * 60 * 1000,
  });

  // Active workflows across ALL clients (cross-client view).
  const workflows = useQuery<WorkflowInstance[]>({
    queryKey: ['workflow-instances'],
    queryFn: async () => (await api.get<WorkflowInstance[]>('/api/workflows/instances')).data,
    staleTime: 30_000,
  });

  // This-week meetings for the Client Engagement strip. Range = Mon 00:00
  // through Sun 23:59 of the current ET week.
  const week = useMemo(() => weekBounds(new Date()), []);
  const meetings = useQuery<DashMeeting[]>({
    queryKey: ['engagement-meetings-week', week.from, week.to],
    queryFn: async () =>
      (
        await api.get<DashMeeting[]>('/api/engagement/meetings', {
          params: { from: week.from, to: week.to },
        })
      ).data,
    staleTime: 60_000,
  });

  const outreach = useQuery<DashOutreach[]>({
    queryKey: ['engagement-outreach-drafts'],
    queryFn: async () =>
      (await api.get<DashOutreach[]>('/api/engagement/outreach', { params: { limit: 25 } })).data,
    staleTime: 60_000,
  });

  const overnightCount = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (recentChanges.data ?? []).filter(
      (c) => new Date(c.detectedAt).getTime() >= cutoff,
    ).length;
  }, [recentChanges.data, recentChanges.dataUpdatedAt]);

  const criticalTodayCount = useMemo(
    () => (recentChanges.data ?? []).filter((c) => c.severity === 'critical').length,
    [recentChanges.data],
  );

  const firstName = user?.firstName || (user?.fullName?.split(' ')[0] ?? null) || null;
  const clientNameById = useMemo(
    () => new Map((clients.data ?? []).map((c) => [c.id, c.name])),
    [clients.data],
  );

  return (
    <section className="command-page redesign">
      <GreetingRow
        firstName={firstName}
        overnightCount={overnightCount}
        criticalToday={criticalTodayCount}
      />

      <CommentPeriods
        alerts={commentAlerts.data?.alerts ?? []}
        loading={commentAlerts.isLoading}
      />

      <ClioBrief brief={brief.data} loading={brief.isLoading} isError={brief.isError} />

      <div className="home-grid-2">
        <ClientEngagement
          meetings={meetings.data ?? []}
          loading={meetings.isLoading}
        />
        <OutreachDrafts records={outreach.data ?? []} loading={outreach.isLoading} />
      </div>

      <div className="home-grid-2">
        <OpenWorkflows workflows={workflows.data ?? []} loading={workflows.isLoading} />
        <RegulatoryAlerts
          alerts={commentAlerts.data?.alerts ?? []}
          changes={recentChanges.data ?? []}
          clientNameById={clientNameById}
          loading={recentChanges.isLoading || commentAlerts.isLoading}
        />
      </div>
    </section>
  );
}

/* ── Greeting row ───────────────────────────────────────────────────────── */

function GreetingRow({
  firstName,
  overnightCount,
  criticalToday,
}: {
  firstName: string | null;
  overnightCount: number;
  criticalToday: number;
}) {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5 ? 'Good Evening' : hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const congress = congressSession(now);

  return (
    <header className="home-greet-row">
      <div>
        <h1 className="home-greet">
          {greeting}{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="home-greet-meta">
          {dateLabel} · {congress} ·{' '}
          <b className="num">{overnightCount}</b> new signal{overnightCount === 1 ? '' : 's'} overnight
          {criticalToday > 0 ? (
            <>
              {' · '}
              <span className="critical">{criticalToday} critical action{criticalToday === 1 ? '' : 's'} today</span>
            </>
          ) : null}
        </p>
      </div>
    </header>
  );
}

/* ── Comment periods requiring attention (4-up card row) ────────────────── */

function CommentPeriods({
  alerts,
  loading,
}: {
  alerts: CommentAlertItem[];
  loading: boolean;
}) {
  const sorted = useMemo(
    () => [...alerts].sort((a, b) => a.daysToDeadline - b.daysToDeadline).slice(0, 4),
    [alerts],
  );

  return (
    <div className="home-attention">
      <div className="home-attention-head">
        <span className="home-attention-title">Comment Periods Requiring Attention</span>
        <span className="meta">
          {alerts.length} active ·{' '}
          <Link to={COMMENTS_LINK} style={{ color: 'var(--ink-2)', textDecoration: 'underline' }}>
            see all →
          </Link>
        </span>
      </div>
      {loading ? (
        <div className="home-attention-body home-attention-body--four">
          {[0, 1, 2, 3].map((i) => (
            <div className="home-attention-cell" key={i}>
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 24 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No open comment periods right now." />
        </div>
      ) : (
        <div className="home-attention-body home-attention-body--four">
          {sorted.map((a) => {
            const sev = commentSeverity(a.daysToDeadline);
            return (
              <Link key={a.documentId} to={COMMENTS_LINK} className="home-attention-cell is-link">
                <span className="home-attention-eyebrow">
                  <span className={`dot ${sev}`} aria-hidden />
                  {prettySource(a.type || a.agencies[0] || 'FedReg')} · {deadlineLabel(a.daysToDeadline)}
                </span>
                <span className="home-attention-title-row home-clamp-2">{a.title}</span>
                <span className="home-attention-dek">{a.clientName || 'Unmapped'}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Clio brief (full width) ────────────────────────────────────────────── */

function ClioBrief({
  brief,
  loading,
  isError,
}: {
  brief: DailyBrief | undefined;
  loading: boolean;
  isError: boolean;
}) {
  const dateLabel = (brief?.generatedAt ? new Date(brief.generatedAt) : new Date()).toLocaleDateString(
    'en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  );

  return (
    <div className="home-brief">
      <div className="home-brief-head">
        <span className="home-brief-title">
          Clio Brief <span className="home-brief-title-sub">· Your Morning Intelligence</span>
        </span>
        <span className="open">
          <Link to="/intelligence">Open Intelligence Center →</Link>
        </span>
      </div>
      <div className="home-brief-body">
        <p className="home-brief-date">{dateLabel}</p>
        {loading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : isError ? (
          <p className="home-brief-empty">Clio is offline right now. Check back in a minute.</p>
        ) : brief?.brief ? (
          <p className="home-brief-text">{brief.brief}</p>
        ) : (
          <p className="home-brief-empty">
            No brief generated yet. Once Clio has client activity to summarize, your morning brief
            appears here.
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Client engagement: week strip + meetings ───────────────────────────── */

function ClientEngagement({
  meetings,
  loading,
}: {
  meetings: DashMeeting[];
  loading: boolean;
}) {
  const now = new Date();
  const days = useMemo(() => weekDays(now), [now]);
  const meetingDayKeys = useMemo(
    () => new Set(meetings.map((m) => dayKey(new Date(m.startsAt)))),
    [meetings],
  );
  const sorted = useMemo(
    () => [...meetings].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)).slice(0, 5),
    [meetings],
  );

  return (
    <div className="home-panel">
      <header className="home-panel-head">
        <span className="home-panel-title">Client Engagement</span>
        <span className="open">
          <Link to="/engagement">Open Engagement Manager →</Link>
        </span>
      </header>

      <div className="home-week-label">Meetings · This Week</div>
      <div className="home-week-strip">
        {days.map((d) => (
          <div
            key={d.key}
            className={`home-week-day${d.isToday ? ' is-today' : ''}`}
          >
            <span className="home-week-wd">{d.weekday}</span>
            <span className="home-week-num num">{d.dayNum}</span>
            {meetingDayKeys.has(d.key) ? <span className="home-week-dot" aria-hidden /> : null}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="home-panel-list">
          {[0, 1, 2].map((i) => (
            <div className="home-panel-row" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="home-panel-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No meetings scheduled this week." />
        </div>
      ) : (
        <div className="home-panel-list">
          {sorted.map((m) => {
            const status = meetingStatus(m, now);
            const channel = m.location || (m.source ? prettySource(m.source) : null);
            const who = m.organizerName || m.attendees.find((a) => a.name)?.name || m.client?.name || '';
            return (
              <Link key={m.id} to="/engagement" className="home-panel-row">
                <div className="home-panel-row-main">
                  <span className="home-meeting-when num">{meetingWhen(m.startsAt, now)}</span>
                  <span className="home-panel-row-title">{m.subject}</span>
                  <span className="home-panel-row-sub">
                    {[who, channel].filter(Boolean).join(' · ') || ' '}
                  </span>
                </div>
                <Tag color={status.color} className="home-panel-tag">
                  {status.label}
                </Tag>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Outreach drafts ────────────────────────────────────────────────────── */

function OutreachDrafts({
  records,
  loading,
}: {
  records: DashOutreach[];
  loading: boolean;
}) {
  const drafts = useMemo(
    () =>
      [...records]
        .filter((r) => r.status === 'draft')
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 5),
    [records],
  );

  return (
    <div className="home-panel">
      <header className="home-panel-head">
        <span className="home-panel-title">Outreach Drafts</span>
        <span className="open">
          <Link to="/engagement">Open Engagement Manager →</Link>
        </span>
      </header>
      {loading ? (
        <div className="home-panel-list">
          {[0, 1, 2].map((i) => (
            <div className="home-panel-row" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))}
        </div>
      ) : drafts.length === 0 ? (
        <div className="home-panel-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No outreach drafts in progress." />
        </div>
      ) : (
        <div className="home-panel-list">
          {drafts.map((r) => {
            const ready = Boolean(r.body && r.body.trim() && r.recipientCount > 0);
            const sub = r.subject || (r.recipientCount ? `${r.recipientCount} recipient${r.recipientCount === 1 ? '' : 's'}` : 'No recipients yet');
            return (
              <Link key={r.id} to="/engagement" className="home-panel-row">
                <div className="home-panel-row-main">
                  <span className="home-panel-row-title">{r.title}</span>
                  <span className="home-panel-row-sub">
                    {[r.client?.name, sub].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Tag color={ready ? 'green' : 'default'} className="home-panel-tag">
                  {ready ? 'Ready to send' : 'Draft'}
                </Tag>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Open workflows with stage pills ────────────────────────────────────── */

const WORKFLOW_STAGES = ['Research', 'Draft', 'Client review', 'Final'] as const;

function OpenWorkflows({
  workflows,
  loading,
}: {
  workflows: WorkflowInstance[];
  loading: boolean;
}) {
  const active = useMemo(
    () => workflows.filter((w) => w.status !== 'complete').slice(0, 5),
    [workflows],
  );

  return (
    <div className="home-panel">
      <header className="home-panel-head">
        <span className="home-panel-title">Open Workflows</span>
        <span className="open">
          <Link to="/workspace/workflows">Open Workspace →</Link>
        </span>
      </header>
      {loading ? (
        <div className="home-panel-list">
          {[0, 1, 2].map((i) => (
            <div className="home-panel-row" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))}
        </div>
      ) : active.length === 0 ? (
        <div className="home-panel-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active workflows. Kick one off from Workspace." />
        </div>
      ) : (
        <div className="home-panel-list">
          {active.map((w) => {
            const activeIdx = workflowStageIndex(w.status);
            return (
              <Link key={w.id} to="/workspace/workflows" className="home-workflow-row">
                <div className="home-workflow-meta">
                  <span className="home-workflow-client">{w.client?.name ?? 'Cross-client'}</span>
                  <span className="home-workflow-title">{w.title}</span>
                </div>
                <div className="home-stage-pills">
                  {WORKFLOW_STAGES.map((stage, i) => (
                    <span
                      key={stage}
                      className={`home-stage-pill ${
                        i < activeIdx ? 'is-done' : i === activeIdx ? 'is-active' : 'is-upcoming'
                      }`}
                    >
                      {stage}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Regulatory intelligence alerts ─────────────────────────────────────── */

interface AlertRow {
  id: string;
  title: string;
  priority: 'High' | 'Medium' | 'Low';
  sev: 'critical' | 'notable' | 'info';
  client: string;
  source: string;
  timing: string;
}

function RegulatoryAlerts({
  alerts,
  changes,
  clientNameById,
  loading,
}: {
  alerts: CommentAlertItem[];
  changes: IntelligenceChange[];
  clientNameById: Map<string, string>;
  loading: boolean;
}) {
  const rows = useMemo<AlertRow[]>(() => {
    const fromComments: AlertRow[] = alerts.map((a) => ({
      id: `c-${a.documentId}`,
      title: `Comment period ${deadlineLabel(a.daysToDeadline).toLowerCase().startsWith('closes') ? deadlineLabel(a.daysToDeadline).toLowerCase() : `closes in ${a.daysToDeadline}d`} — ${a.title}`,
      priority: a.daysToDeadline <= 1 ? 'High' : a.daysToDeadline <= 7 ? 'Medium' : 'Low',
      sev: a.daysToDeadline <= 1 ? 'critical' : a.daysToDeadline <= 7 ? 'notable' : 'info',
      client: a.clientName || 'no tracked clients mapped',
      source: prettySource(a.agencies[0] || a.type || 'FedReg'),
      timing: a.daysToDeadline <= 0 ? 'deadline EOD' : `${a.daysToDeadline}d`,
    }));
    const fromChanges: AlertRow[] = changes.map((c) => {
      const names = c.relatedClientIds.map((id) => clientNameById.get(id)).filter(Boolean) as string[];
      const sev = c.severity === 'critical' || c.severity === 'notable' ? c.severity : 'info';
      return {
        id: `x-${c.id}`,
        title: c.title,
        priority: sev === 'critical' ? 'High' : sev === 'notable' ? 'Medium' : 'Low',
        sev,
        client: names[0] ?? 'no tracked clients mapped',
        source: prettySource(c.source),
        timing: relativeTime(c.detectedAt),
      };
    });
    const order = { High: 0, Medium: 1, Low: 2 } as const;
    return [...fromComments, ...fromChanges]
      .sort((a, b) => order[a.priority] - order[b.priority])
      .slice(0, 5);
  }, [alerts, changes, clientNameById]);

  return (
    <div className="home-panel">
      <header className="home-panel-head">
        <span className="home-panel-title">Regulatory Intelligence Alerts</span>
        <span className="open">
          <Link to="/intelligence/changes">Open Intelligence Feed →</Link>
        </span>
      </header>
      {loading ? (
        <div className="home-panel-list">
          {[0, 1, 2].map((i) => (
            <div className="home-panel-row" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="home-panel-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No regulatory alerts right now." />
        </div>
      ) : (
        <div className="home-panel-list">
          {rows.map((r) => (
            <Link key={r.id} to="/intelligence/changes" className="home-alert-row">
              <span className={`dot ${r.sev}`} aria-hidden />
              <div className="home-alert-main">
                <span className="home-panel-row-title">{r.title}</span>
                <span className="home-panel-row-sub">
                  {r.priority} · {r.client} · {r.source} · {r.timing}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function congressSession(now: Date): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month === 0 && now.getDate() < 3 ? year - 1 : year;
  const effectiveYear = startYear % 2 === 0 ? startYear - 1 : startYear;
  const congressNumber = 1 + Math.floor((effectiveYear - 1789) / 2);
  return `${ordinal(congressNumber)} Congress`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'] as const;
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? 'th');
}

function commentSeverity(days: number): 'critical' | 'notable' | 'info' {
  if (days <= 1) return 'critical';
  if (days <= 7) return 'notable';
  return 'info';
}

function deadlineLabel(days: number): string {
  if (days <= 0) return 'closes today';
  if (days === 1) return 'closes tomorrow';
  return `${days} days`;
}

function weekBounds(now: Date): { from: string; to: string } {
  // Monday 00:00 → Sunday 23:59:59 of the current week (local time).
  const day = now.getDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

interface WeekDay {
  key: string;
  weekday: string;
  dayNum: string;
  isToday: boolean;
}

function weekDays(now: Date): WeekDay[] {
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const todayKey = dayKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      key: dayKey(d),
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
      dayNum: d.toLocaleDateString('en-US', { day: 'numeric' }),
      isToday: dayKey(d) === todayKey,
    };
  });
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function meetingWhen(startsAt: string, now: Date): string {
  const d = new Date(startsAt);
  const time = formatCompactTime(d);
  if (dayKey(d) === dayKey(now)) return `Today · ${time}`;
  const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
  if (d.getTime() < now.getTime()) return `${wd} · past`;
  return `${wd} · ${time}`;
}

function formatCompactTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const mer = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${mer}` : `${h12}:${String(m).padStart(2, '0')}${mer}`;
}

function meetingStatus(
  m: DashMeeting,
  now: Date,
): { label: string; color: string } {
  const ended = new Date(m.endsAt).getTime() < now.getTime();
  if (ended) {
    return m.debriefs.length > 0
      ? { label: 'Debriefed', color: 'green' }
      : { label: 'Debrief needed', color: 'gold' };
  }
  const prepped = m.preps.some((p) => p.status === 'approved' || p.status === 'edited' || p.status === 'generated');
  return prepped ? { label: 'Prepped', color: 'green' } : { label: 'Prep needed', color: 'gold' };
}

function workflowStageIndex(status: WorkflowInstance['status']): number {
  switch (status) {
    case 'triage': return 0;
    case 'in_progress': return 1;
    case 'review': return 2;
    case 'submitted': return 3;
    case 'complete': return WORKFLOW_STAGES.length;
    default: return 0;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function prettySource(raw: string): string {
  const map: Record<string, string> = {
    fec: 'FEC',
    sec: 'SEC EDGAR',
    fedreg: 'FedReg',
    federal_register: 'FedReg',
    congress: 'Congress.gov',
    lda: 'LDA',
    gao: 'GAO',
    crs: 'CRS',
    bls: 'BLS',
  };
  const key = (raw ?? '').toLowerCase();
  return map[key] ?? (raw ?? '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
