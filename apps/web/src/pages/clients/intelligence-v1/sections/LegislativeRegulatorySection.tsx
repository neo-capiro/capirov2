/**
 * Section 3, Legislative & Regulatory
 * Bill pipeline kanban (4 stages), regulatory lifecycle rails, and
 * upcoming hearings / markups.
 */

import { useMemo, useState } from 'react';
import type { ClientProfileV1 } from '../mappers.js';
import { BillKanban, type BillKanbanCard, type BillKanbanColumn } from '../components/BillKanban.js';
import {
  BillKanbanControls,
  type KanbanControlsValue,
} from '../components/BillKanbanControls.js';
import { RegLifecycleRail } from '../components/RegLifecycleRail.js';
import { HearingsMarkupList } from '../components/HearingsMarkupList.js';

interface LegislativeRegulatorySectionProps {
  aggregate?: ClientProfileV1;
  billDrillHref: string;
  syncCalendarHref: string;
  setAlertsHref: string;
}

const KANBAN: BillKanbanColumn[] = [
  {
    stage: 'introduced', label: 'Introduced', count: 28,
    cards: [
      { num: 'HR 7702', title: 'Mineral Provenance & Traceability Act', pct: 22, probColor: 'var(--notable)', clioTag: 'fit · 0.91' },
      { num: 'HR 5117', title: 'American Made Critical Materials Act', pct: 18, probColor: 'var(--notable)', clioTag: 'fit · 0.84' },
      { num: 'S. 2117', title: 'Industrial Base Reauthorization', pct: 31, probColor: 'var(--notable)' },
    ],
  },
  {
    stage: 'committee', label: 'In committee', count: 32,
    cards: [
      { num: 'S. 2847', title: 'Critical Minerals Stockpile Act', pct: 68, probColor: 'var(--success)', clioTag: 'fit · 0.97' },
      { num: 'HR 6112', title: 'Critical Minerals Stockpile Act (companion)', pct: 54, probColor: 'var(--success)' },
      { num: 'HR 4421', title: 'Strategic Minerals Reserve Act', pct: 47, probColor: 'var(--notable)' },
    ],
  },
  {
    stage: 'passed', label: 'Passed chamber', count: 11,
    cards: [
      { num: 'S. 1208', title: 'Defense Authorization FY27, Sec 218', pct: 82, probColor: 'var(--success)', clioTag: 'fit · 1.0' },
      { num: 'S. 1944', title: 'Supply Chain Resilience Act', pct: 71, probColor: 'var(--success)' },
    ],
  },
  {
    stage: 'enacted', label: 'Enacted', count: 4,
    cards: [{ num: 'PL 119-42', title: 'FY26 Continuing Resolution', pct: 100, probColor: 'var(--success)' }],
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
    title: 'EPA Significant New Use Rules, Chemical Substances (26-2)',
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
    title: 'EPA State Plan Approval, Kentucky Designated Facilities',
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
  { month: 'Jun', day: '03', title: 'SENR, Critical Minerals Stockpile markup', sub: "S. 2847 in chairman's mark · 4 bills on agenda", time: '10:00 AM', room: 'SR-366' },
  { month: 'Jun', day: '11', title: 'HASC full committee · FY27 NDAA', sub: "Sec 218 (Critical Minerals) in chairman's mark", time: '9:00 AM', room: '2118 RHOB' },
  { month: 'Jun', day: '17', title: 'House Approps Defense subcommittee', sub: 'FY27 appropriations markup · SIGNET program touched', time: '2:00 PM', room: '2362-B RHOB' },
];

const KANBAN_STORAGE_KEY = 'capiro:intel-v1:kanban-controls';
const DEFAULT_CONTROLS: KanbanControlsValue = { filter: 'all', sort: 'probability' };

function loadKanbanControls(): KanbanControlsValue {
  try {
    if (typeof window === 'undefined') return DEFAULT_CONTROLS;
    const raw = window.sessionStorage.getItem(KANBAN_STORAGE_KEY);
    if (!raw) return DEFAULT_CONTROLS;
    const parsed = JSON.parse(raw) as KanbanControlsValue;
    if (['all', 'high-fit', 'high-prob'].includes(parsed.filter) && ['probability', 'bill-number'].includes(parsed.sort)) {
      return parsed;
    }
  } catch {
    // ignore malformed/unavailable storage
  }
  return DEFAULT_CONTROLS;
}

function saveKanbanControls(value: KanbanControlsValue): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(KANBAN_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function applyKanbanControls(columns: BillKanbanColumn[], controls: KanbanControlsValue): BillKanbanColumn[] {
  return columns.map((col) => {
    let cards: BillKanbanCard[] = [...col.cards];

    if (controls.filter === 'high-fit') {
      cards = cards.filter((c) => c.clioTag != null);
    } else if (controls.filter === 'high-prob') {
      cards = cards.filter((c) => c.pct != null && c.pct >= 70);
    }

    if (controls.sort === 'probability') {
      cards = [...cards].sort((a, b) => {
        if (a.pct == null && b.pct == null) return 0;
        if (a.pct == null) return 1;
        if (b.pct == null) return -1;
        return b.pct - a.pct;
      });
    } else {
      cards = [...cards].sort((a, b) => a.num.localeCompare(b.num));
    }

    const count = controls.filter === 'all' ? col.count : cards.length;
    return { ...col, cards, count };
  });
}

export function LegislativeRegulatorySection({
  aggregate,
  billDrillHref,
  syncCalendarHref,
  setAlertsHref,
}: LegislativeRegulatorySectionProps) {
  const dynamicKanban = aggregate?.sections.legislativeRegulatory.kanban.columns;
  const regulatoryLifecycle = aggregate?.sections.legislativeRegulatory.regulatoryLifecycle;
  const dynamicRegs = regulatoryLifecycle?.rails;
  const dynamicHearings = aggregate?.sections.legislativeRegulatory.hearingsAndMarkups;

  const [controls, setControls] = useState<KanbanControlsValue>(loadKanbanControls);
  const handleControlsChange = (next: KanbanControlsValue) => {
    setControls(next);
    saveKanbanControls(next);
  };

  const baseKanban = useMemo<BillKanbanColumn[]>(() => {
    if (!dynamicKanban?.length) return KANBAN;
    return dynamicKanban.map((col) => ({
      stage: col.id,
      label: col.label,
      count: col.count,
      cards: col.bills.map((b) => ({
        num: b.identifier,
        title: b.title,
        pct: b.probability == null ? null : Math.round(b.probability * 100),
        probColor:
          b.probability == null
            ? undefined
            : b.probability >= 0.7
              ? 'var(--success)'
              : b.probability >= 0.4
                ? 'var(--notable)'
                : 'var(--info)',
        clioTag: b.probability != null ? `fit · ${b.probability.toFixed(2)}` : undefined,
      })),
    }));
  }, [dynamicKanban]);

  const kanbanData = useMemo(() => applyKanbanControls(baseKanban, controls), [baseKanban, controls]);

  const regsData = dynamicRegs?.length
    ? dynamicRegs.map((r) => {
        const currentIdx = r.stages.findIndex((s) => s.label === r.currentStage);
        const steps = r.stages.map((s, idx) => ({
          label: s.label,
          state:
            currentIdx < 0
              ? ('pending' as const)
              : idx < currentIdx
                ? ('done' as const)
                : idx === currentIdx
                  ? ('current' as const)
                  : ('pending' as const),
        }));

        let deadlineSeverity: 'crit' | 'warn' = 'warn';
        let deadlineText = 'No open deadline';
        if (r.deadline) {
          const deadlineDate = new Date(r.deadline);
          const days = Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          deadlineSeverity = days <= 3 ? 'crit' : 'warn';
          deadlineText = `Comment deadline · ${deadlineDate.toLocaleDateString()}`;
        }

        return {
          title: r.title,
          source: r.agencyNames.join(' / ') || 'Federal Register',
          docket: r.documentNumber,
          steps,
          deadline: deadlineText,
          deadlineSeverity,
        };
      })
    : REGS;

  const hearingsData = dynamicHearings?.length
    ? dynamicHearings.slice(0, 8).map((h) => {
        const d = new Date(h.date);
        return {
          month: d.toLocaleDateString(undefined, { month: 'short' }),
          day: d.toLocaleDateString(undefined, { day: '2-digit' }),
          title: `${h.committeeName}, ${h.title}`,
          sub: h.linkedBills.length > 0 ? `Tracked bills: ${h.linkedBills.slice(0, 3).join(', ')}` : `${h.chamber} ${h.type ?? 'hearing'}`,
          time: h.time ?? 'TBD',
          room: h.chamber,
        };
      })
    : HEARINGS;

  return (
    <section id="legislative-regulatory" className="iv1-section">
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">3</span>
        <h2>Legislative &amp; Regulatory</h2>
        <span className="iv1-sec-sub">Bill pipeline · regulation lifecycle rails · hearings</span>
      </div>

      <div className="iv1-surface">
        <div className="iv1-surface-head">
          <h3>Bill pipeline</h3>
          <span className="iv1-surface-sub">matched via embeddings · Issue-Bill Linker</span>
          <BillKanbanControls value={controls} onChange={handleControlsChange} />
        </div>
        {/* Empty state when the API returned zero tracked bills across all
            stages, typically a client that hasn't had its LDA issue codes
            confirmed yet, or one whose capability text doesn't have enough
            signal to match embedded bills. Rendering the 4 empty columns
            was confusing ("the kanban looks broken") so we replace it
            with a single CTA pointing at the mapping settings. */}
        {kanbanData.every((c) => c.count === 0) ? (
          <div
            style={{
              padding: '28px 18px',
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
              No bills tracked yet
            </div>
            <div style={{ marginBottom: 10 }}>
              The Issue-Bill Linker couldn't find legislation matching this
              client's confirmed issue codes or capability text.
            </div>
            <a className="iv1-link" href="/settings/intelligence-mappings">
              Manage source mappings →
            </a>
          </div>
        ) : (
          <BillKanban columns={kanbanData} billDrillHref={billDrillHref} />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginTop: 14 }}>
        <div className="iv1-surface">
        <div className="iv1-surface-head">
          <h3>Regulatory lifecycle</h3>
          <span className="iv1-surface-sub">
            {(regulatoryLifecycle?.totalRegulations ?? regsData.length)} rules tracked · {(regulatoryLifecycle?.totalLinkedBills ?? 0)} linked bills
          </span>
        </div>
          <RegLifecycleRail rails={regsData} />
        </div>

        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>Hearings &amp; markups</h3>
            <span className="iv1-surface-sub">next 21 days</span>
          </div>
          <HearingsMarkupList
            items={hearingsData}
            syncCalendarHref={syncCalendarHref}
            setAlertsHref={setAlertsHref}
          />
        </div>
      </div>
    </section>
  );
}
