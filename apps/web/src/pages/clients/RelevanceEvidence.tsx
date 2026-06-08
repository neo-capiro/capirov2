import { Space, Tag, Tooltip, Typography } from 'antd';
import {
  RELEVANCE_PATH_COLOR,
  RELEVANCE_PATH_LABEL,
  formatScorePct,
  type PathResult,
} from './relevance-api.js';

const { Text } = Typography;

/**
 * Step 2.3 — shared evidence renderer for the explainable client ⇄ PE relevance surfaces.
 *
 * Renders one chip per scored evidence PATH (color + label + per-path score), each chip's
 * tooltip listing the underlying evidence lines so a user can see *why* the match scored.
 * Guards against non-array / malformed `paths` so an error payload never throws.
 */
export function RelevanceEvidence({ paths }: { paths: PathResult[] | null | undefined }) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => p && typeof p.path === 'string');
  if (list.length === 0) {
    return <Text type="secondary">No evidence</Text>;
  }
  return (
    <Space size={[4, 4]} wrap>
      {list.map((p, i) => {
        const label = RELEVANCE_PATH_LABEL[p.path] ?? p.path;
        const color = RELEVANCE_PATH_COLOR[p.path] ?? 'default';
        const evidence = Array.isArray(p.evidence) ? p.evidence.filter(Boolean) : [];
        const tip = evidence.length ? evidence.join(' · ') : label;
        return (
          <Tooltip key={`${p.path}-${i}`} title={tip}>
            <Tag color={color}>
              {label}
              <span style={{ marginLeft: 6, opacity: 0.75 }}>{formatScorePct(p.score)}</span>
            </Tag>
          </Tooltip>
        );
      })}
    </Space>
  );
}

export default RelevanceEvidence;
