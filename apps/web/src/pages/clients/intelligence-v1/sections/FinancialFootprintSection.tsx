/**
 * Section 2, Financial Footprint
 *
 * Rebuilt: instead of the old ROI hero / quarter chart / FEC flow / district
 * nexus panels, this section now lists the client's LDA lobbying-disclosure
 * filings in detail — the registrant who filed, the reporting period, the
 * income/expense figure, the issue areas lobbied, the lobbyists named, and the
 * government entities contacted — with a roll-up summary across all filings.
 *
 * Data: GET /api/intelligence/clients/:clientId/lda-filings (resolves the
 * client's confirmed LDA id set, tenant-scoped).
 */
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../../../lib/use-api.js';
import { formatCompact } from '../mappers.js';
import { getClientLdaFilings, type ClientLdaFilings } from '../lda-filings-api.js';

interface FinancialFootprintSectionProps {
  clientId: string;
}

const fmtUsd = (n: number): string =>
  n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : '—';

const periodLabel = (period: string | null): string => {
  if (!period) return '';
  const map: Record<string, string> = {
    first_quarter: 'Q1',
    second_quarter: 'Q2',
    third_quarter: 'Q3',
    fourth_quarter: 'Q4',
    mid_year: 'H1',
    year_end: 'H2',
  };
  return map[period] ?? period.replace(/_/g, ' ');
};

export function FinancialFootprintSection({ clientId }: FinancialFootprintSectionProps) {
  const api = useApi();
  const query = useQuery<ClientLdaFilings>({
    queryKey: ['client-lda-filings', clientId],
    queryFn: async () => getClientLdaFilings(api, clientId),
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
  });

  const data = query.data;
  const filings = data?.filings ?? [];

  return (
    <section id="financial-footprint" className="iv1-section">
      <div className="iv1-sec-head">
        <span className="iv1-sec-num">2</span>
        <h2>Financial Footprint</h2>
        <span className="iv1-sec-sub">Federal lobbying disclosures (LDA) for this client</span>
      </div>

      {query.isLoading ? (
        <div className="iv1-surface">
          <div className="iv1-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
            <span>Loading LDA filings…</span>
          </div>
        </div>
      ) : !data?.matched || filings.length === 0 ? (
        <div className="iv1-surface">
          <div className="iv1-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
            <b>No LDA filings linked yet</b>
            <span>
              LDA lobbying disclosures appear here once this client is matched to its
              Senate LDA registrant(s). Confirm the client&apos;s LDA match in
              Settings → Intelligence Mappings to populate this section.
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* ── Roll-up summary ── */}
          <div className="iv1-lda-summary">
            <div className="iv1-lda-stat">
              <div className="iv1-lda-stat-n">{data.totalFilings}</div>
              <div className="iv1-lda-stat-l">Filings</div>
            </div>
            <div className="iv1-lda-stat">
              <div className="iv1-lda-stat-n">{formatCompact(data.totalIncome || data.totalExpenses)}</div>
              <div className="iv1-lda-stat-l">Total reported</div>
            </div>
            <div className="iv1-lda-stat">
              <div className="iv1-lda-stat-n">
                {data.firstFilingYear && data.latestFilingYear
                  ? data.firstFilingYear === data.latestFilingYear
                    ? data.firstFilingYear
                    : `${data.firstFilingYear}–${data.latestFilingYear}`
                  : '—'}
              </div>
              <div className="iv1-lda-stat-l">Years on record</div>
            </div>
            <div className="iv1-lda-stat">
              <div className="iv1-lda-stat-n">{data.registrants.length}</div>
              <div className="iv1-lda-stat-l">Registrants</div>
            </div>
          </div>

          {/* ── Registrants who filed for this client ── */}
          {data.registrants.length > 0 ? (
            <div className="iv1-surface" style={{ marginTop: 14 }}>
              <div className="iv1-surface-head">
                <h3>Lobbying firms (registrants)</h3>
                <span className="iv1-surface-sub">who filed on this client&apos;s behalf</span>
              </div>
              <div className="iv1-lda-reg-list">
                {data.registrants.map((r) => (
                  <div className="iv1-lda-reg-row" key={r.name}>
                    <span className="iv1-lda-reg-name">{r.name}</span>
                    <span className="iv1-lda-reg-meta">
                      {r.filings} filing{r.filings === 1 ? '' : 's'} · {formatCompact(r.income)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Filing detail list ── */}
          <div className="iv1-surface" style={{ marginTop: 14 }}>
            <div className="iv1-surface-head">
              <h3>Filings</h3>
              <span className="iv1-surface-sub">
                newest first{filings.length >= 500 ? ' · showing latest 500' : ''}
              </span>
            </div>
            <div className="iv1-lda-filings">
              {filings.map((f) => (
                <div className="iv1-lda-filing" key={f.filingUuid}>
                  <div className="iv1-lda-filing-top">
                    <div className="iv1-lda-filing-when">
                      <span className="iv1-lda-filing-year">{f.filingYear}</span>
                      {f.filingPeriod ? (
                        <span className="iv1-lda-filing-period">{periodLabel(f.filingPeriod)}</span>
                      ) : null}
                      <span className="iv1-lda-filing-type">{f.filingType}</span>
                    </div>
                    <div className="iv1-lda-filing-amt">{fmtUsd(f.amount)}</div>
                  </div>

                  <div className="iv1-lda-filing-reg">{f.registrantName}</div>

                  {f.issueCodes.length > 0 ? (
                    <div className="iv1-lda-chips">
                      {f.issueCodes.map((c) => (
                        <span className="iv1-lda-chip issue" key={c}>{c}</span>
                      ))}
                    </div>
                  ) : null}

                  {f.lobbyists.length > 0 ? (
                    <div className="iv1-lda-line">
                      <span className="iv1-lda-line-lbl">Lobbyists</span>
                      <span className="iv1-lda-line-val">{f.lobbyists.join(', ')}</span>
                    </div>
                  ) : null}

                  {f.governmentEntities.length > 0 ? (
                    <div className="iv1-lda-line">
                      <span className="iv1-lda-line-lbl">Contacted</span>
                      <span className="iv1-lda-line-val">{f.governmentEntities.join(', ')}</span>
                    </div>
                  ) : null}

                  {f.documentUrl ? (
                    <a
                      className="iv1-lda-doc"
                      href={f.documentUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View filing →
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
