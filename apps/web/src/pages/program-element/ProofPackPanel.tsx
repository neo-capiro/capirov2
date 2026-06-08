import { Card, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import type { ProgramElementSourceItem } from './types.js';

const { Text, Paragraph } = Typography;

export interface ProofPackPanelProps {
  sources: ProgramElementSourceItem[] | null | undefined;
  loading?: boolean;
}

const EXHIBIT_COLOR: Record<string, string> = {
  'R-1': 'blue',
  'R-2': 'cyan',
  'R-2A': 'geekblue',
  'R-3': 'green',
  'P-1': 'purple',
  'P-40': 'purple',
};

/** Open-at-page deep link for a citation. */
export function citationHref(s: Pick<ProgramElementSourceItem, 'sourceUrl' | 'pageNumber'>): string | null {
  if (!s.sourceUrl) return null;
  return s.pageNumber ? `${s.sourceUrl}#page=${s.pageNumber}` : s.sourceUrl;
}

function pageLabel(s: ProgramElementSourceItem): string | null {
  if (!s.pageNumber) return null;
  return s.pageEnd && s.pageEnd !== s.pageNumber ? `pp.${s.pageNumber}–${s.pageEnd}` : `p.${s.pageNumber}`;
}

/**
 * Step 1.2 (§11) — the proof pack: every page-level citation behind this PE's claims, ordered
 * in document order, each with an open-at-page deep link and (when registered) a fingerprint
 * badge. Honest empty state when no citations exist.
 */
export function ProofPackPanel({ sources, loading = false }: ProofPackPanelProps) {
  if (loading) {
    return (
      <Card title="Sources &amp; evidence">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    );
  }

  const rows = Array.isArray(sources) ? sources : [];
  if (rows.length === 0) {
    return (
      <Card className="pe-proof-pack-card" title="Sources &amp; evidence">
        <Empty description="No source citations recorded for this PE yet." />
      </Card>
    );
  }

  return (
    <Card className="pe-proof-pack-card" title={`Sources & evidence · ${rows.length}`}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
        Every claim&apos;s primary source. &quot;Open at page&quot; jumps to the exact exhibit page in
        the original budget document.
      </Text>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {rows.map((s) => {
          const badge = s.exhibitType ?? s.docType;
          const href = citationHref(s);
          const page = pageLabel(s);
          return (
            <div key={s.id} className="pe-proof-row" style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
              <Space wrap size={[6, 4]}>
                <Tag color={EXHIBIT_COLOR[badge ?? ''] ?? 'default'}>{badge}</Tag>
                {s.fy ? <Tag>FY{s.fy}</Tag> : null}
                {s.publisher ? <Text type="secondary">{s.publisher}</Text> : null}
                {page ? <Text type="secondary">{page}</Text> : null}
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    Open at page
                  </a>
                ) : null}
                {s.sourceDocument?.sha256 ? (
                  <Tag title={`sha256 ${s.sourceDocument.sha256}`}>fingerprinted</Tag>
                ) : null}
              </Space>
              {s.snippet ? (
                <Paragraph
                  type="secondary"
                  style={{ margin: '4px 0 0', fontSize: 12 }}
                  ellipsis={{ rows: 2, expandable: true }}
                >
                  {s.snippet}
                </Paragraph>
              ) : null}
            </div>
          );
        })}
      </Space>
    </Card>
  );
}

export default ProofPackPanel;
