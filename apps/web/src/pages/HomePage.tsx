import { useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Empty, Skeleton, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/use-api.js';
import type { Client } from './clients/clientTypes.js';
import type { WorkflowInstance } from './workspace/workflowTypes.js';
import type {
  ComingUpItem,
  ComingUpResult,
  DailyBrief,
  IntelligenceChange,
  LiveTickerItem,
  TimelineEvent,
  TimelineEventSeverity,
  TodayTimeline,
} from './intelligence/types.js';

/* ── Comment-period alerts (Intelligence Center > Comment Deadlines) ────── */

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

const COMMENTS_LINK = '/explorer?source=comment-deadlines';

const HOUR_START = 6;
const HOUR_END = 23;
const HOUR_PX = 64;
const CLOCK_TOP_PAD = 20;
const CLOCK_BOTTOM_PAD = 28;

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

  const timeline = useQuery<TodayTimeline>({
    queryKey: ['today-timeline'],
    queryFn: async () => (await api.get<TodayTimeline>('/api/intelligence/today-timeline')).data,
    staleTime: 60_000,
    refetchInterval: 2 * 60 * 1000,
  });

  const ticker = useQuery<LiveTickerItem[]>({
    queryKey: ['live-ticker'],
    queryFn: async () => (await api.get<LiveTickerItem[]>('/api/intelligence/live-ticker')).data,
    staleTime: 60_000,
    refetchInterval: 2 * 60 * 1000,
  });

  const brief = useQuery<DailyBrief>({
    queryKey: ['daily-brief'],
    queryFn: async () => (await api.get<DailyBrief>('/api/intelligence/daily-brief')).data,
    staleTime: 10 * 60 * 1000,
  });

  const comingUp = useQuery<ComingUpResult>({
    queryKey: ['coming-up'],
    queryFn: async () => (await api.get<ComingUpResult>('/api/intelligence/coming-up')).data,
    staleTime: 5 * 60 * 1000,
  });

  // Comment-period alerts. The Dashboard "Needs Attention" zone surfaces these
  // alongside critical bill updates so users get one mixed-source action list.
  const commentAlerts = useQuery<CommentAlertsResponse>({
    queryKey: ['comment-alerts-dashboard'],
    queryFn: async () =>
      (await api.get<CommentAlertsResponse>('/api/intelligence/comment-alerts')).data,
    staleTime: 5 * 60 * 1000,
  });

  // Active workflows across ALL clients (cross-client view). The Workflows
  // tab on /workspace uses the same endpoint and filters by client there.
  const workflows = useQuery<WorkflowInstance[]>({
    queryKey: ['workflow-instances'],
    queryFn: async () => (await api.get<WorkflowInstance[]>('/api/workflows/instances')).data,
    staleTime: 30_000,
  });

  const tenantClientIds = useMemo(
    () => new Set((clients.data ?? []).filter((c) => c.status !== 'archived').map((c) => c.id)),
    [clients.data],
  );

  const trackedChanges = useMemo(() => {
    const all = recentChanges.data ?? [];
    if (!tenantClientIds.size) return all.slice(0, 3);
    const touching = all.filter((c) => c.relatedClientIds.some((id) => tenantClientIds.has(id)));
    return (touching.length ? touching : all).slice(0, 3);
  }, [recentChanges.data, tenantClientIds]);

  // Overnight = changes detected in the last 24h. Greeting copy says
  // "N new signals overnight" so the count must actually be last 24h, not
  // the 7-day window the `recentChanges` query returns. Recompute the cutoff
  // every time the changes data is refetched (every 2 min), without this,
  // an open dashboard slowly drifts as "overnight" stays pinned to mount time.
  const overnightCount = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (recentChanges.data ?? []).filter(
      (c) => new Date(c.detectedAt).getTime() >= cutoff,
    ).length;
  }, [recentChanges.data, recentChanges.dataUpdatedAt]);
  const recentTotalCount = recentChanges.data?.length ?? 0;
  const criticalTodayCount = timeline.data?.counts.critical ?? 0;
  const firstName =
    user?.firstName || (user?.fullName?.split(' ')[0] ?? null) || null;

  return (
    <section className="command-page redesign">
      <GreetingRow
        firstName={firstName}
        overnightCount={overnightCount}
        criticalToday={criticalTodayCount}
      />

      <NeedsAttention
        commentAlerts={commentAlerts.data?.alerts ?? []}
        commentAlertsLoading={commentAlerts.isLoading}
        changes={trackedChanges}
        totalRecent={recentTotalCount}
        clients={clients.data ?? []}
        changesLoading={recentChanges.isLoading || clients.isLoading}
      />

      <TodayCard
        data={timeline.data}
        loading={timeline.isLoading}
        isError={timeline.isError}
        brief={brief.data}
        briefLoading={brief.isLoading}
        briefError={brief.isError}
        ticker={ticker.data ?? []}
        tickerLoading={ticker.isLoading}
        hasClients={(clients.data ?? []).length > 0}
      />

      <div className="home-bottom-row">
        <WorkflowsPanel
          workflows={workflows.data ?? []}
          loading={workflows.isLoading}
        />
        <CalendarPanel
          items={comingUp.data?.items ?? []}
          loading={comingUp.isLoading}
          isError={comingUp.isError}
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
  // Time-aware greeting in Title Case. Boundaries: Morning before 12,
  // Afternoon 12 to 17, Evening after 17 (and before 5 wraps to Evening).
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

function congressSession(now: Date): string {
  // 1st Congress started in 1789. Each Congress spans two years and starts in
  // the odd-numbered year (Jan 3). So the Nth Congress runs from 1789+2(N-1)
  // through 1791+2(N-1).
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

/* ── Calendar panel (Coming Up next 7 days) ─────────────────────────────── */

function CalendarPanel({
  items,
  loading,
  isError,
}: {
  items: ComingUpItem[];
  loading: boolean;
  isError: boolean;
}) {
  return (
    <div className="home-calendar">
      <header className="home-calendar-head">
        <span className="home-calendar-title">Calendar</span>
        <span className="home-calendar-sub">Next 7 Days</span>
        <span className="open">
          <Link to="/intelligence">Open Calendar →</Link>
        </span>
      </header>
      {loading ? (
        <div className="home-calendar-list">
          {[0, 1, 2].map((i) => (
            <div className="home-calendar-row" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="home-calendar-empty">
          <Alert
            type="error"
            message="Could Not Load Upcoming Calendar."
            description="Try refreshing in a minute."
            showIcon
          />
        </div>
      ) : items.length === 0 ? (
        <div className="home-calendar-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No hearings or deadlines on the next 7 days."
          />
        </div>
      ) : (
        <div className="home-calendar-list">
          {items.map((item) => {
            const d = new Date(item.date);
            const dayNum = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/New_York' });
            const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
            const inner = (
              <>
                <div className="home-calendar-date">
                  <span className="home-calendar-date-big">{dayNum}</span>
                  <span className="home-calendar-date-wd">{weekday}</span>
                </div>
                <div className="home-calendar-meta">
                  <span className="home-calendar-row-title">{item.title}</span>
                  <span className="home-calendar-row-sub">
                    {item.time ? <span className="num">{item.time} · </span> : null}
                    <span className={`pill ${item.severity}`}>{item.label}</span>
                  </span>
                </div>
              </>
            );
            // Internal routes use React Router; external sources open in a new tab.
            if (!item.href) {
              return (
                <div key={item.id} className="home-calendar-row">
                  {inner}
                </div>
              );
            }
            if (item.href.startsWith('/')) {
              return (
                <Link key={item.id} to={item.href} className="home-calendar-row">
                  {inner}
                </Link>
              );
            }
            return (
              <a key={item.id} className="home-calendar-row" href={item.href} target="_blank" rel="noreferrer">
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Workflows panel (cross-client) ─────────────────────────────────────── */

function WorkflowsPanel({
  workflows,
  loading,
}: {
  workflows: WorkflowInstance[];
  loading: boolean;
}) {
  // Active = anything not yet complete. Cross-client by construction since the
  // /api/workflows/instances endpoint returns every workflow in the tenant.
  const active = useMemo(
    () => workflows.filter((w) => w.status !== 'complete' && w.status !== 'submitted'),
    [workflows],
  );
  const display = active.slice(0, 6);

  return (
    <div className="home-workflows">
      <header className="home-workflows-head">
        <span className="home-workflows-title">Active Workflows</span>
        <span className="home-workflows-sub">
          {active.length} Active · Across All Clients
        </span>
        <span className="open">
          <Link to="/workspace/workflows">Open Workspace →</Link>
        </span>
      </header>
      {loading ? (
        <div className="home-workflows-list">
          {[0, 1, 2].map((i) => (
            <div className="home-workflows-row" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))}
        </div>
      ) : !active.length ? (
        <div className="home-workflows-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No active workflows. Kick one off from Workspace."
          />
        </div>
      ) : (
        <div className="home-workflows-list">
          {display.map((w) => (
            <Link key={w.id} to="/workspace/workflows" className="home-workflows-row">
              <div className="home-workflows-row-main">
                <span className="home-workflows-row-title">{w.title}</span>
                <span className="home-workflows-row-sub">
                  {w.template?.name ?? 'Workflow'}
                  {w.client?.name ? ` · ${w.client.name}` : ''}
                </span>
              </div>
              <Tag color={workflowStatusColor(w.status)} style={{ marginLeft: 'auto' }}>
                {workflowStatusLabel(w.status)}
              </Tag>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function workflowStatusColor(s: WorkflowInstance['status']): string {
  switch (s) {
    case 'triage': return 'default';
    case 'in_progress': return 'blue';
    case 'review': return 'gold';
    case 'submitted': return 'green';
    case 'complete': return 'green';
    default: return 'default';
  }
}

function workflowStatusLabel(s: WorkflowInstance['status']): string {
  switch (s) {
    case 'triage': return 'Triage';
    case 'in_progress': return 'In Progress';
    case 'review': return 'Review';
    case 'submitted': return 'Submitted';
    case 'complete': return 'Complete';
    default: return s;
  }
}

/* ── Needs Attention zone (comments + bill updates + critical signals) ──── */

function NeedsAttention({
  commentAlerts,
  commentAlertsLoading,
  changes,
  totalRecent,
  clients,
  changesLoading,
}: {
  commentAlerts: CommentAlertItem[];
  commentAlertsLoading: boolean;
  changes: IntelligenceChange[];
  totalRecent: number;
  clients: Client[];
  changesLoading: boolean;
}) {
  // Bill updates surface as intel changes whose source is congress or whose
  // change-type mentions bill activity. We treat anything from the bill feed
  // as "needs attention" alongside the comment-period deadlines.
  const billUpdates = useMemo(
    () =>
      changes.filter((c) => {
        const src = (c.source ?? '').toLowerCase();
        return src === 'congress' || src === 'bills' || /bill/i.test(c.title ?? '');
      }),
    [changes],
  );

  const otherCriticalSignals = useMemo(
    () => changes.filter((c) => c.severity === 'critical' && !billUpdates.includes(c)),
    [changes, billUpdates],
  );

  const loading = commentAlertsLoading || changesLoading;
  const commentCount = commentAlerts.length;
  const hasAnything = commentCount > 0 || billUpdates.length > 0 || otherCriticalSignals.length > 0;
  const clientById = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div className="home-attention">
      <div className="home-attention-head">
        <span className="home-attention-title">Needs Attention</span>
        <span className="meta">
          {totalRecent} Recent Item{totalRecent === 1 ? '' : 's'} ·{' '}
          <Link to="/intelligence/changes" style={{ color: 'var(--ink-2)', textDecoration: 'underline' }}>
            See All →
          </Link>
        </span>
      </div>

      {loading ? (
        <div className="home-attention-body">
          {[0, 1, 2].map((i) => (
            <div className="home-attention-cell" key={i}>
              <Skeleton active paragraph={{ rows: 2 }} />
            </div>
          ))}
        </div>
      ) : !hasAnything ? (
        <div style={{ padding: 24 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Nothing available to view right now."
          />
        </div>
      ) : (
        <div className="home-attention-body">
          {/* Comments tile, always shown when there are comment alerts.
              Navigates to the Comment Deadlines tab in Intelligence Center. */}
          {commentCount > 0 ? (
            <Link to={COMMENTS_LINK} className="home-attention-cell is-link">
              <span className="home-attention-eyebrow">
                <span className="dot critical" aria-hidden />
                Comments · Federal Register
              </span>
              <span className="home-attention-title-row">
                {commentCount} Open Comment Period{commentCount === 1 ? '' : 's'}
              </span>
              <span className="home-attention-dek">
                {commentAlerts[0]?.title ?? 'Open the Intelligence Center to respond before the window closes.'}
              </span>
            </Link>
          ) : null}

          {/* Bill updates */}
          {billUpdates.slice(0, commentCount > 0 ? 2 : 3).map((c) => {
            const touched = c.relatedClientIds
              .map((id) => clientById.get(id))
              .filter((n): n is string => Boolean(n));
            const meta =
              touched.length > 0
                ? `Affects ${touched.length} Of Your Tracked Client${touched.length === 1 ? '' : 's'} (${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ` +${touched.length - 3}` : ''})`
                : 'Bill Update';
            const sev = severityFor(c.severity);
            return (
              <Link
                key={c.id}
                to="/intelligence/changes"
                className="home-attention-cell is-link"
              >
                <span className="home-attention-eyebrow">
                  <span className={`dot ${sev}`} aria-hidden />
                  Bill Update · {prettySource(c.source)}
                </span>
                <span className="home-attention-title-row">{c.title}</span>
                <span className="home-attention-dek">{meta}</span>
              </Link>
            );
          })}

          {/* Other critical signals fill remaining slots */}
          {otherCriticalSignals
            .slice(0, Math.max(0, 3 - (commentCount > 0 ? 1 : 0) - Math.min(billUpdates.length, commentCount > 0 ? 2 : 3)))
            .map((c) => {
              const touched = c.relatedClientIds
                .map((id) => clientById.get(id))
                .filter((n): n is string => Boolean(n));
              const meta =
                touched.length > 0
                  ? `Affects ${touched.length} Of Your Tracked Client${touched.length === 1 ? '' : 's'} (${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ` +${touched.length - 3}` : ''})`
                  : 'Market Signal';
              const sev = severityFor(c.severity);
              return (
                <Link
                  key={c.id}
                  to="/intelligence/changes"
                  className="home-attention-cell is-link"
                >
                  <span className="home-attention-eyebrow">
                    <span className={`dot ${sev}`} aria-hidden />
                    {prettySource(c.source)} · {relativeTime(c.detectedAt)}
                  </span>
                  <span className="home-attention-title-row">{c.title}</span>
                  <span className="home-attention-dek">{meta}</span>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ── Today card ─────────────────────────────────────────────────────────── */

function TodayCard({
  data,
  loading,
  isError,
  brief,
  briefLoading,
  briefError,
  ticker,
  tickerLoading,
  hasClients,
}: {
  data: TodayTimeline | undefined;
  loading: boolean;
  isError: boolean;
  brief: DailyBrief | undefined;
  briefLoading: boolean;
  briefError: boolean;
  ticker: LiveTickerItem[];
  tickerLoading: boolean;
  hasClients: boolean;
}) {
  const today = data?.today ? new Date(data.today) : new Date();
  // Always format the "Today" date in ET, the card is labeled "all times ET"
  // and the day boundary on the backend is also ET. Without this, a browser
  // in PST renders "May 23" while the backend served the May 24 ET timeline.
  const dateLabel = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
  const events = data?.events ?? [];
  const now = new Date();

  return (
    <div className="home-today">
      <div className="home-today-head">
        <span className="home-today-dot" aria-hidden />
        <h2 className="home-today-title">Today</h2>
        <span className="home-today-sub">{dateLabel} · all times ET</span>
        <span className="home-today-counts">
          <SeverityPill severity="critical" count={data?.counts.critical ?? 0} />
          <SeverityPill severity="notable" count={data?.counts.notable ?? 0} />
          <SeverityPill severity="info" count={data?.counts.info ?? 0} />
        </span>
      </div>
      <div className="home-today-body">
        <div className="home-clock-scroll">
          <ClockSpine events={events} now={now} loading={loading} isError={isError} />
        </div>
        <Rail
          brief={brief}
          briefLoading={briefLoading}
          briefError={briefError}
          ticker={ticker}
          tickerLoading={tickerLoading}
          hasClients={hasClients}
        />
      </div>
    </div>
  );
}

/* ── Clock spine ────────────────────────────────────────────────────────── */

function ClockSpine({
  events,
  now,
  loading,
  isError,
}: {
  events: TimelineEvent[];
  now: Date;
  loading: boolean;
  isError: boolean;
}) {
  const hours: number[] = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);

  const clockHeight = CLOCK_TOP_PAD + (HOUR_END - HOUR_START + 1) * HOUR_PX + CLOCK_BOTTOM_PAD;

  const nowHour = now.getHours();
  const nowMin = now.getMinutes();
  const insideRange = nowHour >= HOUR_START && nowHour <= HOUR_END;
  const beforeRange = nowHour < HOUR_START;
  const nowY = yFromTime(nowHour, nowMin);

  if (loading) {
    return (
      <div style={{ padding: '24px 24px 24px 78px' }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }
  if (isError) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message="Failed to load today's timeline." showIcon />
      </div>
    );
  }
  if (!events.length) {
    return (
      <div style={{ padding: 40, display: 'grid', placeItems: 'center' }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing scheduled. The day is yours." />
      </div>
    );
  }

  return (
    <div className="home-clock" style={{ height: clockHeight }}>
      {hours.map((h) => (
        <div key={h} className="home-clock-row" style={{ height: HOUR_PX }}>
          <div className="home-clock-line" />
          <span className="home-clock-hour">{String(h).padStart(2, '0')}:00</span>
        </div>
      ))}

      {events.map((event) => {
        const { h, m } = eventHourMinute(event);
        const top = yFromTime(h, m);
        const sev = severityFor(event.severity);
        const Content = (
          <article className={`home-evt sev-${sev}`} style={{ top }}>
            <header className="home-evt-head">
              <span className={`dot ${sev}`} aria-hidden />
              <span className="home-evt-source">{event.label}</span>
              {event.time ? <span className="home-evt-time num">{event.time}</span> : null}
            </header>
            <span className="home-evt-title">{event.title}</span>
            {event.detail ? <p className="home-evt-dek">{event.detail}</p> : null}
          </article>
        );
        return event.href ? (
          <a key={event.id} href={event.href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            {Content}
          </a>
        ) : (
          <div key={event.id}>{Content}</div>
        );
      })}

      {insideRange ? (
        <div className="home-now-line" style={{ top: nowY }}>
          <span className="home-now-chip">NOW · {formatTime(now)}</span>
        </div>
      ) : (
        <div className={`home-now-edge ${beforeRange ? 'top' : 'bottom'}`}>
          <span>{beforeRange ? 'Day not started, NOW' : 'Day complete, NOW'} · {formatTime(now)}</span>
        </div>
      )}
    </div>
  );
}

/* ── Right rail ─────────────────────────────────────────────────────────── */

function Rail({
  brief,
  briefLoading,
  briefError,
  ticker,
  tickerLoading,
  hasClients,
}: {
  brief: DailyBrief | undefined;
  briefLoading: boolean;
  briefError: boolean;
  ticker: LiveTickerItem[];
  tickerLoading: boolean;
  hasClients: boolean;
}) {
  // Empty-state copy varies depending on whether the tenant has any clients
  // yet. With zero clients there is nothing for Clio to brief on, so we use
  // the onboarding-flavored message the spec calls out.
  const briefEmpty = hasClients
    ? 'No brief generated yet.'
    : 'No active clients yet. Once you add a client, Clio will generate a daily brief here each morning.';

  return (
    <aside className="home-rail">
      <p className="home-rail-title">Your Daily Intelligence</p>
      {briefLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : briefError ? (
        <p className="home-rail-empty">Clio is offline right now. Check back in a minute.</p>
      ) : (
        <p className="home-rail-note">{brief?.brief ?? briefEmpty}</p>
      )}
      <Link to="/intelligence" className="home-rail-cta">
        ✦ Open Intelligence Center
      </Link>

      <div className="home-rail-divider" />

      <p className="home-rail-title">Live Ticker</p>
      {tickerLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : !ticker.length ? (
        <p className="home-rail-empty">Quiet on the wires.</p>
      ) : (
        <ul className="home-ticker-list">
          {ticker.slice(0, 6).map((item) => (
            <li key={item.id} className="home-ticker-item">
              <span className="home-ticker-time">{formatTickerTime(item.detectedAt)}</span>
              <span className="home-ticker-body">
                <b>{prettySource(item.source)}:</b> {item.title}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/intelligence/changes" className="home-ticker-link">
        Open Intelligence Feed →
      </Link>
    </aside>
  );
}

/* ── Bits ───────────────────────────────────────────────────────────────── */

function SeverityPill({
  severity,
  count,
}: {
  severity: TimelineEventSeverity;
  count: number;
}) {
  return (
    <span className={`pill ${severity}`}>
      {count} {severity}
    </span>
  );
}

function severityFor(raw: string): TimelineEventSeverity {
  if (raw === 'critical' || raw === 'notable' || raw === 'info') return raw;
  return 'info';
}

function eventHourMinute(event: TimelineEvent): { h: number; m: number } {
  // Deadlines are conceptually "end of day", the backend stores the
  // comment-period close as UTC midnight of the next day, which parses to
  // 8pm ET in a browser. Pin to HOUR_END so the card appears at the bottom
  // of the spine, matching the spec's "23:59 ET" deadline placement.
  if (event.kind === 'deadline' || event.time === 'before EOD') {
    return { h: HOUR_END, m: 59 };
  }
  if (event.time) {
    const match = event.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM|ET)?/i);
    if (match && match[1] && match[2]) {
      let hour = Number.parseInt(match[1], 10);
      const min = Number.parseInt(match[2], 10);
      const meridiem = match[3]?.toUpperCase();
      if (meridiem === 'PM' && hour < 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;
      if (Number.isFinite(hour) && Number.isFinite(min)) {
        return { h: clampHour(hour), m: min };
      }
    }
  }
  // Parse the timestamp in ET so the event lands on its ET wall-clock hour
  // regardless of the browser's locale.
  const d = new Date(event.timestamp);
  if (Number.isNaN(d.getTime())) return { h: HOUR_START, m: 0 };
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const hh = Number.parseInt(etParts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const mm = Number.parseInt(etParts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return {
    h: clampHour(Number.isFinite(hh) ? hh : HOUR_START),
    m: Number.isFinite(mm) ? mm : 0,
  };
}

function clampHour(h: number): number {
  return Math.min(Math.max(h, HOUR_START), HOUR_END);
}

function yFromTime(h: number, m: number): number {
  return CLOCK_TOP_PAD + ((h - HOUR_START) * HOUR_PX) + (m / 60) * HOUR_PX;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTickerTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
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
  const key = raw.toLowerCase();
  return map[key] ?? raw.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
