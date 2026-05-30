/**
 * Section 4, Relationships
 * Resolution graph (inline SVG) + office recommender ranked list.
 *
 * The knowledge graph is rendered inline within this section, not as a
 * standalone tab. Ex-staffer data surfaces in the office recommender tags.
 *
 * Issue leaderboard link: /intelligence/issues/:code when a code is present;
 * disabled intentionally when no code is available.
 */

import type { ClientProfileV1 } from '../mappers.js';
import { OfficeRecommenderList, type OfficeRecommenderRow } from '../components/OfficeRecommenderList.js';
import { ResolutionGraphCard } from '../components/ResolutionGraphCard.js';
import { KnowledgeGraphView } from '../../../intelligence/KnowledgeGraphPage.js';

interface RelationshipsSectionProps {
  aggregate?: ClientProfileV1;
  clientId: string;
  /**
   * href for the "Open issue leaderboard" link.
   * Pass an empty string to intentionally disable (no matching issue code).
   */
  issueHref: string;
  /** Whether the graph "Expand" action is available. */
  expandEnabled: boolean;
}

export function RelationshipsSection({ aggregate, clientId, issueHref, expandEnabled }: RelationshipsSectionProps) {
  const offices: OfficeRecommenderRow[] =
    aggregate?.sections.relationships.officeRecommender?.length
      ? aggregate.sections.relationships.officeRecommender.map((o, idx) => ({
          rank: idx + 1,
          name: o.office,
          sub: `${o.billCount} tracked bill${o.billCount === 1 ? '' : 's'}`,
          tags: o.tags.map((tag) => ({
            label: tag,
            variant:
              tag === 'ex-staffer'
                ? ('purple' as const)
                : tag === 'district'
                  ? ('green' as const)
                  : ('amber' as const),
          })),
          score: o.score,
        }))
      : [];

  const relationships = aggregate?.sections.relationships;
  const summary = relationships?.scopedGraph;
  const exStafferCount = relationships?.exStafferCount ?? offices.filter((office) =>
    office.tags.some((tag) => tag.label === 'ex-staffer')
  ).length;
  const issueLeaderboardHref = issueHref?.trim() || '';
  const nodeDrillBase = issueLeaderboardHref;

  return (
    <section id="relationships" className="iv1-section">
      {/* ── Section heading ── */}
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">4</span>
        <h2>Relationships</h2>
        <span className="iv1-sec-sub">Who to call · who to brief · who already touched this</span>
      </div>

      <div className="iv1-rel-layout">
        {/* Resolution graph */}
        <ResolutionGraphCard
          scopedGraph={summary}
          canExpand={expandEnabled}
          exStafferCount={exStafferCount}
          nodeDrillHrefBuilder={
            nodeDrillBase
              ? (node) => {
                  const separator = nodeDrillBase.includes('?') ? '&' : '?';
                  return `${nodeDrillBase}${separator}node=${encodeURIComponent(node.id)}`;
                }
              : undefined
          }
        />

        {/* Office recommender */}
        <div className="iv1-surface">
          <OfficeRecommenderList
            rows={offices}
            allCount={offices.length}
            allHref={issueLeaderboardHref || undefined}
            rowHrefBuilder={
              issueLeaderboardHref
                ? (row) => {
                    const base = issueLeaderboardHref;
                    const separator = base.includes('?') ? '&' : '?';
                    return `${base}${separator}office=${encodeURIComponent(row.name)}`;
                  }
                : undefined
            }
          />
        </div>
      </div>

      {/* Full knowledge graph (ReactFlow) */}
      <div className="iv1-surface" style={{ marginTop: 16, padding: 16 }}>
        <KnowledgeGraphView clientId={clientId} />
      </div>
    </section>
  );
}
