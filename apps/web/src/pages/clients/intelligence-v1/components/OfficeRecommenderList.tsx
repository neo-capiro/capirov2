interface OfficeTag {
  label: string;
  variant: 'amber' | 'purple' | 'green';
}

export interface OfficeRecommenderRow {
  rank: number;
  name: string;
  sub: string;
  tags: OfficeTag[];
  score: number;
}

interface OfficeRecommenderListProps {
  rows: OfficeRecommenderRow[];
  allCount: number;
  allHref?: string;
  rowHrefBuilder?: (row: OfficeRecommenderRow) => string;
}

function slugifyOfficeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function OfficeRecommenderList({
  rows,
  allCount,
  allHref,
  rowHrefBuilder,
}: OfficeRecommenderListProps) {
  const safeAllHref = allHref?.trim() || '/intelligence/issues';
  const buildRowHref =
    rowHrefBuilder ??
    ((row: OfficeRecommenderRow) => `/intelligence/issues?office=${encodeURIComponent(slugifyOfficeName(row.name))}`);

  return (
    <>
      <div className="iv1-surface-head">
        <h3>Office recommender</h3>
        <span className="iv1-surface-sub">top {Math.min(6, rows.length)} · weighted score</span>
        <a className="iv1-surface-right" href={safeAllHref} style={{ textDecoration: 'underline', color: 'var(--ink-2)', fontSize: 11.5 }}>
          All {allCount} →
        </a>
      </div>

      <div style={{ padding: '8px 16px 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Ranked: committee jurisdiction × district nexus × ex-staffer ties × MAVEN history.
      </div>

      <div>
        {rows.map((office) => (
          <a
            key={office.rank}
            href={buildRowHref(office)}
            className="iv1-office-row"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
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
          </a>
        ))}
      </div>
    </>
  );
}
