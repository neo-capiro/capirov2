/**
 * Section 2, Financial Footprint
 * Lobbying spend vs. federal obligations, FEC contribution flow, and district nexus.
 */
import type { ClientProfileV1 } from '../mappers.js';
import { RoiHeroPanel } from '../components/RoiHeroPanel.js';
import { RoiQuarterChart } from '../components/RoiQuarterChart.js';
import { FecContributionPanel } from '../components/FecContributionPanel.js';
import { DistrictNexusPanel } from '../components/DistrictNexusPanel.js';

interface FinancialFootprintSectionProps {
  aggregate?: ClientProfileV1;
  /** Whether the tenant can trigger an FEC enrichment run. */
  runFecEnabled: boolean;
  /** href to navigate when "Run FEC enrichment job" is clicked. */
  runFecHref: string;
}

export function FinancialFootprintSection({
  aggregate,
  runFecEnabled,
  runFecHref,
}: FinancialFootprintSectionProps) {
  const hero = aggregate?.sections.financialFootprint.hero;
  const districtNexus = aggregate?.sections.financialFootprint.districtNexus;
  const fecFlow = aggregate?.sections.financialFootprint.fecMoneyFlow;
  const quarterSeries = aggregate?.sections.financialFootprint.series.quarterSeries;

  // C5: ensure every visible CTA in this section is intentional + functional.
  const mappingsHref = aggregate?.links.mappingsAdmin ?? '/settings/intelligence-mappings';
  // Deep-link the FEC CTA straight to the FEC-employer rows in the mappings
  // admin so "Map an FEC employer →" lands on the rows to confirm, rather than
  // the unfiltered list. Entity resolution already produces fec_employer +
  // fec_committee mappings; the user just needs to confirm them.
  const fecMapHref = `${mappingsHref}${mappingsHref.includes('?') ? '&' : '?'}source=fec_employer`;
  const effectiveFecHref = fecMapHref || (runFecHref || '/settings/intelligence-mappings');
  const effectiveFecEnabled = runFecEnabled || Boolean(effectiveFecHref);
  const districtSupportHref = mappingsHref;

  return (
    <section id="financial-footprint" className="iv1-section">
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">2</span>
        <h2>Financial Footprint</h2>
        <span className="iv1-sec-sub">Lobby spend → outcome · the ROI context</span>
      </div>

      <RoiHeroPanel hero={hero} />
      <RoiQuarterChart series={quarterSeries} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginTop: 14 }}>
        <FecContributionPanel
          fec={fecFlow}
          runFecEnabled={effectiveFecEnabled}
          runFecHref={effectiveFecHref}
        />

        <DistrictNexusPanel
          districtNexus={districtNexus}
          supportHref={districtSupportHref}
        />
      </div>
    </section>
  );
}
