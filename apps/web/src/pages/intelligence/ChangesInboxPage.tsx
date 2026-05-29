import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  notification,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type { CommentAlert, IntelligenceChange } from './types.js';

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

const SEVERITY_COLOR: Record<string, string> = {
  info: 'blue',
  notable: 'gold',
  critical: 'red',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function ChangesInboxPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [notifApi, contextHolder] = notification.useNotification();

  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedSeverity, setSelectedSeverity] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [drawerRecord, setDrawerRecord] = useState<IntelligenceChange | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const changesQuery = useQuery<IntelligenceChange[]>({
    queryKey: ['intel-changes-inbox', selectedSource, selectedSeverity, dateRange],
    queryFn: async () =>
      (
        await api.get<IntelligenceChange[]>('/api/intelligence/changes', {
          params: {
            ...(selectedSource ? { source: selectedSource } : {}),
            ...(dateRange[0] ? { since: dateRange[0] } : {}),
          },
        })
      ).data,
    staleTime: 2 * 60 * 1000,
  });

  const commentAlertsQuery = useQuery<{ alerts: CommentAlert[] }>({
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

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/api/intelligence/changes/${id}`, { consumed: true });
    },
    onSuccess: (_data, id) => {
      setReadIds((prev) => new Set([...prev, id]));
      void qc.invalidateQueries({ queryKey: ['intel-changes-inbox'] });
      void qc.invalidateQueries({ queryKey: ['intel-changes-unread'] });
    },
    onError: () => {
      /* silently ignore, backend endpoint may not exist yet */
    },
  });

  const allChanges = changesQuery.data ?? [];

  const filteredChanges = useMemo(() => {
    let data = allChanges;
    if (selectedSeverity) data = data.filter((c) => c.severity === selectedSeverity);
    if (dateRange[1]) {
      const end = new Date(dateRange[1]).getTime();
      data = data.filter((c) => new Date(c.detectedAt).getTime() <= end);
    }
    return [...data].sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    );
  }, [allChanges, selectedSeverity, dateRange]);

  const distinctSources = useMemo(
    () => [...new Set(allChanges.map((c) => c.source))].sort(),
    [allChanges],
  );

  const groupedCommentAlerts = useMemo(() => {
    const alerts = commentAlertsQuery.data?.alerts ?? [];
    const groups = new Map<string, { alert: CommentAlert; clients: string[] }>();
    for (const alert of alerts) {
      const existing = groups.get(alert.documentId);
      if (existing) {
        if (!existing.clients.includes(alert.clientName)) existing.clients.push(alert.clientName);
      } else {
        groups.set(alert.documentId, { alert, clients: [alert.clientName] });
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.alert.daysToDeadline - b.alert.daysToDeadline);
  }, [commentAlertsQuery.data]);

  const unreadCount = filteredChanges.filter(
    (c) => !readIds.has(c.id) && !(c as IntelligenceChange & { consumed?: boolean }).consumed,
  ).length;

  function handleRowClick(record: IntelligenceChange) {
    setDrawerRecord(record);
    if (!readIds.has(record.id)) {
      markReadMutation.mutate(record.id);
    }
  }

  function handleResolveAll() {
    notifApi.info({ message: 'Use the Intelligence Mappings page to resolve entity mappings.' });
  }

  const columns: ColumnsType<IntelligenceChange> = [
    {
      title: 'Severity',
      dataIndex: 'severity',
      width: 100,
      render: (sev: string) => (
        <Tag color={SEVERITY_COLOR[sev] ?? 'default'} style={{ textTransform: 'capitalize' }}>
          {sev}
        </Tag>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'source',
      width: 140,
      render: (src: string) => <Tag>{src}</Tag>,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      render: (title: string, record) => {
        const isRead =
          readIds.has(record.id) ||
          (record as IntelligenceChange & { consumed?: boolean }).consumed;
        return (
          <Text strong={!isRead} style={{ color: isRead ? '#8c8c8c' : undefined }}>
            {title}
          </Text>
        );
      },
    },
    {
      title: 'Description',
      dataIndex: 'description',
      ellipsis: true,
      render: (desc: string) => (
        <Tooltip title={desc}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {desc.length > 120 ? desc.slice(0, 120) + '…' : desc}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Detected',
      dataIndex: 'detectedAt',
      width: 130,
      render: (dt: string) => (
        <Tooltip title={new Date(dt).toLocaleString()}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {relativeTime(dt)}
          </Text>
        </Tooltip>
      ),
    },
  ];

  return (
    <div
      className="redesign"
      style={{ padding: '24px 32px', overflow: 'auto', height: '100%', background: 'var(--bg-canvas)' }}
    >
      {contextHolder}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <AlertOutlined style={{ fontSize: 22, color: '#faad14' }} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Changes Inbox
        </Typography.Title>
        <Badge count={unreadCount} overflowCount={99} />
        <span style={{ flex: 1 }} />
        <Button size="small" type="default" onClick={handleResolveAll}>
          Resolve All Clients
        </Button>
      </div>

      {/* Comment Period Alerts */}
      {(groupedCommentAlerts.length > 0 || commentAlertsQuery.isLoading) && (
        <Card
          size="small"
          title={
            <Space>
              <AlertOutlined style={{ color: '#ff4d4f' }} />
              <span>Open Comment Periods</span>
              {groupedCommentAlerts.length > 0 && (
                <Badge count={groupedCommentAlerts.length} style={{ backgroundColor: '#ff4d4f' }} />
              )}
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {commentAlertsQuery.isLoading ? (
            <Skeleton active paragraph={{ rows: 2 }} />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {groupedCommentAlerts.map(({ alert, clients }) => {
                const borderColor =
                  alert.daysToDeadline < 3 ? '#ff4d4f'
                    : alert.daysToDeadline <= 7 ? '#faad14'
                    : '#1677ff';
                const tagColor =
                  alert.daysToDeadline < 3 ? 'red'
                    : alert.daysToDeadline <= 7 ? 'gold'
                    : 'blue';
                return (
                  <Card
                    key={alert.documentId}
                    size="small"
                    style={{
                      borderLeft: `4px solid ${borderColor}`,
                      minWidth: 220,
                      maxWidth: 340,
                      flex: '1 1 220px',
                      boxShadow: alert.daysToDeadline < 3 ? `0 0 10px ${borderColor}30` : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <Tooltip title={alert.title}>
                        <Text strong style={{ fontSize: 12, flex: 1 }}>
                          {alert.title.length > 80 ? alert.title.slice(0, 80) + '…' : alert.title}
                        </Text>
                      </Tooltip>
                      <Tag color={tagColor} style={{ flexShrink: 0 }}>{alert.daysToDeadline}d left</Tag>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {alert.agencies.slice(0, 2).join(' / ')}
                        {alert.agencies.length > 2 ? ` +${alert.agencies.length - 2}` : ''}
                      </Text>
                    </div>
                    {clients.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <Space wrap size={[2, 2]}>
                          {clients.map((c) => (
                            <Tag key={c} style={{ fontSize: 10 }}>{c}</Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Filter bar */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            mode="multiple"
            placeholder="Source"
            style={{ minWidth: 200 }}
            value={selectedSource ? [selectedSource] : []}
            onChange={(vals: string[]) => setSelectedSource(vals[0])}
            options={distinctSources.map((s) => ({ label: s, value: s }))}
          />
          <Select
            allowClear
            placeholder="Severity"
            style={{ width: 140 }}
            value={selectedSeverity}
            onChange={(v) => setSelectedSeverity(v ?? undefined)}
            options={[
              { label: 'All', value: '' },
              { label: 'Info', value: 'info' },
              { label: 'Notable', value: 'notable' },
              { label: 'Critical', value: 'critical' },
            ]}
          />
          <RangePicker
            onChange={(_, strs) => setDateRange([strs[0] || null, strs[1] || null])}
          />
        </Space>
      </Card>

      <Table<IntelligenceChange>
        rowKey="id"
        dataSource={filteredChanges}
        columns={columns}
        loading={changesQuery.isLoading}
        pagination={{ pageSize: 25, showSizeChanger: false }}
        onRow={(record) => ({ onClick: () => handleRowClick(record), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="No changes found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        rowClassName={(record) => {
          const isRead =
            readIds.has(record.id) ||
            (record as IntelligenceChange & { consumed?: boolean }).consumed;
          return isRead ? 'changes-inbox-row--read' : '';
        }}
      />

      <Drawer
        title={drawerRecord?.title ?? 'Change Detail'}
        open={!!drawerRecord}
        onClose={() => setDrawerRecord(null)}
        width={520}
        extra={
          drawerRecord && (
            <Tag color={SEVERITY_COLOR[drawerRecord.severity] ?? 'default'} style={{ textTransform: 'capitalize' }}>
              {drawerRecord.severity}
            </Tag>
          )
        }
      >
        {drawerRecord && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Source</Text>
              <div><Tag>{drawerRecord.source}</Tag></div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Detected</Text>
              <div>
                <Text>{new Date(drawerRecord.detectedAt).toLocaleString()}</Text>
              </div>
            </div>
            {drawerRecord.relatedIssues.length > 0 && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Related Issues</Text>
                <div style={{ marginTop: 4 }}>
                  {drawerRecord.relatedIssues.map((iss) => (
                    <Tag key={iss} style={{ marginBottom: 4 }}>{iss}</Tag>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray((drawerRecord as IntelligenceChange & { relatedPeCodes?: string[] }).relatedPeCodes) &&
              ((drawerRecord as IntelligenceChange & { relatedPeCodes?: string[] }).relatedPeCodes?.length ?? 0) > 0 && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Program Elements</Text>
                  <div style={{ marginTop: 4 }}>
                    {(drawerRecord as IntelligenceChange & { relatedPeCodes?: string[] }).relatedPeCodes?.map((peCode) => (
                      <Tag
                        key={peCode}
                        color="blue"
                        role="button"
                        style={{ cursor: 'pointer', marginBottom: 4 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/program-elements/${encodeURIComponent(peCode)}`);
                        }}
                      >
                        PE {peCode}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Description</Text>
              <Paragraph style={{ marginTop: 4, fontSize: 13 }}>{drawerRecord.description}</Paragraph>
            </div>
            {Object.keys(drawerRecord.data).length > 0 && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Raw Data</Text>
                <pre
                  style={{
                    marginTop: 4,
                    padding: 12,
                    background: '#f5f5f5',
                    borderRadius: 4,
                    fontSize: 11,
                    overflow: 'auto',
                    maxHeight: 320,
                  }}
                >
                  {JSON.stringify(drawerRecord.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
