/**
 * D-001 BillKanban
 * Reusable 4-column bill pipeline kanban with card drill affordance and +N overflow.
 *
 * - Renders exactly 4 stage columns in declaration order.
 * - Max 5 cards visible per column; +N overflow row shown only when count > visible.
 * - Every card is a clickable anchor; identifier is appended as ?bill= / &bill= query param.
 */

import { PassageProbabilityBar } from './PassageProbabilityBar.js';

const MAX_VISIBLE = 5;

export interface BillKanbanCard {
  /** e.g. "HR 7702" */
  num: string;
  title: string;
  /** Nullable score; missing values render safe neutral UI. */
  pct?: number | null;
  /** CSS color value, e.g. "var(--success)" */
  probColor?: string;
  clioTag?: string;
}

export interface BillKanbanColumn {
  stage: 'introduced' | 'committee' | 'passed' | 'enacted';
  label: string;
  /** Total count — may exceed the number of cards passed (drives +N overflow). */
  count: number;
  cards: BillKanbanCard[];
}

interface BillKanbanProps {
  columns: BillKanbanColumn[];
  /**
   * Base href for bill drill-out.
   * The bill identifier is appended as a query param automatically:
   *   /explorer           → /explorer?bill=HR+7702
   *   /explorer?foo=bar   → /explorer?foo=bar&bill=HR+7702
   */
  billDrillHref: string;
}

function buildBillHref(base: string, identifier: string): string {
  const encoded = encodeURIComponent(identifier);
  return base.includes('?') ? `${base}&bill=${encoded}` : `${base}?bill=${encoded}`;
}

export function BillKanban({ columns, billDrillHref }: BillKanbanProps) {
  return (
    <div className="iv1-kanban">
      {columns.map((col) => {
        const visible = col.cards.slice(0, MAX_VISIBLE);
        const overflow = col.count - visible.length;
        return (
          <div key={col.stage} className="iv1-bill-col" data-st={col.stage}>
            <div className="iv1-bill-col-head">
              <span className="iv1-bill-col-dot" />
              <span className="iv1-bill-col-title">{col.label}</span>
              <span className="iv1-bill-col-count">{col.count}</span>
            </div>

            {visible.map((card) => (
              <a
                key={card.num}
                href={buildBillHref(billDrillHref, card.num)}
                className="iv1-bill-card"
              >
                <div className="iv1-bill-num mono">{card.num}</div>
                <div className="iv1-bill-title">{card.title}</div>
                <PassageProbabilityBar score={card.pct} color={card.probColor} />
                {card.clioTag && (
                  <div className="iv1-clio-tag">
                    <span className="iv1-clio-tag-dot" />
                    {card.clioTag}
                  </div>
                )}
              </a>
            ))}

            {overflow > 0 && (
              <div className="iv1-bill-col-more">+{overflow} more</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
