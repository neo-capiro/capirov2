/**
 * C-003, FEC contribution flow panel
 *
 * Data-present state: lightweight 3-column flow visualization
 *   employer (contributor) → committees → candidates / recipients
 *
 * Empty state: explains the gap and offers a remediation CTA when the
 *   tenant has permission to trigger an FEC enrichment run.
 */
import { Link } from 'react-router-dom';
import { formatCompact, type ClientProfileV1 } from '../mappers.js';

/** True for app-internal SPA routes that should navigate without a full reload. */
function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

type FecMoneyFlow = ClientProfileV1['sections']['financialFootprint']['fecMoneyFlow'];
type FecCommittee = NonNullable<FecMoneyFlow['committees']>[number];
type FecCandidate = FecCommittee['candidates'][number];

interface FecContributionPanelProps {
  /** Aggregate FEC payload from the profile-v1 endpoint. */
  fec?: FecMoneyFlow;
  /** Whether the tenant can trigger an FEC enrichment run. */
  runFecEnabled: boolean;
  /** href to navigate when the "Run FEC enrichment" CTA is clicked. */
  runFecHref: string;
}

const MAX_COMMITTEES = 4;
const MAX_CANDIDATES = 5;

/**
 * Flatten + aggregate candidates across all committees, sorted by total amount.
 *
 * Aggregation is keyed by the FEC candidate ID when present (the only reliable
 * identity), falling back to a normalized name for legacy rows that predate
 * candidate_id backfill. This prevents two distinct people who share a name
 * from being merged into one row.
 */
function deriveTopCandidates(committees: FecCommittee[], max: number): FecCandidate[] {
  const map = new Map<string, FecCandidate>();
  for (const c of committees) {
    for (const cand of c.candidates) {
      const id = cand.candidateId?.trim();
      const key = id
        ? `id:${id.toLowerCase()}`
        : `name:${cand.candidateName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
      const existing = map.get(key);
      if (existing) {
        map.set(key, {
          ...existing,
          totalAmount: existing.totalAmount + cand.totalAmount,
          contributionCount: existing.contributionCount + cand.contributionCount,
        });
      } else {
        map.set(key, { ...cand });
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, max);
}

export function FecContributionPanel({ fec, runFecEnabled, runFecHref }: FecContributionPanelProps) {
  const summary = fec?.summary;
  const hasData = (summary?.totalContributions ?? 0) > 0;

  return (
    <div className="iv1-surface">
      <div className="iv1-surface-head">
        <h3>FEC contributions — individual (employer-linked)</h3>
        <span className="iv1-surface-sub">individuals listing the mapped employer · TTM</span>
        {hasData && (
          <span className="iv1-surface-right">{summary!.totalContributions} contributions</span>
        )}
      </div>

      {hasData ? (
        <FecFlowData fec={fec!} />
      ) : (
        <FecEmptyState fec={fec} runFecEnabled={runFecEnabled} runFecHref={runFecHref} />
      )}

      <FecPacGivingNote tracked={fec?.pacGiving?.tracked ?? false} />
      <FecDisclaimer text={fec?.disclaimer} />
    </div>
  );
}

/**
 * Explicit separation of the client's OWN PAC giving from the individual,
 * employer-linked contributions shown above. PAC giving (committee → candidate
 * disbursements) is a distinct FEC dataset not yet ingested; we surface the bucket
 * so the two are never conflated. When tracked becomes true, this renders the data.
 */
function FecPacGivingNote({ tracked }: { tracked: boolean }) {
  if (tracked) return null;
  return (
    <div className="iv1-fec-pac-note">
      <strong>Client PAC giving</strong> — the organization&apos;s own PAC contributions to
      candidates are tracked separately and are not yet available. The figures above reflect
      individual filers who list the mapped employer, which is legally distinct from PAC giving.
    </div>
  );
}

/**
 * Compliance disclaimer for the FEC panel. Renders in every state (data + empty)
 * because the panel surfaces individual employer-linked contributions resolved to
 * candidates/members. The text is supplied by the API (single source of truth in
 * apps/api/src/intelligence/fec-disclaimer.ts) so the wording cannot drift across
 * surfaces; FALLBACK_DISCLAIMER is a defensive copy for older payloads that predate
 * the API field. Three required points: (1) public FEC data, intelligence-only, not
 * legal/campaign-finance advice; (2) individual employer-linked ≠ corporate/PAC
 * giving; (3) not a recommendation to make/solicit/direct any contribution.
 */
const FALLBACK_DISCLAIMER =
  'Source: public Federal Election Commission filings, shown for informational and intelligence ' +
  'purposes only — not legal, compliance, or campaign-finance advice. Contributions attributed via a ' +
  "contributor's listed employer reflect individual filers and are legally distinct from any " +
  'contribution by that organization or its PAC. Nothing here is a recommendation to make, solicit, or ' +
  'direct any political contribution. Verify against the official record at FEC.gov before relying on it.';

function FecDisclaimer({ text }: { text?: string }) {
  return (
    <p className="iv1-fec-disclaimer" role="note">
      {text ?? FALLBACK_DISCLAIMER}
    </p>
  );
}

// ── Data-present sub-component ──────────────────────────────────────────────

function FecFlowData({ fec }: { fec: FecMoneyFlow }) {
  const { mappedEmployer, summary, committees = [] } = fec;
  const topCommittees = committees.slice(0, MAX_COMMITTEES);
  const extraCommittees = committees.length - topCommittees.length;
  const topCandidates = deriveTopCandidates(committees, MAX_CANDIDATES);

  return (
    <div className="iv1-fec-wrap">
      {/* Total amount hero */}
      <div className="iv1-fec-total">
        <span className="iv1-fec-total-amt">{formatCompact(summary.totalAmount)}</span>
        <span className="iv1-fec-total-label">total matched contributions</span>
      </div>

      {/* 3-column flow: contributor → committees → recipients */}
      <div className="iv1-fec-flow">
        {/* Left: employer / contributor */}
        <div className="iv1-fec-col">
          <div className="iv1-fec-col-head">Contributor</div>
          <div className="iv1-fec-entity iv1-fec-entity--primary">
            <div className="iv1-fec-entity-name">{mappedEmployer ?? 'Mapped employer'}</div>
            <div className="iv1-fec-entity-amt">{formatCompact(summary.totalAmount)}</div>
            <div className="iv1-fec-entity-meta">{summary.totalContributions} contributions</div>
          </div>
        </div>

        <div className="iv1-fec-arrow" aria-hidden="true">→</div>

        {/* Middle: committees */}
        <div className="iv1-fec-col">
          <div className="iv1-fec-col-head">
            Committees{summary.committeeCount > 0 ? ` (${summary.committeeCount})` : ''}
          </div>
          {topCommittees.length > 0 ? (
            topCommittees.map((c) => (
              <div key={c.committeeId} className="iv1-fec-entity">
                <div className="iv1-fec-entity-name">{c.committeeName}</div>
                <div className="iv1-fec-entity-amt">{formatCompact(c.totalAmount)}</div>
              </div>
            ))
          ) : (
            <div className="iv1-fec-entity-more">No committee breakdown</div>
          )}
          {extraCommittees > 0 && (
            <div className="iv1-fec-entity-more">+{extraCommittees} more</div>
          )}
        </div>

        <div className="iv1-fec-arrow" aria-hidden="true">→</div>

        {/* Right: candidates / recipients */}
        <div className="iv1-fec-col">
          <div className="iv1-fec-col-head">
            Recipients{summary.candidateCount > 0 ? ` (${summary.candidateCount})` : ''}
          </div>
          {topCandidates.length > 0 ? (
            topCandidates.map((cand, idx) => (
              <div key={cand.candidateId?.trim() || `${cand.candidateName}-${idx}`} className="iv1-fec-entity">
                <div className="iv1-fec-entity-name">{cand.candidateName}</div>
                <div className="iv1-fec-entity-amt">{formatCompact(cand.totalAmount)}</div>
                {cand.linkedMembers[0] && (
                  <div className="iv1-fec-entity-meta">{cand.linkedMembers[0].memberName}</div>
                )}
              </div>
            ))
          ) : (
            <div className="iv1-fec-entity-more">No candidate data</div>
          )}
        </div>
      </div>

      {/* Footer: linked members + associated bills */}
      {(summary.memberCount > 0 || summary.billCount > 0) && (
        <div className="iv1-fec-footer">
          {summary.memberCount > 0 && (
            <span>
              {summary.memberCount} linked member{summary.memberCount !== 1 ? 's' : ''}
            </span>
          )}
          {summary.billCount > 0 && (
            <span>
              {summary.billCount} associated bill{summary.billCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Empty-state sub-component ───────────────────────────────────────────────

function FecEmptyState({
  fec,
  runFecEnabled,
  runFecHref,
}: {
  fec?: FecMoneyFlow;
  runFecEnabled: boolean;
  runFecHref: string;
}) {
  const isMapped = Boolean(fec?.mappedEmployer);
  const ctaLabel = isMapped ? 'Run FEC enrichment job →' : 'Map an FEC employer →';

  return (
    <div className="iv1-empty iv1-fec-empty">
      <div className="iv1-fec-empty-glyph" aria-hidden="true">◎</div>
      <strong>
        {isMapped ? 'No direct FEC contributions matched yet' : 'No FEC employer mapped yet'}
      </strong>
      {isMapped ? (
        <span>
          Mapped lobbyists for <em>{fec!.mappedEmployer}</em> have FEC records, but no
          contributions tie back to this client in the resolution graph yet.
        </span>
      ) : (
        <span>
          Map this client to an FEC employer to trace political contributions from its
          registered lobbyists through committees to candidate recipients.
        </span>
      )}
      <span className="iv1-fec-empty-action">
        {runFecEnabled ? (
          isInternalHref(runFecHref) ? (
            <Link to={runFecHref} className="iv1-fec-cta">
              {ctaLabel}
            </Link>
          ) : (
            <a href={runFecHref} className="iv1-fec-cta">
              {ctaLabel}
            </a>
          )
        ) : (
          <span className="iv1-fec-disabled">
            FEC enrichment (requires employer mapping first)
          </span>
        )}
      </span>
    </div>
  );
}
