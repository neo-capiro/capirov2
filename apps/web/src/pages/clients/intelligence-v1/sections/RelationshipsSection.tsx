/**
 * Section 4, Relationships
 * Office recommender ranked list — who to call / brief / who already touched this.
 *
 * The resolution graph and full knowledge graph were removed (they did not
 * work reliably); ex-staffer data still surfaces in the office recommender tags.
 *
 * Issue leaderboard link: /intelligence/issues/:code when a code is present;
 * disabled intentionally when no code is available.
 */

import type { ClientProfileV1 } from '../mappers.js';
import { OfficeRecommenderList, type OfficeRecommenderRow } from '../components/OfficeRecommenderList.js';

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

export function RelationshipsSection({ aggregate, issueHref }: RelationshipsSectionProps) {
  const offices: OfficeRecommenderRow[] =
    aggregate?.sections.relationships.officeRecommender?.length
      ? aggregate.sections.relationships.officeRecommender.map((o, idx) => {
          const isCommittee = o.tags.includes('committee');
          return {
            rank: idx + 1,
            name: o.office,
            sub: isCommittee
              ? `${o.billCount} tracked bill${o.billCount === 1 ? '' : 's'} in jurisdiction`
              : `${o.billCount} tracked bill${o.billCount === 1 ? '' : 's'}`,
            // variant is used verbatim as a `.iv1-office-tag.<variant>` CSS class.
            tags: o.tags.map((tag) => ({ label: tag, variant: tag })),
            score: o.score,
          };
        })
      : [];

  const issueLeaderboardHref = issueHref?.trim() || '';

  return (
    <section id="relationships" className="iv1-section">
      {/* ── Section heading ── */}
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">4</span>
        <h2>Relationships</h2>
        <span className="iv1-sec-sub">Who to call · who to brief · who already touched this</span>
      </div>

      {/* Office recommender */}
      <div className="iv1-surface">
        {/*
          Office rows are informational (the actionable guidance is in the per-tag
          tooltips). There is no per-office detail page, and the issue leaderboard
          ignored the old `office=` param — so rather than a misleading per-row
          drill-through, we expose one honest header link to the issue competitive
          landscape for this client's primary issue.
        */}
        <OfficeRecommenderList
          rows={offices}
          allCount={offices.length}
          allHref={issueLeaderboardHref || undefined}
          allLabel="Issue landscape"
        />
      </div>
    </section>
  );
}
