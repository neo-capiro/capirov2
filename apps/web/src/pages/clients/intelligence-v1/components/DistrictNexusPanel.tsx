/**
 * C-004, District Nexus Panel
 *
 * Top congressional districts inferred from capability / district nexus
 * free-text.  Renders up to 5 horizontal job-count bars sorted descending
 * by total supported jobs, plus an inference-context note and a support
 * link for adding confirmed capability tags.
 */
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ClientProfileV1 } from '../mappers.js';
import { HelpTip } from './HelpTip.js';
import { HELP } from '../help-content.js';

type DistrictNexus = ClientProfileV1['sections']['financialFootprint']['districtNexus'];

/** True for app-internal SPA routes that should navigate without a full reload. */
function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

/** Render an internal route as a react-router Link, external as a plain anchor. */
function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return isInternalHref(href) ? (
    <Link to={href} className={className}>{children}</Link>
  ) : (
    <a href={href} className={className}>{children}</a>
  );
}

interface DistrictNexusPanelProps {
  /** districtNexus payload from the aggregate profile-v1 endpoint. */
  districtNexus: DistrictNexus | undefined;
  /** href used by the "Add to capability tags →" support link. */
  supportHref: string;
}

function formatJobs(jobs: number): string {
  if (!Number.isFinite(jobs) || jobs <= 0) return '-';
  if (jobs >= 1_000_000) return `${(jobs / 1_000_000).toFixed(1)}M`;
  if (jobs >= 1_000) return `${Math.round(jobs / 1_000)}k`;
  return `${Math.round(jobs)}`;
}

/** Compact USD formatter for district contract spend (e.g. $4.2M, $850k). */
function formatSpend(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0';
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return `$${Math.round(amount)}`;
}

export function DistrictNexusPanel({ districtNexus, supportHref }: DistrictNexusPanelProps) {
  const sourceRows = districtNexus?.topDistricts ?? [];
  // Spend-driven rows (real USAspending place-of-performance dollars) take
  // precedence over the free-text job estimates: if ANY row carries a spend
  // figure the panel renders contract dollars; otherwise it falls back to the
  // capability-derived job counts.
  const isSpend = sourceRows.some((r) => (r.spend ?? 0) > 0);
  // Only treat capabilities as a fallback when they carry an actual
  // district-nexus narrative. Listing capabilities that have no CD detail
  // reads as irrelevant noise under a "District nexus" heading, so those
  // fall through to the clean empty state instead.
  const capsWithNexus = (districtNexus?.capabilities ?? []).filter(
    (c) => (c.districtNexus ?? '').trim().length > 0,
  );

  // Sort descending by the active metric (spend $ or jobs), take top 5,
  // normalise bar widths against the leader.
  const metric = (r: { jobs: number; spend?: number }) => (isSpend ? (r.spend ?? 0) : r.jobs);
  const rows = [...sourceRows]
    .sort((a, b) => metric(b) - metric(a))
    .slice(0, 5)
    .map((row, idx, arr) => {
      const baseline = Math.max(metric(arr[0] ?? { jobs: 0 }) || 1, 1);
      const pct = Math.max(6, Math.min(100, Math.round((metric(row) / baseline) * 100)));
      return {
        key: `${row.district}-${idx}`,
        district: row.district,
        capability: row.capability,
        jobs: row.jobs,
        spend: row.spend ?? 0,
        awardCount: row.awardCount ?? 0,
        pct,
      };
    });

  return (
    <div className="iv1-surface iv1-district-panel">
      <div className="iv1-surface-head">
        <h3>District nexus <HelpTip title={HELP.districtNexus} /></h3>
        <span className="iv1-surface-sub">{isSpend ? 'contract spend by CD' : 'jobs & ops by CD'}</span>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="iv1-district-body">
            {rows.map((row) => (
              <div key={row.key} className="iv1-district-row">
                <div className="iv1-district-meta">
                  <strong className="iv1-district-code">{row.district}</strong>
                  <span className="iv1-district-cap">
                    {isSpend
                      ? `(${row.awardCount} award${row.awardCount === 1 ? '' : 's'})`
                      : `(${row.capability})`}
                  </span>
                </div>
                <div className="iv1-district-bar-track">
                  <div className="iv1-district-bar-fill" style={{ width: `${row.pct}%` }} />
                </div>
                <span className="iv1-district-jobs num">
                  {isSpend ? formatSpend(row.spend) : formatJobs(row.jobs)}
                </span>
              </div>
            ))}
          </div>

          <div className="iv1-district-foot">
            {isSpend ? (
              <>Federal contract spend (USAspending) by place-of-performance district.</>
            ) : (
              <>
                Inferred from capability/district nexus text.{' '}
                <SmartLink href={supportHref} className="iv1-link">
                  Add to capability tags →
                </SmartLink>{' '}
                for confirmed counts.
              </>
            )}
          </div>
        </>
      ) : capsWithNexus.length > 0 ? (
        // No census-joined district rows yet, but some capabilities carry a
        // real district-nexus narrative. Surface only those (never empty
        // placeholders) and guide the user to add CD codes that unlock the
        // jobs-by-district bars.
        <>
          <div className="iv1-capnexus-body">
            {capsWithNexus.slice(0, 5).map((cap) => (
              <div key={cap.capabilityId} className="iv1-capnexus-row">
                <div className="iv1-capnexus-head">
                  <strong className="iv1-capnexus-name">{cap.capabilityName}</strong>
                  {cap.capabilitySector && (
                    <span className="iv1-capnexus-sector">{cap.capabilitySector}</span>
                  )}
                </div>
                <div className="iv1-capnexus-detail">{(cap.districtNexus ?? '').trim()}</div>
              </div>
            ))}
          </div>

          <div className="iv1-district-foot">
            Add state/CD references (e.g. &ldquo;TX-23&rdquo;) to each
            capability&apos;s district nexus to unlock supported jobs by district.{' '}
            <SmartLink href={supportHref} className="iv1-link">
              Edit capability tags →
            </SmartLink>
          </div>
        </>
      ) : (
        <div className="iv1-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
          <b>No district nexus data</b>
          <span>
            Add capability/district nexus tags to infer supported jobs by
            congressional district.{' '}
            <SmartLink href={supportHref} className="iv1-link">
              Add to capability tags →
            </SmartLink>
          </span>
        </div>
      )}
    </div>
  );
}
