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

export function OfficeRecommenderList({
  rows,
  allCount,
  allHref,
  rowHrefBuilder,
}: OfficeRecommenderListProps) {
  const safeAllHref = allHref?.trim() || '';
  const buildRowHref = rowHrefBuilder;
  const linksEnabled = Boolean(safeAllHref) && Boolean(buildRowHref);

  return (
    <>
      <div className="iv1-surface-head">
        <h3>Office recommender</h3>
        <span className="iv1-surface-sub">top {Math.min(6, rows.length)} · weighted score</span>
        {linksEnabled ? (
          <a className="iv1-surface-right" href={safeAllHref} style={{ textDecoration: 'underline', color: 'var(--ink-2)', fontSize: 11.5 }}>
            All {allCount} →
          </a>
        ) : (
          <span className="iv1-surface-right" style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>
            All {allCount} →
          </span>
        )}
      </div>

      <div style={{ padding: '8px 16px 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Ranked: committee jurisdiction × district nexus × ex-staffer ties × MAVEN history.
      </div>

      <div>
        {rows.map((office) => {
          if (linksEnabled && buildRowHref) {
            return (
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
            );
          }

          return (
            <div
              key={office.rank}
              className="iv1-office-row"
              style={{ textDecoration: 'none', color: 'inherit', cursor: 'default' }}
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
            </div>
          );
        })}
      </div>
    </>
  );
}
