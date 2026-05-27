import { useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Empty, Skeleton } from 'antd';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/use-api.js';
import type { Client } from './clients/clientTypes.js';
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
  // every time the changes data is refetched (every 2 min) — without this,
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

      <OvernightBand
        changes={trackedChanges}
        totalRecent={recentTotalCount}
        clients={clients.data ?? []}
        loading={recentChanges.isLoading || clients.isLoading}
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
      />

      <ComingUpStrip
        items={comingUp.data?.items ?? []}
        loading={comingUp.isLoading}
        isError={comingUp.isError}
      />
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
    hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
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

/* ── Coming Up strip ────────────────────────────────────────────────────── */

function ComingUpStrip({
  items,
  loading,
  isError,
}: {
  items: ComingUpItem[];
  loading: boolean;
  isError: boolean;
}) {
  return (
    <div>
      <header className="home-coming-head">
        <span>Coming up · next 7 days</span>
        <span className="open">
          <Link to="/intelligence">Open calendar →</Link>
        </span>
      </header>
      {loading ? (
        <div className="home-coming-grid">
          {[0, 1, 2].map((i) => (
            <div className="home-coming-card" key={i}>
              <Skeleton active paragraph={{ rows: 2 }} />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="home-coming-empty">
          <Alert
            type="error"
            message="Could not load upcoming calendar."
            description="Try refreshing in a minute."
            showIcon
          />
        </div>
      ) : items.length === 0 ? (
        <div className="home-coming-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No hearings or deadlines on the next 7 days." />
        </div>
      ) : (
        <div className="home-coming-grid">
          {items.map((item) => {
            const d = new Date(item.date);
            const dayNum = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/New_York' });
            const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
            const inner = (
              <>
                <div className="home-coming-date">
                  <span className="home-coming-date-big">{dayNum}</span>
                  <span>{weekday}</span>
                  {item.time ? <span className="num">· {item.time}</span> : null}
                  <span className={`pill ${item.severity} ml-auto`} style={{ marginLeft: 'auto' }}>
                    {item.label}
                  </span>
                </div>
                <span className="home-coming-title">{item.title}</span>
                {item.detail ? <p className="home-coming-dek">{item.detail}</p> : null}
              </>
            );
            // Internal app routes (e.g. /engagement/meetings/<id>) route
            // via React Router so the user stays inside Capiro. External
            // URLs (Congress.gov, federalregister.gov) open in a new tab.
            if (!item.href) {
              return (
                <div key={item.id} className="home-coming-card">
                  {inner}
                </div>
              );
            }
            if (item.href.startsWith('/')) {
              return (
                <Link key={item.id} to={item.href} className="home-coming-card">
                  {inner}
                </Link>
              );
            }
            return (
              <a key={item.id} className="home-coming-card" href={item.href} target="_blank" rel="noreferrer">
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Overnight band ─────────────────────────────────────────────────────── */

function OvernightBand({
  changes,
  totalRecent,
  clients,
  loading,
}: {
  changes: IntelligenceChange[];
  totalRecent: number;
  clients: Client[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="home-overnight">
        <div className="home-overnight-head">
          <span>Recent activity · last 7 days</span>
        </div>
        <div className="home-overnight-body">
          {[0, 1, 2].map((i) => (
            <div className="home-overnight-cell" key={i}>
              <Skeleton active paragraph={{ rows: 2 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!changes.length) {
    return (
      <div className="home-overnight">
        <div className="home-overnight-head">
          <span>Recent activity · last 7 days</span>
        </div>
        <div style={{ padding: 24 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No intel changes touching your tracked clients yet."
          />
        </div>
      </div>
    );
  }
  const clientById = new Map(clients.map((c) => [c.id, c.name]));
  return (
    <div className="home-overnight">
      <div className="home-overnight-head">
        <span>Recent activity · last 7 days</span>
        <span className="meta">
          {totalRecent} item{totalRecent === 1 ? '' : 's'} ·{' '}
          <Link to="/intelligence/changes" style={{ color: 'var(--ink-2)', textDecoration: 'underline' }}>
            see all →
          </Link>
        </span>
      </div>
      <div className="home-overnight-body">
        {changes.map((c) => {
          const touched = c.relatedClientIds
            .map((id) => clientById.get(id))
            .filter((n): n is string => Boolean(n));
          const meta =
            touched.length > 0
              ? `Affects ${touched.length} of your tracked client${touched.length === 1 ? '' : 's'} (${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ` +${touched.length - 3}` : ''})`
              : 'Market signal';
          const sev = severityFor(c.severity);
          return (
            <div className="home-overnight-cell" key={c.id}>
              <span className="home-overnight-eyebrow">
                <span className={`dot ${sev}`} aria-hidden />
                {prettySource(c.source)} · {relativeTime(c.detectedAt)}
              </span>
              <span className="home-overnight-title">{c.title}</span>
              <span className="home-overnight-dek">{meta}</span>
            </div>
          );
        })}
      </div>
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
}: {
  data: TodayTimeline | undefined;
  loading: boolean;
  isError: boolean;
  brief: DailyBrief | undefined;
  briefLoading: boolean;
  briefError: boolean;
  ticker: LiveTickerItem[];
  tickerLoading: boolean;
}) {
  const today = data?.today ? new Date(data.today) : new Date();
  // Always format the "Today" date in ET — the card is labeled "all times ET"
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
          <span>{beforeRange ? 'Day not started — NOW' : 'Day complete — NOW'} · {formatTime(now)}</span>
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
}: {
  brief: DailyBrief | undefined;
  briefLoading: boolean;
  briefError: boolean;
  ticker: LiveTickerItem[];
  tickerLoading: boolean;
}) {
  return (
    <aside className="home-rail">
      <p className="home-rail-title">Clio Brief</p>
      {briefLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : briefError ? (
        <p className="home-rail-empty">Clio is offline right now — check back in a minute.</p>
      ) : (
        <p className="home-rail-note">{brief?.brief ?? 'No brief generated yet.'}</p>
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
        Open Intelligence feed →
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
  // Deadlines are conceptually "end of day" — the backend stores the
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
