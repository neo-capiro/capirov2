import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Col,
  Input,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { useApi } from '../../../lib/use-api.js';
import type { FederalRegisterDoc, PagedResult } from '../types.js';

const { Text } = Typography;

export function RegulationsPanel() {
  const api = useApi();
  const [agency, setAgency] = useState('');
  const [queryAgency, setQueryAgency] = useState('');
  const [docType, setDocType] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const typeColors: Record<string, string> = {
    RULE: 'red',
    PROPOSED_RULE: 'orange',
    NOTICE: 'blue',
    PRESIDENTIAL_DOCUMENT: 'purple',
  };

  function daysTill(dateStr: string): number {
    return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  const deadlines = useQuery<FederalRegisterDoc[]>({
    queryKey: ['federal-register-deadlines'],
    queryFn: async () =>
      (await api.get<FederalRegisterDoc[]>('/api/federal-register/upcoming-deadlines')).data,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const docs = useQuery<PagedResult<FederalRegisterDoc>>({
    queryKey: ['federal-register-docs', page, queryAgency, docType],
    queryFn: async () =>
      (await api.get<PagedResult<FederalRegisterDoc>>('/api/federal-register/documents', {
        params: { page, limit: 25, agency: queryAgency || undefined, type: docType || undefined },
      })).data,
    staleTime: 60 * 1000,
    retry: 1,
  });

  function applySearch() {
    setQueryAgency(agency);
    setPage(1);
  }

  return (
    <div>
      {/* Upcoming deadlines strip */}
      {!deadlines.isLoading && (deadlines.data?.length ?? 0) > 0 && (
        <Card
          size="small"
          title={<Space><CalendarOutlined style={{ color: '#ef4444' }} /><span>Upcoming Comment Deadlines</span></Space>}
          style={{ marginBottom: 16 }}
        >
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {(deadlines.data ?? []).slice(0, 10).map((doc) => {
              const days = daysTill(doc.commentEndDate!);
              const urgent = days <= 7;
              return (
                <Card
                  key={doc.id}
                  size="small"
                  style={{
                    minWidth: 200,
                    maxWidth: 240,
                    borderLeft: `3px solid ${urgent ? '#ef4444' : '#f59e0b'}`,
                    flexShrink: 0,
                  }}
                  styles={{ body: { padding: '8px 10px' } }}
                >
                  <Tag
                    color={typeColors[doc.type] ?? 'default'}
                    style={{ marginBottom: 4, fontSize: 10 }}
                  >
                    {doc.type.replace(/_/g, ' ')}
                  </Tag>
                  <Tooltip title={doc.title}>
                    <Text ellipsis style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                      {doc.title}
                    </Text>
                  </Tooltip>
                  <Text strong style={{ fontSize: 14, color: urgent ? '#ef4444' : '#f59e0b' }}>
                    {days <= 0 ? 'Closed' : `${days}d left`}
                  </Text>
                </Card>
              );
            })}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col flex="1">
            <Input
              placeholder="Filter by agency…"
              value={agency}
              onChange={(e) => setAgency(e.target.value)}
              onPressEnter={applySearch}
            />
          </Col>
          <Col style={{ width: 200 }}>
            <Select
              style={{ width: '100%' }}
              placeholder="Document type"
              allowClear
              value={docType}
              onChange={(v) => { setDocType(v); setPage(1); }}
              options={[
                { label: 'Rule', value: 'RULE' },
                { label: 'Proposed Rule', value: 'PROPOSED_RULE' },
                { label: 'Notice', value: 'NOTICE' },
                { label: 'Presidential Document', value: 'PRESIDENTIAL_DOCUMENT' },
              ]}
            />
          </Col>
          <Col>
            <Input.Search enterButton="Search" onSearch={applySearch} style={{ width: 100 }} />
          </Col>
        </Row>
      </Card>

      {docs.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : docs.isError ? (
        <Alert
          type="warning"
          showIcon
          message="Federal Register data not yet synced"
          description={
            <span>
              Run <Text code>pnpm --filter @capiro/api sync:federal-register</Text> to populate.
            </span>
          }
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Table<FederalRegisterDoc>
          size="small"
          rowKey="id"
          dataSource={docs.data?.data ?? []}
          loading={docs.isFetching}
          onRow={(record) => {
            if (!record.commentEndDate) return {};
            const days = daysTill(record.commentEndDate);
            if (days > 0 && days <= 7) return { style: { background: 'rgba(239,68,68,0.06)' } };
            if (days > 0 && days <= 14) return { style: { background: 'rgba(245,158,11,0.06)' } };
            return {};
          }}
          pagination={{
            current: page,
            pageSize: 25,
            total: docs.data?.total ?? 0,
            onChange: (p) => setPage(p),
            showTotal: (t) => `${t.toLocaleString()} documents`,
          }}
          columns={[
            {
              title: 'Date',
              dataIndex: 'publicationDate',
              width: 95,
              render: (v: string) =>
                new Date(v).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: '2-digit',
                }),
            },
            {
              title: 'Type',
              dataIndex: 'type',
              width: 130,
              render: (v: string) => (
                <Tag color={typeColors[v] ?? 'default'} style={{ fontSize: 10 }}>
                  {v.replace(/_/g, ' ')}
                </Tag>
              ),
            },
            {
              title: 'Title',
              dataIndex: 'title',
              render: (t: string, r: FederalRegisterDoc) =>
                r.htmlUrl ? (
                  <a href={r.htmlUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    {t}
                  </a>
                ) : (
                  <Text style={{ fontSize: 12 }}>{t}</Text>
                ),
            },
            {
              title: 'Agencies',
              dataIndex: 'agencyNames',
              width: 200,
              render: (agencyNames: string[]) => (
                <Space size={[2, 4]} wrap>
                  {(agencyNames ?? []).slice(0, 2).map((a) => (
                    <Tag key={a} style={{ fontSize: 10, margin: 0 }}>
                      {a}
                    </Tag>
                  ))}
                  {(agencyNames?.length ?? 0) > 2 && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      +{agencyNames.length - 2}
                    </Text>
                  )}
                </Space>
              ),
            },
            {
              title: 'Comment Deadline',
              dataIndex: 'commentEndDate',
              width: 145,
              render: (v: string | null) => {
                if (!v) return <Text type="secondary">—</Text>;
                const days = daysTill(v);
                const color = days <= 7 ? '#ef4444' : days <= 14 ? '#f59e0b' : undefined;
                return (
                  <Space size={4}>
                    <Text style={{ fontSize: 12, color }}>
                      {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                    {days > 0 && days <= 30 && (
                      <Tag color={days <= 7 ? 'red' : 'orange'} style={{ fontSize: 10, margin: 0 }}>
                        {days}d
                      </Tag>
                    )}
                    {days <= 0 && (
                      <Tag color="default" style={{ fontSize: 10, margin: 0 }}>closed</Tag>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}
