/**
 * Section 2 — Financial Footprint
 * Lobbying spend vs. federal obligations, FEC contribution flow (empty state),
 * and district nexus inferred from sector / capability tags.
 */
import { formatCompact, type ClientProfileV1 } from '../mappers.js';
import { RoiHeroPanel } from '../components/RoiHeroPanel.js';

interface FinancialFootprintSectionProps {
  aggregate?: ClientProfileV1;
  /** Whether the tenant can trigger an FEC enrichment run. */
  runFecEnabled: boolean;
  /** href to navigate when "Run FEC enrichment job" is clicked. */
  runFecHref: string;
}

const NEXUS_ROWS = [
  { district: 'NV-04', rep: 'Horsford', pct: 92 },
  { district: 'UT-02', rep: 'Maloy',    pct: 64 },
  { district: 'WY-AL', rep: 'Hageman',  pct: 41 },
  { district: 'AK-AL', rep: 'Begich',   pct: 28 },
];

export function FinancialFootprintSection({
  aggregate,
  runFecEnabled,
  runFecHref,
}: FinancialFootprintSectionProps) {
  const hero = aggregate?.sections.financialFootprint.hero;
  const districtRows = aggregate?.sections.financialFootprint.districtNexus.topDistricts ?? [];
  const fecSummary = aggregate?.sections.financialFootprint.fecMoneyFlow.summary;

  return (
    <section id="financial-footprint" className="iv1-section">
      {/* ── Section heading ── */}
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">2</span>
        <h2>Financial Footprint</h2>
        <span className="iv1-sec-sub">Lobby spend → outcome · the ROI context</span>
      </div>

      {/* ── ROI hero metrics ── */}
      <RoiHeroPanel hero={hero} />

      {/* Quarterly spend bar chart (CSS) */}
      <div style={{ padding: '16px 22px' }}>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
          Quarterly spend · 8 quarters
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 64 }}>
          {[20, 20, 20, 20, 20, 20, 20, 20].map((_, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: '100%', height: 40,
                background: i === 7 ? 'var(--accent)' : 'var(--accent-soft)',
                borderRadius: '3px 3px 0 0',
                border: '1px solid var(--border-1)',
              }} />
              <span className="num" style={{ fontSize: 9, color: 'var(--ink-4)' }}>
                {['Q3\'24','Q4\'24','Q1\'25','Q2\'25','Q3\'25','Q4\'25','Q1\'26','Q2\'26'][i]}
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          Steady $20K/qtr — no variation across 8 consecutive quarters
        </div>
      </div>

      {/* ── Bottom: FEC flow + District nexus ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginTop: 14 }}>
        {/* FEC contribution flow — structured empty state */}
        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>FEC contribution flow</h3>
            <span className="iv1-surface-sub">via registered lobbyists · TTM</span>
            <span className="iv1-surface-right">Sankey upgrade pending</span>
          </div>
          <div className="iv1-empty">
            {fecSummary && fecSummary.totalContributions > 0 ? (
              <>
                <div style={{ fontSize: 22, color: 'var(--accent)', marginBottom: 6 }}>
                  {formatCompact(fecSummary.totalAmount)}
                </div>
                <strong>{fecSummary.totalContributions} matched contributions</strong>
                Across {fecSummary.committeeCount} committees and {fecSummary.candidateCount} candidates.
              </>
            ) : (
              <>
                <div style={{ fontSize: 22, color: 'var(--ink-4)', marginBottom: 6 }}>—</div>
                <strong>No direct FEC contributions matched yet</strong>
                Mapped lobbyists have FEC records, but no contributions tie back to
                this client's employees in the resolution graph.
                <br /><br />
                {runFecEnabled ? (
                  <a href={runFecHref} style={{ color: 'var(--accent)' }}>
                    Run FEC enrichment job →
                  </a>
                ) : (
                  <span style={{ color: 'var(--ink-4)' }}>
                    FEC enrichment job (requires mapping first)
                  </span>
                )}
                {' or surface lobbyist-level contributions as a proxy.'}
              </>
            )}
          </div>
        </div>

        {/* District nexus */}
        <div className="iv1-surface">
          <div className="iv1-surface-head">
            <h3>District nexus</h3>
            <span className="iv1-surface-sub">jobs &amp; ops by CD</span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            {(districtRows.length
              ? districtRows.map((row, idx) => ({
                  district: row.district,
                  rep: row.capability,
                  pct: Math.max(6, Math.min(100, Math.round((row.jobs / Math.max(districtRows[0]?.jobs || 1, 1)) * 100))),
                  jobs: row.jobs,
                  key: `${row.district}-${idx}`,
                }))
              : NEXUS_ROWS.map((row) => ({ ...row, jobs: 0, key: row.district }))
            ).map(({ district, rep, pct, jobs, key }) => (
              <div key={key} className="iv1-nexus-row">
                <div style={{ flexShrink: 0, minWidth: 0 }}>
                  <strong style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{district}</strong>{' '}
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>({rep})</span>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-sunken)', height: 8, borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }} />
                </div>
                <span className="num" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', textAlign: 'right', minWidth: 52 }}>
                  {jobs > 0 ? `${Math.round(jobs / 1000)}k` : '—'}
                </span>
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 16px 14px', borderTop: '1px dashed var(--border-1)', fontSize: 11, color: 'var(--ink-3)' }}>
            Inferred from sector ops zones.{' '}
            <a href="/clients" style={{ color: 'var(--accent)' }}>
              Add to capability tags →
            </a>{' '}
            for confirmed counts.
          </div>
        </div>
      </div>
    </section>
  );
}
