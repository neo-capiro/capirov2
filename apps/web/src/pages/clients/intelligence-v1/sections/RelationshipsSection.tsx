/**
 * Section 4 — Relationships
 * Resolution graph (inline SVG) + office recommender ranked list.
 *
 * The knowledge graph is rendered inline within this section — not as a
 * standalone tab. Ex-staffer data surfaces in the office recommender tags.
 *
 * Issue leaderboard link: /intelligence/issues/:code when a code is present;
 * disabled intentionally when no code is available.
 */

import type { ClientProfileV1 } from '../mappers.js';

interface RelationshipsSectionProps {
  aggregate?: ClientProfileV1;
  /**
   * href for the "Open issue leaderboard" link.
   * Pass an empty string to intentionally disable (no matching issue code).
   */
  issueHref: string;
  /** Whether the graph "Expand" action is available. */
  expandEnabled: boolean;
}

interface OfficeRow {
  rank: number;
  name: string;
  sub: string;
  tags: { label: string; variant: 'amber' | 'purple' | 'green' }[];
  score: number;
}

const OFFICES: OfficeRow[] = [
  { rank: 1, name: 'Sen. Lisa Murkowski (R-AK)', sub: 'SENR Chair · Critical Minerals lead', tags: [{ label: 'committee', variant: 'amber' }, { label: 'district', variant: 'green' }], score: 0.94 },
  { rank: 2, name: 'Sen. Joe Manchin (I-WV)',    sub: 'SENR · Stockpile Act sponsor', tags: [{ label: 'ex-staffer', variant: 'purple' }, { label: 'committee', variant: 'amber' }], score: 0.91 },
  { rank: 3, name: 'Rep. Pete Stauber (R-MN-08)', sub: 'HNR Subcomm. on Mining · Iron Range', tags: [{ label: 'committee', variant: 'amber' }, { label: 'district', variant: 'green' }], score: 0.88 },
  { rank: 4, name: 'Sen. James Risch (R-ID)',    sub: 'SENR · cosponsor S. 2847', tags: [{ label: 'committee', variant: 'amber' }], score: 0.79 },
  { rank: 5, name: 'Rep. Mark Amodei (R-NV-02)', sub: 'Approps · Mining caucus chair', tags: [{ label: 'ex-staffer', variant: 'purple' }, { label: 'district', variant: 'green' }], score: 0.74 },
  { rank: 6, name: 'Sen. Cynthia Lummis (R-WY)', sub: 'Banking · digital asset lead', tags: [{ label: 'district', variant: 'green' }], score: 0.68 },
];

/** Inline SVG resolution graph — static layout, no chart library */
function ResolutionGraph() {
  return (
    <div className="iv1-kg-wrap">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 800 420"
        preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', inset: 0 }}
        aria-label="Resolution graph — entity relationships"
      >
        <defs>
          <radialGradient id="kg-glow-iv1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2A57CE" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#2A57CE" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="400" cy="210" r="160" fill="url(#kg-glow-iv1)" />
        <ellipse cx="400" cy="210" rx="300" ry="155" fill="none" stroke="rgba(15,25,45,0.06)" strokeDasharray="4 6" />
        <ellipse cx="400" cy="210" rx="220" ry="115" fill="none" stroke="rgba(15,25,45,0.06)" strokeDasharray="4 6" />

        {/* LDA Registrant edges (blue) */}
        <g stroke="#2C5BD4" strokeOpacity="0.55" strokeWidth="1.4" fill="none">
          <path d="M 400 210 Q 240 190 115 170" />
          <path d="M 400 210 Q 240 230 105 250" />
        </g>
        {/* Bill edges (amber) */}
        <g stroke="#A26913" strokeOpacity="0.45" strokeWidth="1.2" fill="none">
          <path d="M 400 210 Q 480 120 590 75" />
          <path d="M 400 210 Q 525 145 660 125" />
          <path d="M 400 210 Q 535 175 690 195" />
          <path d="M 400 210 Q 475 270 590 330" />
          <path d="M 400 210 Q 455 315 530 390" />
          <path d="M 400 210 Q 360 315 275 395" />
        </g>
        {/* Lobbyist edges (purple) */}
        <g stroke="#7A3FB5" strokeOpacity="0.5" strokeWidth="1.2" fill="none">
          <path d="M 400 210 Q 315 350 195 400" />
          <path d="M 400 210 Q 375 370 355 415" />
          <path d="M 400 210 Q 435 370 455 415" />
          <path d="M 400 210 Q 285 370 245 415" />
        </g>

        {/* Center node (client) */}
        <g>
          <rect x="316" y="178" width="168" height="64" rx="10" fill="var(--bg-dark)" />
          <text x="400" y="200" textAnchor="middle" fill="#F5F2EB" fontSize="13" fontWeight="700" fontFamily="var(--font-sans-rd)">Client</text>
          <text x="400" y="218" textAnchor="middle" fill="rgba(245,242,235,0.6)" fontSize="9.5" fontFamily="var(--font-sans-rd)">SECTOR MAPPED</text>
          <text x="400" y="234" textAnchor="middle" fill="rgba(245,242,235,0.5)" fontSize="10" fontFamily="var(--font-sans-rd)">16 entities · 15 edges</text>
        </g>

        {/* Registrant node (left) */}
        <g>
          <rect x="32" y="150" width="130" height="44" rx="6" fill="var(--bg-surface)" stroke="var(--info)" strokeWidth="2.5" strokeDasharray="0" />
          <rect x="32" y="150" width="130" height="4" rx="3" fill="var(--info)" />
          <text x="97" y="170" textAnchor="middle" fill="var(--info)" fontSize="8.5" fontWeight="700" fontFamily="var(--font-sans-rd)" letterSpacing="0.06em">LDA Registrant</text>
          <text x="97" y="184" textAnchor="middle" fill="var(--ink-1)" fontSize="11" fontWeight="600" fontFamily="var(--font-sans-rd)">MAVEN ADVOCACY</text>
        </g>

        {/* Bill nodes (right) */}
        {[
          { x: 568, y: 55, num: 'S. 2847', title: 'Critical Minerals Stockpile' },
          { x: 652, y: 105, num: 'HR 6112', title: 'CM Companion' },
          { x: 668, y: 175, num: 'S. 1208', title: 'FY27 NDAA Sec 218' },
          { x: 568, y: 310, num: 'HR 4421', title: 'Strategic Minerals Reserve' },
        ].map(({ x, y, num, title }) => (
          <g key={num}>
            <rect x={x - 58} y={y - 24} width="116" height="46" rx="6" fill="var(--bg-surface)" stroke="var(--notable)" strokeWidth="1.5" />
            <rect x={x - 58} y={y - 24} width="116" height="3.5" rx="3" fill="var(--notable)" />
            <text x={x} y={y - 4} textAnchor="middle" fill="var(--notable)" fontSize="8.5" fontWeight="700" fontFamily="var(--font-mono-rd)">Bill</text>
            <text x={x} y={y + 9} textAnchor="middle" fill="var(--ink-1)" fontSize="10.5" fontWeight="600" fontFamily="var(--font-sans-rd)">{num}</text>
            <text x={x} y={y + 20} textAnchor="middle" fill="var(--ink-3)" fontSize="9" fontFamily="var(--font-sans-rd)">{title}</text>
          </g>
        ))}

        {/* Lobbyist nodes (bottom) */}
        {[
          { x: 190, y: 395, name: 'Jeff Burton', firm: 'MAVEN' },
          { x: 440, y: 415, name: 'R. Goddard', firm: 'MAVEN' },
        ].map(({ x, y, name, firm }) => (
          <g key={name}>
            <rect x={x - 52} y={y - 22} width="104" height="40" rx="6" fill="var(--bg-surface)" stroke="#7A3FB5" strokeWidth="1.5" />
            <rect x={x - 52} y={y - 22} width="104" height="3" rx="3" fill="#7A3FB5" />
            <text x={x} y={y - 4} textAnchor="middle" fill="#7A3FB5" fontSize="8.5" fontWeight="700" fontFamily="var(--font-sans-rd)">Lobbyist</text>
            <text x={x} y={y + 8} textAnchor="middle" fill="var(--ink-1)" fontSize="10.5" fontWeight="600" fontFamily="var(--font-sans-rd)">{name}</text>
            <text x={x} y={y + 18} textAnchor="middle" fill="var(--ink-3)" fontSize="9" fontFamily="var(--font-sans-rd)">{firm}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function RelationshipsSection({ aggregate, issueHref, expandEnabled }: RelationshipsSectionProps) {
  const offices =
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
      : OFFICES;

  const summary = aggregate?.sections.relationships.scopedGraph;

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
        <div className="iv1-surface" style={{ overflow: 'hidden' }}>
          <div className="iv1-surface-head">
            <h3>Resolution graph</h3>
            <span className="iv1-surface-sub">
              {summary
                ? `${summary.meta.memberCount + summary.meta.lobbyistCount + summary.meta.committeeCount} entities · ${summary.resolutionQuality.avgConfidence}% avg confidence`
                : '16 entities · 15 edges · 64% avg confidence'}
            </span>
            <span className="iv1-surface-right" style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="iv1-btn iv1-btn-sm">Reset</button>
              <button
                type="button"
                className="iv1-btn iv1-btn-sm"
                disabled={!expandEnabled}
                title={expandEnabled ? 'Expand graph' : 'Expand not available'}
              >
                Expand ↗
              </button>
            </span>
          </div>
          <ResolutionGraph />
          <div className="iv1-kg-legend">
            <span className="item"><span className="sw" style={{ background: 'var(--info)' }} />Registrant <strong>1</strong></span>
            <span className="item"><span className="sw" style={{ background: '#7A3FB5' }} />Lobbyist <strong>4</strong></span>
            <span className="item"><span className="sw" style={{ background: 'var(--notable)' }} />Bill <strong>10</strong></span>
            <span className="right">Click an entity to drill into its detail →</span>
          </div>
        </div>

        {/* Office recommender */}
        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>Office recommender</h3>
            <span className="iv1-surface-sub">top 6 · weighted score</span>
            {issueHref ? (
              <a className="iv1-surface-right" href={issueHref} style={{ textDecoration: 'underline', color: 'var(--ink-2)', fontSize: 11.5 }}>
                All 24 →
              </a>
            ) : (
              <span className="iv1-surface-right" style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>
                All 24
              </span>
            )}
          </div>
          <div style={{ padding: '8px 16px 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            Ranked: committee jurisdiction × district nexus × ex-staffer ties × MAVEN history.
          </div>
          <div>
            {offices.map((office) => (
              <div key={office.rank} className="iv1-office-row">
                <div className="iv1-office-rank">{office.rank}</div>
                <div>
                  <div className="iv1-office-name">{office.name}</div>
                  <div className="iv1-office-sub">{office.sub}</div>
                </div>
                <div className="iv1-office-tags">
                  {office.tags.map((tag) => (
                    <span key={tag.label} className={`iv1-office-tag ${tag.variant}`}>
                      {tag.label}
                    </span>
                  ))}
                </div>
                <div className="iv1-office-score num">{office.score.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
