// Top-nav bell that opens a compact Changes Inbox panel.
//
// The dropdown lists recent intelligence changes (most recent 25) with
// per-row mark-as-read, severity badge, source pill, and relative time.
// A "View all" footer link deep-links to the full /intelligence/changes
// page for filtering / drill-down. The bell badge counts unread rows.
//
// We deliberately reuse the same /api/intelligence/changes endpoint the
// inbox page already calls, so the dropdown and full page stay in sync.

import { useMemo, useState } from 'react';
import { Badge, Button, Dropdown, Empty, List, Skeleton, Tag, Tooltip, Typography } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../lib/use-api.js';
import type { IntelligenceChange } from '../pages/intelligence/types.js';

const SEVERITY_COLOR: Record<string, string> = {
  info: 'blue',
  notable: 'gold',
  critical: 'red',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  /** Called before navigation away (e.g. to surface a workflow-lock guard). */
  guardNavigation?: () => boolean;
}

export function ChangesInboxBell({ guardNavigation }: Props) {
  const api = useApi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // Pull recent changes for the dropdown. 7-day window mirrors the unread
  // count query in AppShell so the numbers match; cap to 25 client-side so
  // the dropdown never overflows.
  const changesQuery = useQuery<IntelligenceChange[]>({
    queryKey: ['intel-changes-bell'],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return (await api.get<IntelligenceChange[]>('/api/intelligence/changes', { params: { since } })).data;
    },
    enabled: open,
    staleTime: 60_000,
    refetchInterval: open ? 60_000 : false,
  });

  const allChanges = changesQuery.data ?? [];
  const sortedChanges = useMemo(
    () =>
      [...allChanges]
        .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
        .slice(0, 25),
    [allChanges],
  );
  const unreadCount = useMemo(() => allChanges.filter((c) => !c.consumed).length, [allChanges]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/api/intelligence/changes/${id}`, { consumed: true });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-changes-bell'] });
      void qc.invalidateQueries({ queryKey: ['intel-changes-unread'] });
      void qc.invalidateQueries({ queryKey: ['intel-changes-inbox'] });
    },
    onError: () => {
      // Backend endpoint may not be wired yet, fail silently so the bell
      // stays usable. The full inbox page does the same.
    },
  });

  const goTo = (path: string) => {
    if (guardNavigation && !guardNavigation()) return;
    setOpen(false);
    navigate(path);
  };

  const renderContent = () => (
    <div
      style={{
        width: 380,
        maxHeight: 520,
        background: 'var(--bg-surface, #fff)',
        border: '1px solid var(--border-1, #e3e6ec)',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-1, #e3e6ec)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>
          Changes Inbox
        </Typography.Text>
        {unreadCount > 0 && (
          <Tag color="blue" style={{ marginLeft: 'auto', marginRight: 0, fontSize: 11 }}>
            {unreadCount} unread
          </Tag>
        )}
      </header>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {changesQuery.isLoading ? (
          <div style={{ padding: 14 }}>
            <Skeleton active paragraph={{ rows: 3 }} />
          </div>
        ) : sortedChanges.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No recent changes"
              imageStyle={{ height: 40 }}
            />
          </div>
        ) : (
          <List
            size="small"
            dataSource={sortedChanges}
            renderItem={(item) => {
              const isUnread = !item.consumed;
              return (
                <List.Item
                  key={item.id}
                  style={{
                    padding: '10px 14px',
                    background: isUnread ? 'var(--accent-soft, rgba(42,87,206,0.04))' : 'transparent',
                    cursor: 'pointer',
                    alignItems: 'flex-start',
                  }}
                  onClick={() => goTo('/intelligence/changes')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                      <Tag
                        color={SEVERITY_COLOR[item.severity] ?? 'default'}
                        style={{ fontSize: 10, padding: '0 6px', margin: 0, lineHeight: '16px' }}
                      >
                        {item.severity}
                      </Tag>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                      >
                        {item.source}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                        {relativeTime(item.detectedAt)}
                      </Typography.Text>
                    </div>
                    <Typography.Text
                      strong={isUnread}
                      style={{ fontSize: 13, display: 'block', lineHeight: 1.35 }}
                    >
                      {item.title}
                    </Typography.Text>
                    {item.description && (
                      <Typography.Paragraph
                        type="secondary"
                        ellipsis={{ rows: 2 }}
                        style={{ fontSize: 12, margin: '2px 0 0', lineHeight: 1.4 }}
                      >
                        {item.description}
                      </Typography.Paragraph>
                    )}
                  </div>
                  {isUnread && (
                    <Tooltip title="Mark as read">
                      <Button
                        type="text"
                        size="small"
                        icon={<CheckOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          markRead.mutate(item.id);
                        }}
                        loading={markRead.isPending && markRead.variables === item.id}
                      />
                    </Tooltip>
                  )}
                </List.Item>
              );
            }}
          />
        )}
      </div>

      <footer
        style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--border-1, #e3e6ec)',
          background: 'var(--bg-surface-2, #f7f8fa)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Button
          type="link"
          size="small"
          style={{ padding: 0, fontSize: 12 }}
          onClick={() => goTo('/intelligence/changes')}
        >
          View all in Changes Inbox →
        </Button>
      </footer>
    </div>
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={['click']}
      placement="bottomRight"
      dropdownRender={renderContent}
    >
      <button
        className="app-topbar-icon-button"
        type="button"
        aria-label={
          unreadCount > 0
            ? `Open changes inbox (${unreadCount} unread)`
            : 'Open changes inbox'
        }
      >
        <Badge count={unreadCount} size="small" offset={[-2, 2]}>
          <BellOutlined />
        </Badge>
      </button>
    </Dropdown>
  );
}
