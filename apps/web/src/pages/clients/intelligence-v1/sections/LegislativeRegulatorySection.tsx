/**
 * Section 3 — Legislative & Regulatory
 * Bill pipeline kanban (4 stages), regulatory lifecycle rails, and
 * upcoming hearings / markups.
 *
 * Bill detail links fall back to /explorer since a dedicated bill-detail
 * route is not guaranteed. Any bill-level action without a real destination
 * is routed to /explorer intentionally.
 */

import type { ClientProfileV1 } from '../mappers.js';

interface LegislativeRegulatorySectionProps {
  aggregate?: ClientProfileV1;
  /** href for bill drill-out (fallback: /explorer) */
  billDrillHref: string;
  /** href for calendar sync action */
  syncCalendarHref: string;
  /** href for setting hearing alerts */
  setAlertsHref: string;
}

type BillStage = 'introduced' | 'committee' | 'passed' | 'enacted';

interface BillCard {
  num: string;
  title: string;
  pct: number;
  probColor: string;
  clioTag?: string;
}

interface KanbanCol {
  stage: BillStage;
  label: string;
  count: number;
  cards: BillCard[];
}

const KANBAN: KanbanCol[] = [
  {
    stage: 'introduced', label: 'Introduced', count: 28,
    cards: [
      { num: 'HR 7702', title: 'Mineral Provenance & Traceability Act', pct: 22, probColor: 'var(--notable)', clioTag: 'fit · 0.91' },
      { num: 'HR 5117', title: 'American Made Critical Materials Act',   pct: 18, probColor: 'var(--notable)', clioTag: 'fit · 0.84' },
      { num: 'S. 2117', title: 'Industrial Base Reauthorization',         pct: 31, probColor: 'var(--notable)' },
    ],
  },
  {
    stage: 'committee', label: 'In committee', count: 32,
    cards: [
      { num: 'S. 2847', title: 'Critical Minerals Stockpile Act',        pct: 68, probColor: 'var(--success)', clioTag: 'fit · 0.97' },
      { num: 'HR 6112', title: 'Critical Minerals Stockpile Act (companion)', pct: 54, probColor: 'var(--success)' },
      { num: 'HR 4421', title: 'Strategic Minerals Reserve Act',          pct: 47, probColor: 'var(--notable)' },
    ],
  },
  {
    stage: 'passed', label: 'Passed chamber', count: 11,
    cards: [
      { num: 'S. 1208', title: 'Defense Authorization FY27 — Sec 218', pct: 82, probColor: 'var(--success)', clioTag: 'fit · 1.0' },
      { num: 'S. 1944', title: 'Supply Chain Resilience Act',           pct: 71, probColor: 'var(--success)' },
    ],
  },
  {
    stage: 'enacted', label: 'Enacted', count: 4,
    cards: [
      { num: 'PL 119-42', title: 'FY26 Continuing Resolution', pct: 100, probColor: 'var(--success)' },
    ],
  },
];

interface RegBlock {
  title: string;
  source: string;
  docket: string;
  steps: { label: string; state: 'done' | 'current' | 'pending' }[];
  deadline: string;
  deadlineSeverity: 'crit' | 'warn';
}

const REGS: RegBlock[] = [
  {
    title: 'EPA Significant New Use Rules — Chemical Substances (26-2)',
    source: 'EPA · Federal Register',
    docket: 'EPA-HQ-OPPT-2026-0214',
    steps: [
      { label: 'ANPRM', state: 'done' },
      { label: 'NPRM · comment open', state: 'current' },
      { label: 'Final rule', state: 'pending' },
      { label: 'Effective', state: 'pending' },
    ],
    deadline: 'Comment deadline · 2 days',
    deadlineSeverity: 'crit',
  },
  {
    title: 'EPA State Plan Approval — Kentucky Designated Facilities',
    source: 'EPA · Federal Register',
    docket: 'EPA-R04-OAR-2026-0188',
    steps: [
      { label: 'ANPRM', state: 'done' },
      { label: 'NPRM · comment open', state: 'current' },
      { label: 'Final rule', state: 'pending' },
      { label: 'Effective', state: 'pending' },
    ],
    deadline: 'Comment deadline · 2 days',
    deadlineSeverity: 'crit',
  },
  {
    title: 'EPA Drinking Water Contaminant Candidate List 6-Draft',
    source: 'EPA · Federal Register',
    docket: 'EPA-HQ-OW-2026-0091',
    steps: [
      { label: 'ANPRM', state: 'done' },
      { label: 'NPRM', state: 'current' },
      { label: 'Final rule', state: 'pending' },
      { label: 'Effective', state: 'pending' },
    ],
    deadline: 'Comment deadline · 12 days',
    deadlineSeverity: 'warn',
  },
];

const HEARINGS = [
  { month: 'Jun', day: '03', title: 'SENR — Critical Minerals Stockpile markup', sub: 'S. 2847 in chairman\'s mark · 4 bills on agenda', time: '10:00 AM', room: 'SR-366' },
  { month: 'Jun', day: '11', title: 'HASC full committee · FY27 NDAA', sub: 'Sec 218 (Critical Minerals) in chairman\'s mark', time: '9:00 AM', room: '2118 RHOB' },
  { month: 'Jun', day: '17', title: 'House Approps Defense subcommittee', sub: 'FY27 appropriations markup · SIGNET program touched', time: '2:00 PM', room: '2362-B RHOB' },
];

/** Clock icon */
function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function LegislativeRegulatorySection({
  aggregate,
  billDrillHref,
  syncCalendarHref,
  setAlertsHref,
}: LegislativeRegulatorySectionProps) {
  const dynamicKanban = aggregate?.sections.legislativeRegulatory.kanban.columns;
  const dynamicRegs = aggregate?.sections.legislativeRegulatory.regulatoryLifecycle.rails;
  const dynamicHearings = aggregate?.sections.legislativeRegulatory.hearingsAndMarkups;

  const kanbanData: KanbanCol[] = dynamicKanban?.length
    ? dynamicKanban.map((col) => ({
        stage: col.id,
        label: col.label,
        count: col.count,
        cards: col.bills.slice(0, 5).map((b) => ({
          num: b.identifier,
          title: b.title,
          pct: Math.round((b.probability ?? 0) * 100),
          probColor:
            (b.probability ?? 0) >= 0.7
              ? 'var(--success)'
              : (b.probability ?? 0) >= 0.4
                ? 'var(--notable)'
                : 'var(--info)',
          clioTag: b.probability != null ? `fit · ${b.probability.toFixed(2)}` : undefined,
        })),
      }))
    : KANBAN;

  const regsData = dynamicRegs?.length
    ? dynamicRegs.map((r) => ({
        title: r.title,
        source: r.agencyNames.join(' / ') || 'Federal Register',
        docket: r.documentNumber,
        steps: r.stages.map((s) => ({
          label: s.label,
          state:
            s.label === r.currentStage
              ? ('current' as const)
              : ('pending' as const),
        })),
        deadline: r.deadline ? `Comment deadline · ${new Date(r.deadline).toLocaleDateString()}` : 'No open deadline',
        deadlineSeverity: r.deadline ? ('warn' as const) : ('warn' as const),
      }))
    : REGS;

  const hearingsData = dynamicHearings?.length
    ? dynamicHearings.slice(0, 8).map((h) => {
        const d = new Date(h.date);
        const month = d.toLocaleDateString(undefined, { month: 'short' });
        const day = d.toLocaleDateString(undefined, { day: '2-digit' });
        return {
          month,
          day,
          title: `${h.committeeName} — ${h.title}`,
          sub:
            h.linkedBills.length > 0
              ? `Tracked bills: ${h.linkedBills.slice(0, 3).join(', ')}`
              : `${h.chamber} ${h.type ?? 'hearing'}`,
          time: h.time ?? 'TBD',
          room: h.chamber,
        };
      })
    : HEARINGS;

  return (
    <section id="legislative-regulatory" className="iv1-section">
      {/* ── Section heading ── */}
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">3</span>
        <h2>Legislative &amp; Regulatory</h2>
        <span className="iv1-sec-sub">Bill pipeline · regulation lifecycle rails · hearings</span>
      </div>

      {/* ── Bill pipeline kanban ── */}
      <div className="iv1-surface">
        <div className="iv1-surface-head">
          <h3>Bill pipeline</h3>
          <span className="iv1-surface-sub">matched via embeddings · Issue-Bill Linker</span>
          <span className="iv1-surface-right" style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="iv1-btn iv1-btn-sm">Filter</button>
            <button type="button" className="iv1-btn iv1-btn-sm">Sort: passage probability ▾</button>
          </span>
        </div>
        <div className="iv1-kanban">
          {kanbanData.map((col) => (
            <div key={col.stage} className="iv1-bill-col" data-st={col.stage}>
              <div className="iv1-bill-col-head">
                <span className="iv1-bill-col-dot" />
                <span className="iv1-bill-col-title">{col.label}</span>
                <span className="iv1-bill-col-count">{col.count}</span>
              </div>
              {col.cards.map((card) => (
                <a
                  key={card.num}
                  href={billDrillHref}
                  className="iv1-bill-card"
                >
                  <div className="iv1-bill-num mono">{card.num}</div>
                  <div className="iv1-bill-title">{card.title}</div>
                  <div className="iv1-bill-prob-row">
                    <div className="iv1-bill-prob-track">
                      <div className="iv1-bill-prob-fill" style={{ width: `${card.pct}%`, background: card.probColor }} />
                    </div>
                    <span className="iv1-bill-pct num">{card.pct}%</span>
                  </div>
                  {card.clioTag && (
                    <div className="iv1-clio-tag">
                      <span className="iv1-clio-tag-dot" />
                      {card.clioTag}
                    </div>
                  )}
                </a>
              ))}
              <div className="iv1-bill-col-more">
                +{col.count - col.cards.length} more
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom: Reg lifecycle + Hearings ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginTop: 14 }}>
        {/* Regulatory lifecycle */}
        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>Regulatory lifecycle</h3>
            <span className="iv1-surface-sub">3 rules tracked · 2 deadline-critical</span>
          </div>
          {regsData.map((reg) => (
            <div key={reg.docket} className="iv1-reg-block">
              <h4 className="iv1-reg-title">{reg.title}</h4>
              <div className="iv1-reg-source mono">
                <strong style={{ fontFamily: 'var(--font-sans-rd)', fontWeight: 500 }}>{reg.source}</strong>
                {' · '}Docket {reg.docket}
              </div>
              <div className="iv1-lifecycle-rail">
                {reg.steps.map((step, i) => (
                  <div key={`${reg.docket}-${step.label}`} style={{ display: 'contents' }}>
                    <div className={`iv1-lifecycle-step ${step.state}`}>{step.label}</div>
                    {i < reg.steps.length - 1 && <span className="iv1-lifecycle-arrow">→</span>}
                  </div>
                ))}
              </div>
              <div className={`iv1-reg-deadline ${reg.deadlineSeverity}`}>
                <ClockIcon />
                <strong>{reg.deadline}</strong>
                {reg.deadlineSeverity === 'crit' && ' · not filed yet'}
              </div>
            </div>
          ))}
        </div>

        {/* Hearings & markups */}
        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>Hearings &amp; markups</h3>
            <span className="iv1-surface-sub">next 21 days</span>
          </div>
          {hearingsData.map((h) => (
            <div key={`${h.month}-${h.day}`} className="iv1-hearing-row">
              <div className="iv1-hearing-date">
                <div className="m">{h.month}</div>
                <div className="d num">{h.day}</div>
              </div>
              <div>
                <div className="iv1-hearing-title">{h.title}</div>
                <div className="iv1-hearing-sub">{h.sub}</div>
              </div>
              <div className="iv1-hearing-time num">
                {h.time}<br />{h.room}
              </div>
            </div>
          ))}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-1)', display: 'flex', gap: 8 }}>
            <a href={syncCalendarHref} className="iv1-btn iv1-btn-sm" style={{ textDecoration: 'none' }}>
              Sync to calendar
            </a>
            <a href={setAlertsHref} className="iv1-btn iv1-btn-sm" style={{ textDecoration: 'none' }}>
              Set alerts
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
