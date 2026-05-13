import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CloseOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileWordOutlined,
} from '@ant-design/icons';
import { Button, Empty, Skeleton, Tag, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApi } from '../../lib/use-api.js';
import type { ArtifactFull, ArtifactList, ArtifactSummary } from './types.js';

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
            {items.map((a) => {
              const code = codeInterpreterMeta(a);
              const presigned = code?.presignedUrl;
              return (
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
                    {iconForArtifact(a)}
                  </div>
                  <div className="clio-artifact-panel__card-body">
                    <Text strong ellipsis>
                      {a.title}
                    </Text>
                    <div className="clio-artifact-panel__card-meta">
                      <Tag>{prettyKindOrType(a)}</Tag>
                      {code ? null : <Tag>v{a.version}</Tag>}
                      {code?.sizeBytes ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatBytes(code.sizeBytes)}
                        </Text>
                      ) : null}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {relativeTime(a.updatedAt)}
                      </Text>
                    </div>
                  </div>
                  {presigned ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<DownloadOutlined />}
                      aria-label={`Download ${a.title}`}
                      onClick={(e) => {
                        // Don't fire the card's onClick — we don't
                        // want to open the markdown viewer for a
                        // binary file. Just hand off to the browser.
                        e.stopPropagation();
                        window.open(presigned, '_blank', 'noopener');
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
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

/** code_interpreter rows stamp metadata.source = 'code_interpreter' and
 * carry a presigned download URL. This helper extracts it in one place
 * so the card render + tag pretty-print can both inspect the same
 * shape. Returns null for non-sandbox artifacts. */
interface CodeInterpreterMeta {
  source: 'code_interpreter';
  presignedUrl?: string;
  sizeBytes?: number;
  runTitle?: string;
}
function codeInterpreterMeta(a: ArtifactSummary): CodeInterpreterMeta | null {
  const m = a.metadata as Record<string, unknown> | null | undefined;
  if (!m || m.source !== 'code_interpreter') return null;
  const out: CodeInterpreterMeta = { source: 'code_interpreter' };
  if (typeof m.presignedUrl === 'string') out.presignedUrl = m.presignedUrl;
  if (typeof m.sizeBytes === 'number') out.sizeBytes = m.sizeBytes;
  if (typeof m.runTitle === 'string') out.runTitle = m.runTitle;
  return out;
}

/** Pick a sensible icon based on the artifact's file extension. Falls
 * back to FileTextOutlined for non-sandbox / unknown types. */
function iconForArtifact(a: ArtifactSummary) {
  const code = codeInterpreterMeta(a);
  if (!code) return <FileTextOutlined />;
  const ext = a.title.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'xlsx':
    case 'xls':
    case 'csv':
      return <FileExcelOutlined style={{ color: '#22863a' }} />;
    case 'docx':
    case 'doc':
      return <FileWordOutlined style={{ color: '#1f6feb' }} />;
    case 'pptx':
    case 'ppt':
      return <FilePptOutlined style={{ color: '#d35400' }} />;
    case 'pdf':
      return <FilePdfOutlined style={{ color: '#cf2331' }} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return <FileImageOutlined style={{ color: '#722ed1' }} />;
    default:
      return <FileTextOutlined />;
  }
}

/** "Excel workbook" / "Word document" / etc. for code_interpreter
 * artifacts; falls back to prettyKind() for render_artifact rows. */
function prettyKindOrType(a: ArtifactSummary): string {
  const code = codeInterpreterMeta(a);
  if (!code) return prettyKind(a.kind);
  const ext = a.title.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'xlsx':
    case 'xls':
      return 'Excel workbook';
    case 'docx':
    case 'doc':
      return 'Word document';
    case 'pptx':
    case 'ppt':
      return 'PowerPoint deck';
    case 'pdf':
      return 'PDF';
    case 'csv':
      return 'CSV';
    case 'json':
      return 'JSON';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'Image';
    default:
      return 'File';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
