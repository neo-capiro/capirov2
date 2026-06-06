import { Link } from 'react-router-dom';
import { Tooltip } from 'antd';
import { HelpTip } from './HelpTip.js';
import { HELP, OFFICE_TAG_HELP, OFFICE_TAG_LABELS } from '../help-content.js';

interface OfficeTag {
  label: string;
  /** CSS modifier class appended to `.iv1-office-tag` (e.g. committee, sponsor, fec). */
  variant: string;
}

/** True for app-internal SPA routes that should navigate without a full reload. */
function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

/**
 * Render the office's signal chips. Each chip shows a readable label and, on
 * hover/focus, a plain-English explainer of what the tag means and how to use it.
 */
function renderOfficeTags(tags: OfficeTag[]) {
  return (
    <div className="iv1-office-tags">
      {tags.map((tag) => (
        <Tooltip key={tag.label} title={OFFICE_TAG_HELP[tag.variant]}>
          <span className={`iv1-office-tag ${tag.variant}`}>
            {OFFICE_TAG_LABELS[tag.variant] ?? tag.label}
          </span>
        </Tooltip>
      ))}
    </div>
  );
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
  /** Header-link label. Defaults to "All {allCount}". */
  allLabel?: string;
  rowHrefBuilder?: (row: OfficeRecommenderRow) => string;
}

export function OfficeRecommenderList({
  rows,
  allCount,
  allHref,
  allLabel,
  rowHrefBuilder,
}: OfficeRecommenderListProps) {
  const safeAllHref = allHref?.trim() || '';
  const buildRowHref = rowHrefBuilder;
  // Row links and the header link are independent: a row links only when a per-row
  // destination is provided; the header link shows whenever allHref is set.
  const rowLinksEnabled = Boolean(buildRowHref);
  const headerLabel = allLabel ? `${allLabel} →` : `All ${allCount} →`;

  return (
    <>
      <div className="iv1-surface-head">
        <h3>
          Office recommender <HelpTip title={HELP.officeRecommender} />
        </h3>
        <span className="iv1-surface-sub">top {Math.min(6, rows.length)} · weighted score</span>
        {safeAllHref ? (
          isInternalHref(safeAllHref) ? (
            <Link className="iv1-surface-right" to={safeAllHref} style={{ textDecoration: 'underline', color: 'var(--ink-2)', fontSize: 11.5 }}>
              {headerLabel}
            </Link>
          ) : (
            <a className="iv1-surface-right" href={safeAllHref} style={{ textDecoration: 'underline', color: 'var(--ink-2)', fontSize: 11.5 }}>
              {headerLabel}
            </a>
          )
        ) : null}
      </div>

      <div style={{ padding: '8px 16px 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Ranked by committee jurisdiction over tracked bills, with bill sponsor,
        district nexus, and ex-staffer ties layered in when available.
      </div>

      {rows.length === 0 ? (
        <div className="iv1-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
          <b>No office recommendations yet</b>
          <span>
            Recommendations are derived from the committees of jurisdiction over
            this client&apos;s tracked bills. Confirm this client&apos;s LDA match and
            add capabilities (with tags) in the client profile so bills get
            tracked, and ranked congressional offices will appear here.
          </span>
        </div>
      ) : (
        <div>
          {rows.map((office) => {
          if (rowLinksEnabled && buildRowHref) {
            const rowHref = buildRowHref(office);
            const rowInner = (
              <>
                <div className="iv1-office-rank">{office.rank}</div>
                <div>
                  <div className="iv1-office-name">{office.name}</div>
                  <div className="iv1-office-sub">{office.sub}</div>
                </div>
                {renderOfficeTags(office.tags)}
                <div className="iv1-office-score num">{office.score.toFixed(2)}</div>
              </>
            );
            return isInternalHref(rowHref) ? (
              <Link
                key={office.rank}
                to={rowHref}
                className="iv1-office-row"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {rowInner}
              </Link>
            ) : (
              <a
                key={office.rank}
                href={rowHref}
                className="iv1-office-row"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {rowInner}
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
              {renderOfficeTags(office.tags)}
              <div className="iv1-office-score num">{office.score.toFixed(2)}</div>
            </div>
          );
        })}
        </div>
      )}
    </>
  );
}
