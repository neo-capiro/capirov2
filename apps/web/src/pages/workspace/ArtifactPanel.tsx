import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloseOutlined, FileTextOutlined } from '@ant-design/icons';
import { Button, Empty, Skeleton, Tag, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApi } from '../../lib/use-api.js';
import type { ArtifactFull, ArtifactList } from './types.js';

const { Text, Title } = Typography;

interface ArtifactPanelProps {
  sessionId: string | null;
  // Whenever the chat receives a new assistant reply we bump this counter
  // so the panel can refetch — the model may have produced a new artifact
  // during the turn.
  refreshKey: number;
}

/**
 * Right-side artifact viewer. Two modes:
 *   - List view: cards for every ready artifact in the current session.
 *   - Detail view: opened by clicking a card. Full markdown body + a
 *     "back" affordance.
 *
 * Filters by sessionId so the panel only shows what the active chat
 * has produced. The endpoint is tenant-wide when sessionId is omitted;
 * we use the per-session form here to keep the panel focused.
 */
export function ArtifactPanel({ sessionId, refreshKey }: ArtifactPanelProps) {
  const api = useApi();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery<ArtifactList>({
    queryKey: ['clio', 'artifacts', sessionId, refreshKey],
    queryFn: async () =>
      (
        await api.get<ArtifactList>('/api/clio/artifacts', {
          params: sessionId ? { sessionId } : {},
        })
      ).data,
    enabled: Boolean(sessionId),
  });

  const open = useQuery<ArtifactFull>({
    queryKey: ['clio', 'artifact', openId],
    queryFn: async () =>
      (await api.get<ArtifactFull>(`/api/clio/artifacts/${openId}`)).data,
    enabled: Boolean(openId),
  });

  if (!sessionId) {
    return (
      <aside className="clio-artifact-panel clio-artifact-panel--empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Artifacts produced in this session will appear here."
        />
      </aside>
    );
  }

  if (openId) {
    return (
      <aside className="clio-artifact-panel">
        <header className="clio-artifact-panel__header">
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={() => setOpenId(null)}
            aria-label="Close artifact"
          />
          <Title level={5} ellipsis style={{ margin: 0, flex: 1 }}>
            {open.data?.title ?? 'Artifact'}
          </Title>
          {open.data ? <Tag>v{open.data.version}</Tag> : null}
        </header>
        <div className="clio-artifact-panel__body">
          {open.isLoading ? (
            <Skeleton active paragraph={{ rows: 12 }} />
          ) : open.data?.content ? (
            <div className="clio-artifact-panel__markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{open.data.content}</ReactMarkdown>
            </div>
          ) : (
            <Empty description="No content" />
          )}
        </div>
      </aside>
    );
  }

  const items = list.data?.items ?? [];
  return (
    <aside className="clio-artifact-panel">
      <header className="clio-artifact-panel__header">
        <Title level={5} style={{ margin: 0, flex: 1 }}>
          Artifacts
        </Title>
        <Button
          size="small"
          type="text"
          onClick={() => qc.invalidateQueries({ queryKey: ['clio', 'artifacts', sessionId] })}
        >
          Refresh
        </Button>
      </header>
      <div className="clio-artifact-panel__body">
        {list.isLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : items.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No artifacts yet. Ask Clio to draft a policy memo or meeting brief."
          />
        ) : (
          <ul className="clio-artifact-panel__list">
            {items.map((a) => (
              <li
                key={a.id}
                className="clio-artifact-panel__card"
                onClick={() => setOpenId(a.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setOpenId(a.id);
                }}
              >
                <div className="clio-artifact-panel__card-icon">
                  <FileTextOutlined />
                </div>
                <div className="clio-artifact-panel__card-body">
                  <Text strong ellipsis>
                    {a.title}
                  </Text>
                  <div className="clio-artifact-panel__card-meta">
                    <Tag>{prettyKind(a.kind)}</Tag>
                    <Tag>v{a.version}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {relativeTime(a.updatedAt)}
                    </Text>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function prettyKind(kind: string): string {
  switch (kind) {
    case 'policy_memo':
      return 'Policy memo';
    case 'meeting_brief':
      return 'Meeting brief';
    case 'client_intel_update':
      return 'Client intel';
    case 'regulatory_comment':
      return 'Reg. comment';
    case 'appropriations_request':
      return 'Approps. request';
    default:
      return kind;
  }
}

// Tiny relative-time helper. Avoids pulling in dayjs just for this one
// component — same pattern SessionList uses.
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
