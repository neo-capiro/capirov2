import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DeleteOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Dropdown, Empty, Skeleton, Typography } from 'antd';
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
  // When the parent is collapsed, hide the inner labels and render a
  // compact icon-only column (Claude-style sidebar collapse).
  collapsed?: boolean;
}

/**
 * Left-pane session list. Lists the current user's active Clio sessions
 * (most-recent first) plus a primary "New session" action that creates a
 * blank session server-side and selects it.
 *
 * Each row has a hover-revealed three-dots menu with Delete. Backend
 * already supports DELETE /api/clio/sessions/:id (soft-archive); we
 * call that and optimistically remove the row from the list. The active
 * session pointer resets when the deleted one was selected.
 */
export function SessionList({ selectedId, onSelect, collapsed = false }: SessionListProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

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

  const deleteSession = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/clio/sessions/${id}`);
      return id;
    },
    onMutate: (id) => {
      setPendingDeleteId(id);
      // Optimistic removal — TanStack Query lets us patch the cached
      // list immediately so the row disappears the moment the user
      // confirms. Rollback to the pre-delete snapshot if the request
      // fails.
      const prev = qc.getQueryData<SessionSummary[]>(['clio', 'sessions']) ?? [];
      qc.setQueryData<SessionSummary[]>(['clio', 'sessions'], (curr) =>
        (curr ?? []).filter((s) => s.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['clio', 'sessions'], ctx.prev);
      message.error('Could not delete that session');
    },
    onSuccess: (id) => {
      if (selectedId === id) {
        // Selected session is gone — clear the selection so the chat
        // pane shows its empty state instead of trying to load a
        // session that just 404'd.
        onSelect('');
      }
      qc.invalidateQueries({ queryKey: ['clio', 'sessions'] });
    },
    onSettled: () => setPendingDeleteId(null),
  });

  function confirmDelete(s: SessionSummary) {
    modal.confirm({
      title: 'Delete this session?',
      content: (
        <span>
          <strong>{s.title}</strong> and its message history will be removed. This can't be undone.
        </span>
      ),
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => deleteSession.mutate(s.id),
    });
  }

  return (
    <div className={`clio-session-list${collapsed ? ' is-collapsed' : ''}`}>
      <div className="clio-session-list__header">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block={!collapsed}
          loading={createSession.isPending}
          onClick={() => createSession.mutate()}
          aria-label="New session"
        >
          {collapsed ? null : 'New session'}
        </Button>
      </div>

      {sessions.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : sessions.data && sessions.data.length === 0 ? (
        collapsed ? null : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No sessions yet"
            style={{ marginTop: 32 }}
          />
        )
      ) : (
        <ul className="clio-session-list__items">
          {(sessions.data ?? []).map((s) => {
            const active = s.id === selectedId;
            const lastSeen = s.lastMessageAt ?? s.createdAt;
            const isDeleting = pendingDeleteId === s.id;
            return (
              <li
                key={s.id}
                className={[
                  'clio-session-list__item',
                  active ? 'is-active' : '',
                  isDeleting ? 'is-deleting' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(s.id);
                }}
                role="button"
                tabIndex={0}
                title={collapsed ? s.title : undefined}
              >
                {collapsed ? (
                  // Collapsed sidebar: one small letter avatar per
                  // session. Hover reveals the title via title=...
                  <span className="clio-session-list__avatar">
                    {(s.title || '?').trim().slice(0, 1).toUpperCase()}
                  </span>
                ) : (
                  <>
                    <div className="clio-session-list__item-body">
                      <Text strong ellipsis className="clio-session-list__title">
                        {s.title}
                      </Text>
                      <Text type="secondary" className="clio-session-list__time">
                        {relativeTime(lastSeen)}
                      </Text>
                    </div>
                    <Dropdown
                      // Stop the click from also selecting the session
                      // when the trigger fires.
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'delete',
                            danger: true,
                            icon: <DeleteOutlined />,
                            label: 'Delete session',
                          },
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'delete') confirmDelete(s);
                        },
                      }}
                    >
                      <button
                        type="button"
                        className="clio-session-list__menu"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        aria-label="Session actions"
                      >
                        <MoreOutlined />
                      </button>
                    </Dropdown>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
