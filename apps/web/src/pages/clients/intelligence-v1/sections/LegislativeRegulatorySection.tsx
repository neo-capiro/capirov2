/**
 * Section 3, Legislative & Regulatory
 * Bill pipeline kanban (4 stages), regulatory lifecycle rails, and
 * upcoming hearings / markups.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../../lib/use-api.js';
import { formatBillIdentifier, type ClientProfileV1 } from '../mappers.js';
import { BillKanban, type BillKanbanCard, type BillKanbanColumn } from '../components/BillKanban.js';
import {
  BillKanbanControls,
  type KanbanControlsValue,
} from '../components/BillKanbanControls.js';
import { RegLifecycleRail } from '../components/RegLifecycleRail.js';

interface LegislativeRegulatorySectionProps {
  aggregate?: ClientProfileV1;
  /** Client whose bills are shown — required for manual bill tracking. */
  clientId: string;
  billDrillHref: string;
}

// Empty pipeline scaffold — the four stage columns with zero bills.
// Rendered only as the structural basis for the "No bills tracked yet"
// empty state; never populated with placeholder/demo bills.
const EMPTY_KANBAN: BillKanbanColumn[] = [
  { stage: 'introduced', label: 'Introduced', count: 0, cards: [] },
  { stage: 'committee', label: 'In committee', count: 0, cards: [] },
  { stage: 'passed', label: 'Passed chamber', count: 0, cards: [] },
  { stage: 'enacted', label: 'Enacted', count: 0, cards: [] },
];

interface RegBlock {
  title: string;
  source: string;
  docket: string;
  steps: { label: string; state: 'done' | 'current' | 'pending' }[];
  deadline: string;
  deadlineSeverity: 'crit' | 'warn';
}

const KANBAN_STORAGE_KEY = 'capiro:intel-v1:kanban-controls';
const DEFAULT_CONTROLS: KanbanControlsValue = { filter: 'all', sort: 'probability' };

// Default view hides bills below this passage likelihood so the board leads
// with legislation that actually has momentum. A "show all" toggle reveals the
// long tail (introduced/early-committee bills) on demand.
const PROBABILITY_FLOOR = 60;

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

    // Count semantics:
    //  - filter === 'all': cards are a server-truncated preview of a larger
    //    set, so the column total (col.count) is authoritative and may exceed
    //    cards.length. BillKanban derives "+N more" from count - visible.
    //  - any active filter: filtering is applied client-side over the preview
    //    cards only, so the only honest count is the number of matching cards.
    //    Showing the server total here would imply the filter matched bills we
    //    can't actually display, and "+N more" would link nowhere real.
    const count = controls.filter === 'all' ? col.count : cards.length;
    return { ...col, cards, count };
  });
}

/**
 * Hide cards below the passage-likelihood floor. Cards with no probability
 * (pct == null) are treated as below the floor — an unknown likelihood is not
 * "momentum". When applied, the column count is reset to the number of cards
 * that survive the floor, so the "+N more" overflow never implies hidden
 * high-probability bills the user can't reach.
 */
function applyProbabilityFloor(columns: BillKanbanColumn[]): BillKanbanColumn[] {
  return columns.map((col) => {
    const cards = col.cards.filter((c) => c.pct != null && c.pct >= PROBABILITY_FLOOR);
    return { ...col, cards, count: cards.length };
  });
}

export function LegislativeRegulatorySection({
  aggregate,
  clientId,
  billDrillHref,
}: LegislativeRegulatorySectionProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const dynamicKanban = aggregate?.sections.legislativeRegulatory.kanban.columns;
  const regulatoryLifecycle = aggregate?.sections.legislativeRegulatory.regulatoryLifecycle;
  const dynamicRegs = regulatoryLifecycle?.rails;

  // Manual bill tracking: pin/unpin a specific bill for this client. On
  // success we invalidate the v1 aggregate so the kanban reflects the new
  // isManual state (pinned bills sort to the top of their column).
  const [pendingTrackIds, setPendingTrackIds] = useState<Set<string>>(new Set());
  const trackMutation = useMutation({
    mutationFn: async ({ billId, tracked }: { billId: string; tracked: boolean }) => {
      if (tracked) {
        await api.delete(`/api/intelligence/clients/${clientId}/tracked-bills/${encodeURIComponent(billId)}`);
      } else {
        await api.post(`/api/intelligence/clients/${clientId}/tracked-bills`, { billId });
      }
    },
    onMutate: ({ billId }) => {
      setPendingTrackIds((prev) => new Set(prev).add(billId));
    },
    onSuccess: (_data, { tracked }) => {
      message.success(tracked ? 'Bill untracked' : 'Bill tracked');
      // The kanban board is fed by the v1 AGGREGATE query, not the legacy
      // client-intel-v1-profile query — invalidating the latter left the board
      // stale after starring/unstarring. Invalidate the aggregate so the
      // pipeline (and its pinned-bill ordering) refreshes immediately.
      void qc.invalidateQueries({ queryKey: ['client-intel-v1-aggregate', clientId] });
    },
    onError: () => {
      message.error('Could not update bill tracking');
    },
    onSettled: (_data, _err, { billId }) => {
      setPendingTrackIds((prev) => {
        const next = new Set(prev);
        next.delete(billId);
        return next;
      });
    },
  });

  const handleToggleTrack = (billId: string, tracked: boolean) => {
    if (!clientId) return;
    trackMutation.mutate({ billId, tracked });
  };

  const [controls, setControls] = useState<KanbanControlsValue>(loadKanbanControls);
  const handleControlsChange = (next: KanbanControlsValue) => {
    setControls(next);
    saveKanbanControls(next);
  };

  // Passage-likelihood floor: default ON (hide < 60%). "Show all" reveals the
  // lower-probability long tail.
  const [showAllProbabilities, setShowAllProbabilities] = useState(false);

  const baseKanban = useMemo<BillKanbanColumn[]>(() => {
    if (!dynamicKanban?.length) return EMPTY_KANBAN;
    return dynamicKanban.map((col) => ({
      stage: col.id,
      label: col.label,
      count: col.count,
      cards: col.bills.map((b) => ({
        num: b.identifier,
        displayNum: formatBillIdentifier(b.identifier),
        title: b.title,
        isManual: b.isManual ?? false,
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

  const controlledKanban = useMemo(
    () => applyKanbanControls(baseKanban, controls),
    [baseKanban, controls],
  );
  const kanbanData = useMemo(
    () => (showAllProbabilities ? controlledKanban : applyProbabilityFloor(controlledKanban)),
    [controlledKanban, showAllProbabilities],
  );

  // How many of the currently-visible-after-controls cards fall below the
  // floor — drives the "show all (N)" toggle label. Counts only what the
  // active filter/sort would otherwise show, so the number is honest.
  const hiddenLowProbCount = useMemo(
    () =>
      controlledKanban.reduce(
        (sum, col) =>
          sum + col.cards.filter((c) => c.pct == null || c.pct < PROBABILITY_FLOOR).length,
        0,
      ),
    [controlledKanban],
  );

  // Distinguish "the client genuinely has no matched bills" (server totals all
  // zero → mapping CTA) from "every visible bill is below the probability floor"
  // (bills exist, just hidden → offer to reveal them). Without this split, a
  // client whose bills are all early-stage would see the misleading "No
  // relevant bills" mapping CTA the moment the default floor kicked in.
  const hasAnyBills = baseKanban.some((c) => c.count > 0);
  const visibleCardCount = kanbanData.reduce((sum, col) => sum + col.cards.length, 0);
  const allHiddenByFloor = hasAnyBills && !showAllProbabilities && visibleCardCount === 0;

  const regsData: RegBlock[] = dynamicRegs?.length
    ? dynamicRegs.map((r) => {
        // Match the API's currentStage against the stable stage `key` first,
        // then fall back to the display `label`. Matching on label alone is
        // brittle: any casing/whitespace/wording drift yields currentIdx = -1,
        // which renders every step as 'pending' (no progress shown at all).
        const target = (r.currentStage ?? '').trim().toLowerCase();
        const currentIdx = r.stages.findIndex(
          (s) =>
            s.key.trim().toLowerCase() === target ||
            s.label.trim().toLowerCase() === target,
        );
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
          // Dedupe agency names: the API can repeat an agency (e.g. a parent
          // department listed alongside its sub-agency), which rendered as
          // "Transportation Department / Transportation Department / …".
          source: [...new Set(r.agencyNames.map((a) => a.trim()).filter(Boolean))].join(' / ') || 'Federal Register',
          docket: r.documentNumber,
          steps,
          deadline: deadlineText,
          deadlineSeverity,
        };
      })
    : [];

  return (
    <section id="legislative-regulatory" className="iv1-section">
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">3</span>
        <h2>Legislative &amp; Regulatory</h2>
        <span className="iv1-sec-sub">Bill pipeline · regulation lifecycle rails</span>
      </div>

      <div className="iv1-surface">
        <div className="iv1-surface-head">
          <h3>Bill pipeline</h3>
          <span
            className="iv1-surface-sub"
            title="Bills are matched to this client's confirmed LDA issue codes and capability text by the Issue-Bill Linker (vector embeddings)."
          >
            matched via embeddings · Issue-Bill Linker
          </span>
          {hasAnyBills && (
            <button
              type="button"
              className="iv1-btn iv1-btn-sm"
              style={{ marginLeft: 8 }}
              aria-pressed={showAllProbabilities}
              onClick={() => setShowAllProbabilities((v) => !v)}
              title={`Passage likelihood is derived from each bill's latest action. The default view hides bills below ${PROBABILITY_FLOOR}%.`}
            >
              {showAllProbabilities
                ? `Hide < ${PROBABILITY_FLOOR}%`
                : `Show all${hiddenLowProbCount > 0 ? ` (${hiddenLowProbCount})` : ''}`}
            </button>
          )}
          <BillKanbanControls value={controls} onChange={handleControlsChange} />
        </div>

        {/* Explainer strip: what the columns / % / star mean. Concise, always
            visible above the board so the affordances are self-documenting. */}
        {hasAnyBills && (
          <div className="iv1-kanban-legend">
            Columns track each bill through{' '}
            <strong>Introduced → In committee → Passed chamber → Enacted</strong>. The{' '}
            <strong>%</strong> is the passage likelihood derived from the bill's latest action.
            Tap the <span className="iv1-kanban-legend-star">☆</span> to add or remove a bill from
            this client's tracked bills. Click a card to open its full detail.
          </div>
        )}

        {/* Three states:
            1. No matched bills at all → mapping CTA (mapping not confirmed /
               capability text too thin to match embedded bills).
            2. Bills exist but all sit below the default probability floor →
               offer to reveal them rather than implying there are none.
            3. Otherwise → render the board. */}
        {!hasAnyBills ? (
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
              No relevant bills yet
            </div>
            <div style={{ marginBottom: 10 }}>
              The Issue-Bill Linker couldn't find legislation matching this
              client's confirmed issue codes or capability text.
            </div>
            <Link className="iv1-link" to="/settings/intelligence-mappings">
              Manage source mappings →
            </Link>
          </div>
        ) : allHiddenByFloor ? (
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
              No high-probability bills right now
            </div>
            <div style={{ marginBottom: 10 }}>
              Every matched bill is below the {PROBABILITY_FLOOR}% passage-likelihood
              threshold (mostly newly introduced or early-committee legislation).
            </div>
            <button
              type="button"
              className="iv1-btn iv1-btn-sm"
              onClick={() => setShowAllProbabilities(true)}
            >
              Show all {hiddenLowProbCount} bills
            </button>
          </div>
        ) : (
          <BillKanban
            columns={kanbanData}
            billDrillHref={billDrillHref}
            onToggleTrack={handleToggleTrack}
            pendingTrackIds={pendingTrackIds}
          />
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
          {regsData.length > 0 ? (
            <RegLifecycleRail rails={regsData} />
          ) : (
            <div className="iv1-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
              <b>No regulations tracked</b>
              <span>No Federal Register rulemakings are linked to this client's tracked issues yet.</span>
            </div>
          )}
        </div>
        {/* Hearings & markups moved to the Snapshot "Top alerts" card — upcoming
            hearings now surface as time-sensitive alert rows there. */}
      </div>
    </section>
  );
}
