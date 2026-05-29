import { useMemo, useState, type ReactNode } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Empty, Skeleton, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/use-api.js';
import clioBubbleImage from '../assets/chat/clio-bubble.png';
import type { Client } from './clients/clientTypes.js';
import type { WorkflowInstance } from './workspace/workflowTypes.js';
import type {
  ComingUpItem,
  ComingUpResult,
  DailyBrief,
  IntelligenceChange,
} from './intelligence/types.js';

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

  // Upcoming hearings/markups (next 7 days) for the Needs-Attention banner.
  const comingUp = useQuery<ComingUpResult>({
    queryKey: ['coming-up'],
    queryFn: async () => (await api.get<ComingUpResult>('/api/intelligence/coming-up')).data,
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

      <NeedsAttention
        alerts={commentAlerts.data?.alerts ?? []}
        comingUp={comingUp.data?.items ?? []}
        changes={recentChanges.data ?? []}
        clientNameById={clientNameById}
        loading={commentAlerts.isLoading || comingUp.isLoading}
      />

      <ClioBrief brief={brief.data} loading={brief.isLoading} isError={brief.isError} />

      <div className="home-grid-2">
        <ClientEngagement meetings={meetings.data ?? []} loading={meetings.isLoading} />
        <OutreachDrafts records={outreach.data ?? []} loading={outreach.isLoading} />
      </div>

      <OpenWorkflows workflows={workflows.data ?? []} loading={workflows.isLoading} />
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

/* ── Needs Attention banner (single-row scroller, up to 10) ─────────────── */

interface BannerItem {
  id: string;
  sev: 'critical' | 'notable' | 'info';
  eyebrow: string;
  title: string;
  context: string;
  href: string;
  rank: number; // lower = more urgent within a severity tier
}

function NeedsAttention({
  alerts,
  comingUp,
  changes,
  clientNameById,
  loading,
}: {
  alerts: CommentAlertItem[];
  comingUp: ComingUpItem[];
  changes: IntelligenceChange[];
  clientNameById: Map<string, string>;
  loading: boolean;
}) {
  const items = useMemo<BannerItem[]>(() => {
    const out: BannerItem[] = [];

    // 1. Comment-period deadlines
    for (const a of alerts) {
      out.push({
        id: `c-${a.documentId}`,
        sev: commentSeverity(a.daysToDeadline),
        eyebrow: `${prettySource(a.type || a.agencies[0] || 'FedReg')} · ${deadlineLabel(a.daysToDeadline)}`,
        title: a.title,
        context: a.clientName || 'Unmapped',
        href: COMMENTS_LINK,
        rank: Math.max(0, a.daysToDeadline),
      });
    }

    // 2. Hearings + markups in the next 7 days
    for (const e of comingUp) {
      if (e.kind !== 'hearing' && e.kind !== 'markup') continue;
      const sev = e.severity === 'critical' || e.severity === 'notable' ? e.severity : 'info';
      out.push({
        id: `e-${e.id}`,
        sev,
        eyebrow: `${e.kind === 'markup' ? 'Markup' : 'Hearing'} · ${whenLabel(e.date, e.time)}`,
        title: e.title,
        context: e.label || e.detail || 'Capitol Hill',
        href: e.href ?? '/intelligence',
        rank: Math.max(0, dayDiff(e.date)),
      });
    }

    // 3. Program-element budget moves, per-bill stage alerts, high-sev reg/FEC
    for (const c of changes) {
      const sev = c.severity === 'critical' || c.severity === 'notable' ? c.severity : 'info';
      const names = c.relatedClientIds.map((id) => clientNameById.get(id)).filter(Boolean) as string[];
      if (c.source === 'program_element') {
        const pe = c.relatedPeCodes?.[0];
        out.push({
          id: `pe-${c.id}`,
          sev,
          eyebrow: `Budget · ${peChangeLabel(c.changeType)}`,
          title: c.title,
          context: pe ? `PE ${pe}` : names[0] ?? 'Tracked program',
          href: pe ? `/program-elements/${encodeURIComponent(pe)}` : '/intelligence/changes',
          rank: hoursSince(c.detectedAt),
        });
      } else if (c.source === 'congress_bill' && c.changeType.startsWith('bill_')) {
        out.push({
          id: `b-${c.id}`,
          sev,
          eyebrow: `Bill · ${relativeTime(c.detectedAt)}`,
          title: c.title,
          context: names[0] ?? (c.relatedIssues[0] ? `Issue ${c.relatedIssues[0]}` : 'Tracked bill'),
          href: '/intelligence/changes',
          rank: hoursSince(c.detectedAt),
        });
      } else if (
        (c.source === 'federal_register_document' || c.source === 'fec_contribution') &&
        sev !== 'info'
      ) {
        out.push({
          id: `r-${c.id}`,
          sev,
          eyebrow: `${prettySource(c.source)} · ${relativeTime(c.detectedAt)}`,
          title: c.title,
          context: names[0] ?? 'Unmapped',
          href: '/intelligence/changes',
          rank: hoursSince(c.detectedAt),
        });
      }
    }

    const sevRank = { critical: 0, notable: 1, info: 2 } as const;
    return out.sort((x, y) => sevRank[x.sev] - sevRank[y.sev] || x.rank - y.rank).slice(0, 10);
  }, [alerts, comingUp, changes, clientNameById]);

  return (
    <div className="home-attention">
      <div className="home-attention-head">
        <span className="home-attention-title">Needs Attention</span>
        <span className="meta">
          {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
          <Link to="/intelligence/changes" style={{ color: 'var(--ink-2)', textDecoration: 'underline' }}>
            see all →
          </Link>
        </span>
      </div>
      {loading ? (
        <div className="home-attention-scroll">
          {[0, 1, 2, 3].map((i) => (
            <div className="home-attention-card" key={i}>
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing needs your attention right now." />
        </div>
      ) : (
        <div className="home-attention-scroll">
          {items.map((it) => (
            <Link key={it.id} to={it.href} className="home-attention-card is-link">
              <span className="home-attention-eyebrow">
                <span className={`dot ${it.sev}`} aria-hidden />
                {it.eyebrow}
              </span>
              <span className="home-attention-title-row home-clamp-2">{it.title}</span>
              <span className="home-attention-dek">{it.context}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Clio brief (full width, gradient card) ─────────────────────────────── */

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
      <span className="home-brief-corner" aria-hidden />
      <div className="home-brief-top">
        <span className="home-brief-avatar">
          <img src={clioBubbleImage} alt="" aria-hidden />
        </span>
        <div className="home-brief-id">
          <span className="home-brief-kicker">Clio briefing</span>
          <span className="home-brief-date">{dateLabel}</span>
        </div>
      </div>
      <div className="home-brief-body">
        {loading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : isError ? (
          <p className="home-brief-empty">Clio is offline right now. Check back in a minute.</p>
        ) : brief?.brief ? (
          <p className="home-brief-text">{renderBrief(brief.brief)}</p>
        ) : (
          <p className="home-brief-empty">
            No brief generated yet. Once Clio has client activity to summarize, your morning brief
            appears here.
          </p>
        )}
      </div>
      <div className="home-brief-foot">
        <span className="home-brief-foot-meta">
          {brief?.model ? `Synthesized · ${brief.model}` : 'Synthesized by Clio'}
        </span>
        <Link to="/intelligence/changes" className="home-brief-foot-link">
          See all changes →
        </Link>
      </div>
    </div>
  );
}

// Heuristic highlighter: tint sentences that signal an urgent deadline (red)
// or a legislative movement (amber), approximating the designed brief card.
// The daily-brief API returns plain prose, so this is a best-effort pass;
// structured highlight spans would require a backend change.
function renderBrief(text: string): ReactNode[] {
  const urgent = /comment period|deadline|\bcloses?\b|\bdue\b|in \d+ days?\b|\btoday\b|\btomorrow\b|before EOD/i;
  const legis = /\badvanced\b|\bpassed\b|\breported\b|\bmark(ed)? ?up\b|to (the )?floor|\bcleared\b|became law|\bvote\b|\bcosponsor/i;
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  return sentences.map((s, i) => {
    if (urgent.test(s)) return <mark key={i} className="hl-urgent">{s}</mark>;
    if (legis.test(s)) return <mark key={i} className="hl-note">{s}</mark>;
    return <span key={i}>{s}</span>;
  });
}

/* ── Client engagement: week strip + per-day meetings (fixed height) ─────── */

function ClientEngagement({
  meetings,
  loading,
}: {
  meetings: DashMeeting[];
  loading: boolean;
}) {
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => weekDays(now), [now]);
  const todayKey = dayKey(now);
  const [selectedDay, setSelectedDay] = useState<string>(todayKey);

  const meetingDayKeys = useMemo(
    () => new Set(meetings.map((m) => dayKey(new Date(m.startsAt)))),
    [meetings],
  );

  const dayMeetings = useMemo(
    () =>
      meetings
        .filter((m) => dayKey(new Date(m.startsAt)) === selectedDay)
        .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)),
    [meetings, selectedDay],
  );

  return (
    <div className="home-panel home-panel--fixed">
      <header className="home-panel-head">
        <span className="home-panel-title">Client Engagement</span>
        <span className="open">
          <Link to="/engagement">Open Engagement Manager →</Link>
        </span>
      </header>

      <div className="home-week-label">Meetings · This Week</div>
      <div className="home-week-strip">
        {days.map((d) => {
          const cls = [
            'home-week-day',
            d.isToday ? 'is-today' : '',
            d.key === selectedDay ? 'is-selected' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button type="button" key={d.key} className={cls} onClick={() => setSelectedDay(d.key)}>
              <span className="home-week-wd">{d.weekday}</span>
              <span className="home-week-num num">{d.dayNum}</span>
              {meetingDayKeys.has(d.key) ? <span className="home-week-dot" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="home-panel-list">
          {[0, 1, 2].map((i) => (
            <div className="home-panel-row" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))}
        </div>
      ) : dayMeetings.length === 0 ? (
        <div className="home-panel-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`No meetings on ${selectedDayLabel(selectedDay)}.`}
          />
        </div>
      ) : (
        <div className="home-panel-list">
          {dayMeetings.map((m) => {
            const status = meetingStatus(m, now);
            const channel = m.location || (m.source ? prettySource(m.source) : null);
            const who = m.organizerName || m.attendees.find((a) => a.name)?.name || m.client?.name || '';
            return (
              <Link key={m.id} to="/engagement" className="home-panel-row">
                <div className="home-panel-row-main">
                  <span className="home-meeting-when num">{formatCompactTime(new Date(m.startsAt))}</span>
                  <span className="home-panel-row-title">{m.subject}</span>
                  <span className="home-panel-row-sub">
                    {[who, channel].filter(Boolean).join(' · ') || ' '}
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

/* ── Outreach drafts (fixed height) ─────────────────────────────────────── */

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
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [records],
  );

  return (
    <div className="home-panel home-panel--fixed">
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

/* ── Open workflows: full-width kanban + stat summary (fixed height) ─────── */

interface WorkflowColumn {
  key: WorkflowInstance['status'];
  label: string;
  tone: 'muted' | 'info' | 'notable' | 'success';
}

const WORKFLOW_COLUMNS: WorkflowColumn[] = [
  { key: 'triage', label: 'Triage', tone: 'muted' },
  { key: 'in_progress', label: 'In Progress', tone: 'info' },
  { key: 'review', label: 'Client Review', tone: 'notable' },
  { key: 'submitted', label: 'Submitted', tone: 'success' },
];

function OpenWorkflows({
  workflows,
  loading,
}: {
  workflows: WorkflowInstance[];
  loading: boolean;
}) {
  const columns = useMemo(() => {
    const map: Record<string, WorkflowInstance[]> = {
      triage: [],
      in_progress: [],
      review: [],
      submitted: [],
    };
    for (const w of workflows) {
      if (map[w.status]) map[w.status]!.push(w);
    }
    return map;
  }, [workflows]);

  const stats = useMemo(() => {
    const triage = workflows.filter((w) => w.status === 'triage').length;
    const inProgress = workflows.filter((w) => w.status === 'in_progress' || w.status === 'review').length;
    const done = workflows.filter((w) => w.status === 'submitted' || w.status === 'complete').length;
    return { triage, inProgress, done, total: triage + inProgress + done };
  }, [workflows]);

  return (
    <div className="home-panel home-workflows-panel">
      <header className="home-panel-head">
        <span className="home-panel-title">Open Workflows</span>
        <WorkflowStatBar stats={stats} />
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
      ) : stats.total === 0 ? (
        <div className="home-panel-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active workflows. Kick one off from Workspace." />
        </div>
      ) : (
        <div className="home-kanban">
          {WORKFLOW_COLUMNS.map((col) => {
            const cards = columns[col.key] ?? [];
            return (
              <div className="home-kanban-col" key={col.key}>
                <div className="home-kanban-col-head">
                  <span className={`dot ${col.tone}`} aria-hidden />
                  <span className="home-kanban-col-label">{col.label}</span>
                  <span className="home-kanban-count num">{cards.length}</span>
                </div>
                <div className="home-kanban-cards">
                  {cards.length === 0 ? (
                    <div className="home-kanban-empty">—</div>
                  ) : (
                    cards.map((w) => (
                      <Link key={w.id} to="/workspace/workflows" className="home-kanban-card">
                        <span className="home-kanban-card-client">{w.client?.name ?? 'Cross-client'}</span>
                        <span className="home-kanban-card-title">{w.title}</span>
                        <span className="home-kanban-card-sub">{w.template?.name ?? 'Workflow'}</span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkflowStatBar({
  stats,
}: {
  stats: { triage: number; inProgress: number; done: number; total: number };
}) {
  const { triage, inProgress, done, total } = stats;
  if (!total) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="home-wf-stat" aria-label="Workflow status overview">
      <div className="home-wf-stat-bar" aria-hidden>
        <span className="seg triage" style={{ width: pct(triage) }} />
        <span className="seg prog" style={{ width: pct(inProgress) }} />
        <span className="seg done" style={{ width: pct(done) }} />
      </div>
      <div className="home-wf-stat-legend">
        <span><i className="dot muted" />{triage} triage</span>
        <span><i className="dot info" />{inProgress} in progress</span>
        <span><i className="dot success" />{done} done</span>
      </div>
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

function peChangeLabel(changeType: string): string {
  switch (changeType) {
    case 'pe_mark_added': return 'New mark';
    case 'pe_mark_changed': return 'Mark changed';
    case 'pe_value_increased': return 'Value up';
    case 'pe_value_decreased': return 'Value down';
    case 'pe_milestone_slip': return 'Milestone slip';
    default: return 'Budget update';
  }
}

function dayDiff(dateIso: string): number {
  const a = new Date(dateIso);
  a.setHours(0, 0, 0, 0);
  const b = new Date();
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function whenLabel(dateIso: string, time: string | null): string {
  const t = time ? ` ${time}` : '';
  const dd = dayDiff(dateIso);
  if (dd <= 0) return `Today${t}`;
  if (dd === 1) return `Tomorrow${t}`;
  return `${new Date(dateIso).toLocaleDateString('en-US', { weekday: 'short' })}${t}`;
}

function hoursSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
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

function selectedDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map((n) => Number.parseInt(n, 10));
  if (y == null || m == null || d == null) return 'this day';
  return new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
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
