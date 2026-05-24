import {
  BellOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Empty, List, Spin, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/use-api.js';
import type { Client } from './clients/clientTypes.js';
import type { CommentAlert, IntelligenceChange } from './intelligence/types.js';

const SEVERITY_COLOR: Record<string, string> = {
  info: 'blue',
  notable: 'gold',
  critical: 'red',
};

export function HomePage() {
  const api = useApi();

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
    staleTime: 60_000,
  });

  const intelChanges = useQuery<IntelligenceChange[]>({
    queryKey: ['intel-changes-recent'],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return (
        await api.get<IntelligenceChange[]>('/api/intelligence/changes', { params: { since } })
      ).data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const commentAlerts = useQuery<{ alerts: CommentAlert[] }>({
    queryKey: ['comment-alerts'],
    queryFn: async () => {
      try {
        return (await api.get<{ alerts: CommentAlert[] }>('/api/intelligence/comment-alerts')).data;
      } catch {
        return { alerts: [] };
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const activeClients = (clients.data ?? []).filter((c) => c.status !== 'archived');
  const changes = intelChanges.data ?? [];
  const unreadCount = changes.filter((c) => !c.consumed).length;
  const alertList = commentAlerts.data?.alerts ?? [];

  return (
    <section className="command-page">
      <div className="command-summary-grid">
        <CommandMetricCard
          icon={<BellOutlined />}
          label="Intelligence Updates"
          value={unreadCount}
          loading={intelChanges.isLoading}
        />
        <CommandMetricCard
          icon={<WarningOutlined />}
          label="Comment Alerts"
          value={alertList.length}
          loading={commentAlerts.isLoading}
        />
        <CommandMetricCard
          icon={<TeamOutlined />}
          label="Active Clients"
          value={activeClients.length}
          loading={clients.isLoading}
        />
      </div>

      <Card
        title={
          <span>
            Intelligence Updates{' '}
            <Badge count={unreadCount} overflowCount={99} style={{ marginLeft: 4 }} />
          </span>
        }
        extra={<Link to="/intelligence/changes">View All →</Link>}
        style={{ marginBottom: 24 }}
      >
        {intelChanges.isLoading ? (
          <Spin />
        ) : changes.length ? (
          <List
            size="small"
            dataSource={changes}
            pagination={{ pageSize: 25, showSizeChanger: false }}
            renderItem={(change) => (
              <List.Item style={{ padding: '8px 0', gap: 8, flexWrap: 'nowrap' }}>
                <Tag
                  color={SEVERITY_COLOR[change.severity] ?? 'default'}
                  style={{ textTransform: 'capitalize', flexShrink: 0, fontSize: 11 }}
                >
                  {change.severity}
                </Tag>
                <Typography.Text
                  style={{ flex: 1, fontSize: 13, minWidth: 0 }}
                  ellipsis={{ tooltip: change.title }}
                >
                  {change.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                  {relativeTime(change.detectedAt)}
                </Typography.Text>
              </List.Item>
            )}
          />
        ) : (
          <Empty
            description="No intelligence changes detected yet. Data will appear after the next sync cycle."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Card>

      {alertList.length > 0 ? (
        <Card title="Comment Period Alerts">
          {alertList.map((alert) => (
            <Alert
              key={alert.documentId}
              type={
                alert.daysToDeadline < 3
                  ? 'error'
                  : alert.daysToDeadline <= 7
                    ? 'warning'
                    : 'info'
              }
              message={
                <span style={{ fontSize: 12 }}>
                  <strong>{alert.daysToDeadline}d left</strong>
                  {' — '}
                  {alert.title.length > 60 ? alert.title.slice(0, 60) + '…' : alert.title}
                </span>
              }
              description={
                <span style={{ fontSize: 11 }}>
                  {alert.agencies.slice(0, 2).join(' / ')}
                  {alert.agencies.length > 2 ? ` +${alert.agencies.length - 2}` : ''}
                </span>
              }
              showIcon
              style={{ marginBottom: 8 }}
            />
          ))}
        </Card>
      ) : null}
    </section>
  );
}

function CommandMetricCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <Card className="command-metric-card">
      <div className="command-metric-icon">{icon}</div>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Title level={3}>{loading ? '-' : value}</Typography.Title>
    </Card>
  );
}

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
