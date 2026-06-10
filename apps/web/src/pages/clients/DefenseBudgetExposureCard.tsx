import { useNavigate } from 'react-router-dom';
import { Empty, Skeleton, Tag, Tooltip, Typography } from 'antd';
import { RelevanceEvidence } from './RelevanceEvidence.js';
import {
  formatScorePct,
  scoreBandColor,
  type RelevantPeRow,
  type RelevantPesForClientResponse,
} from './relevance-api.js';

const { Text } = Typography;

export interface DefenseBudgetExposureCardProps {
  /** The PEs-for-client response (already filtered to minScore by the API). */
  relevance: RelevantPesForClientResponse | null | undefined;
  loading?: boolean;
  /** When the relevance query failed — renders a retry hint instead of the empty state. */
  error?: boolean;
}

/**
 * Step 2.3 — "Defense budget exposure" card for the client Overview tab.
 *
 * Lists the Program Elements this client is most relevant to (score >= the API floor, default
 * 0.5), each with a score badge and the per-path evidence chips that explain WHY. PE codes deep-
 * link to the PE profile. Honest empty state when nothing clears the floor (and a distinct error
 * state when the query failed, so a fetch failure never masquerades as "no exposure"). Guards
 * against non-array / malformed data with Array.isArray so an error payload never throws.
 */
export function DefenseBudgetExposureCard({
  relevance,
  loading = false,
  error = false,
}: DefenseBudgetExposureCardProps) {
  const navigate = useNavigate();

  const rows: RelevantPeRow[] = Array.isArray(relevance?.data) ? relevance!.data : [];
  const total = typeof relevance?.total === 'number' ? relevance.total : rows.length;

  return (
    <section className="surface" style={{ marginTop: 14 }}>
      <header className="surface-head">
        <h3>Defense budget exposure</h3>
        {total > 0 ? <span className="sub">{total} relevant</span> : null}
      </header>

      <div style={{ padding: '6px 14px 14px' }}>
        {loading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : error ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Couldn't load budget exposure. Refresh to retry."
          />
        ) : rows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No Program Elements clear the relevance floor yet. Add capability PE numbers / keywords, the client UEI/CAGE, or facilities to surface budget exposure."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row) => (
              <button
                type="button"
                key={row.peCode}
                onClick={() => navigate(`/program-elements/${encodeURIComponent(row.peCode)}`)}
                className="overview-cap-row"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <Text strong className="num" style={{ fontSize: 13 }}>
                    {row.peCode}
                  </Text>
                  <Tooltip title="Combined relevance score across all evidence paths">
                    <Tag color={scoreBandColor(row.score)} style={{ marginInlineEnd: 0 }}>
                      {formatScorePct(row.score)}
                    </Tag>
                  </Tooltip>
                  {row.title ? (
                    <Text type="secondary" ellipsis style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                      {row.title}
                    </Text>
                  ) : null}
                </div>
                <RelevanceEvidence paths={row.paths} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default DefenseBudgetExposureCard;
