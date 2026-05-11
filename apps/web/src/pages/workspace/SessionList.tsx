import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Empty, Skeleton, Typography } from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { SessionSummary } from './types.js';

// Lightweight relative-time formatter so we don't pull in a date library
// for one label. Buckets: <1m / <1h / <1d / <7d / absolute date.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

const { Text } = Typography;

interface SessionListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Left-pane session list. Lists the current user's active Clio sessions
 * (most-recent first) plus a primary "New session" action that creates a
 * blank session server-side and selects it.
 */
export function SessionList({ selectedId, onSelect }: SessionListProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();

  const sessions = useQuery<SessionSummary[]>({
    queryKey: ['clio', 'sessions'],
    queryFn: async () => (await api.get<SessionSummary[]>('/api/clio/sessions')).data,
  });

  const createSession = useMutation({
    mutationFn: async () => (await api.post<SessionSummary>('/api/clio/sessions', {})).data,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['clio', 'sessions'] });
      onSelect(created.id);
    },
    onError: () => message.error('Could not start a new session'),
  });

  return (
    <div className="clio-session-list">
      <div className="clio-session-list__header">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          loading={createSession.isPending}
          onClick={() => createSession.mutate()}
        >
          New session
        </Button>
      </div>

      {sessions.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : sessions.data && sessions.data.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No sessions yet"
          style={{ marginTop: 32 }}
        />
      ) : (
        <ul className="clio-session-list__items">
          {(sessions.data ?? []).map((s) => {
            const active = s.id === selectedId;
            const lastSeen = s.lastMessageAt ?? s.createdAt;
            return (
              <li
                key={s.id}
                className={`clio-session-list__item${active ? ' is-active' : ''}`}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(s.id);
                }}
                role="button"
                tabIndex={0}
              >
                <Text strong ellipsis className="clio-session-list__title">
                  {s.title}
                </Text>
                <Text type="secondary" className="clio-session-list__time">
                  {relativeTime(lastSeen)}
                </Text>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
