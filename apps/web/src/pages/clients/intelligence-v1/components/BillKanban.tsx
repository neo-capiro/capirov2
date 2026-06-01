/**
 * D-001 BillKanban
 * Reusable 4-column bill pipeline kanban with card drill affordance and +N overflow.
 *
 * - Renders exactly 4 stage columns in declaration order.
 * - Max 5 cards visible per column; +N overflow row shown only when count > visible.
 * - Every card is a clickable anchor.
 * - Supports dedicated bill detail path templates when present (e.g. /intelligence/bills/:bill).
 * - Falls back to query-param behavior (?bill= / &bill=) for existing explorer flow.
 * - When billDrillHref is absent or malformed, falls back to /explorer?bill=<encoded>
 *   so no bill card ever dead-ends.
 */

import { Link } from 'react-router-dom';
import { PassageProbabilityBar } from './PassageProbabilityBar.js';

const MAX_VISIBLE = 5;

/** True for app-internal SPA routes that should navigate without a full reload. */
function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

export interface BillKanbanCard {
  /** e.g. "HR 7702" */
  num: string;
  title: string;
  /** Nullable score; missing values render safe neutral UI. */
  pct?: number | null;
  /** CSS color value, e.g. "var(--success)" */
  probColor?: string;
  clioTag?: string;
  /** True when the user has explicitly pinned this bill (manual tracking). */
  isManual?: boolean;
}

export interface BillKanbanColumn {
  stage: 'introduced' | 'committee' | 'passed' | 'enacted';
  label: string;
  /** Total count, may exceed the number of cards passed (drives +N overflow). */
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
  /**
   * Optional manual-tracking toggle. When provided, each card shows a
   * star button to pin/unpin the bill. `tracked` reflects the card's current
   * isManual state so the handler knows whether to add or remove.
   */
  onToggleTrack?: (billId: string, tracked: boolean) => void;
  /** Bill ids with an in-flight track/untrack mutation (disables the button). */
  pendingTrackIds?: Set<string>;
}

/** Safe fallback destination when no bill-detail route is configured. */
const EXPLORER_FALLBACK = '/explorer';

function buildBillHref(base: string, identifier: string): string {
  const encoded = encodeURIComponent(identifier);
  const rawBase = base?.trim() || '';

  // Empty or missing base → guaranteed explorer fallback; no dead-end.
  if (!rawBase) return `${EXPLORER_FALLBACK}?bill=${encoded}`;

  // Dedicated path template support.
  if (rawBase.includes(':bill')) return rawBase.replace(':bill', encoded);
  if (rawBase.includes('{bill}')) return rawBase.replace('{bill}', encoded);

  // Existing query-param fallback.
  return rawBase.includes('?') ? `${rawBase}&bill=${encoded}` : `${rawBase}?bill=${encoded}`;
}

export function BillKanban({ columns, billDrillHref, onToggleTrack, pendingTrackIds }: BillKanbanProps) {
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

            {visible.map((card, cardIdx) => {
              const href = buildBillHref(billDrillHref, card.num);
              // Composite key: bill identifiers can repeat (House/Senate
              // companions, duplicate rows), so `card.num` alone is not unique.
              const cardKey = `${col.stage}-${cardIdx}-${card.num}`;
              const isPending = pendingTrackIds?.has(card.num) ?? false;

              // Star toggle for manual tracking. Rendered as a sibling of the
              // card anchor (NOT nested inside it) so clicking the star never
              // triggers the drill-out navigation.
              const trackButton = onToggleTrack ? (
                <button
                  type="button"
                  className={`iv1-bill-track${card.isManual ? ' is-tracked' : ''}`}
                  aria-pressed={card.isManual ? true : false}
                  aria-label={card.isManual ? `Untrack ${card.num}` : `Track ${card.num}`}
                  title={card.isManual ? 'Tracked — click to untrack' : 'Track this bill'}
                  disabled={isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleTrack(card.num, Boolean(card.isManual));
                  }}
                >
                  {card.isManual ? '★' : '☆'}
                </button>
              ) : null;

              const cardInner = (
                <>
                  <div className="iv1-bill-num mono">
                    {card.num}
                    {card.isManual && <span className="iv1-bill-tracked-badge" title="Manually tracked"> ★</span>}
                  </div>
                  <div className="iv1-bill-title">{card.title}</div>
                  <PassageProbabilityBar score={card.pct} color={card.probColor} />
                  {card.clioTag && (
                    <div className="iv1-clio-tag">
                      <span className="iv1-clio-tag-dot" />
                      {card.clioTag}
                    </div>
                  )}
                </>
              );

              const cardEl =
                href && isInternalHref(href) ? (
                  <Link to={href} className="iv1-bill-card">
                    {cardInner}
                  </Link>
                ) : href ? (
                  <a href={href} className="iv1-bill-card">
                    {cardInner}
                  </a>
                ) : (
                  <div className="iv1-bill-card" aria-disabled="true">
                    {cardInner}
                  </div>
                );

              // Wrapper positions the track button over the card without
              // nesting interactive elements inside the anchor.
              return (
                <div key={cardKey} className="iv1-bill-card-wrap">
                  {cardEl}
                  {trackButton}
                </div>
              );
            })}

            {overflow > 0 && (
              <div className="iv1-bill-col-more">+{overflow} more</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
