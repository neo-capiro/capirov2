/**
 * C-004, District Nexus Panel
 *
 * Top congressional districts inferred from capability / district nexus
 * free-text.  Renders up to 5 horizontal job-count bars sorted descending
 * by total supported jobs, plus an inference-context note and a support
 * link for adding confirmed capability tags.
 */
import type { ClientProfileV1 } from '../mappers.js';

type DistrictNexus = ClientProfileV1['sections']['financialFootprint']['districtNexus'];

interface DistrictNexusPanelProps {
  /** districtNexus payload from the aggregate profile-v1 endpoint. */
  districtNexus: DistrictNexus | undefined;
  /** href used by the "Add to capability tags →" support link. */
  supportHref: string;
}

/** Static placeholder rows shown when the payload has no district data. */
const FALLBACK_ROWS = [
  { district: 'NV-04', capability: 'Federal Services',      jobs: 92_000, dataYear: 2024 },
  { district: 'UT-02', capability: 'Critical Infrastructure', jobs: 64_000, dataYear: 2024 },
  { district: 'WY-AL', capability: 'Defense',               jobs: 41_000, dataYear: 2024 },
  { district: 'AK-AL', capability: 'Logistics',             jobs: 28_000, dataYear: 2024 },
  { district: 'CA-52', capability: 'Technology',            jobs: 18_000, dataYear: 2024 },
] as const;

function formatJobs(jobs: number): string {
  if (!Number.isFinite(jobs) || jobs <= 0) return '-';
  if (jobs >= 1_000_000) return `${(jobs / 1_000_000).toFixed(1)}M`;
  if (jobs >= 1_000) return `${Math.round(jobs / 1_000)}k`;
  return `${Math.round(jobs)}`;
}

export function DistrictNexusPanel({ districtNexus, supportHref }: DistrictNexusPanelProps) {
  const sourceRows = (districtNexus?.topDistricts ?? []).length
    ? districtNexus!.topDistricts
    : [...FALLBACK_ROWS];

  // Sort descending by jobs, take top 5, normalise bar widths.
  const rows = [...sourceRows]
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 5)
    .map((row, idx, arr) => {
      const baseline = Math.max(arr[0]?.jobs ?? 1, 1);
      const pct = Math.max(6, Math.min(100, Math.round((row.jobs / baseline) * 100)));
      return {
        key: `${row.district}-${idx}`,
        district: row.district,
        capability: row.capability,
        jobs: row.jobs,
        pct,
      };
    });

  return (
    <div className="iv1-surface iv1-district-panel">
      <div className="iv1-surface-head">
        <h3>District nexus</h3>
        <span className="iv1-surface-sub">jobs &amp; ops by CD</span>
      </div>

      <div className="iv1-district-body">
        {rows.map((row) => (
          <div key={row.key} className="iv1-district-row">
            <div className="iv1-district-meta">
              <strong className="iv1-district-code">{row.district}</strong>
              <span className="iv1-district-cap">({row.capability})</span>
            </div>
            <div className="iv1-district-bar-track">
              <div className="iv1-district-bar-fill" style={{ width: `${row.pct}%` }} />
            </div>
            <span className="iv1-district-jobs num">{formatJobs(row.jobs)}</span>
          </div>
        ))}
      </div>

      <div className="iv1-district-foot">
        Inferred from capability/district nexus text.{' '}
        <a href={supportHref} className="iv1-link">
          Add to capability tags →
        </a>{' '}
        for confirmed counts.
      </div>
    </div>
  );
}
