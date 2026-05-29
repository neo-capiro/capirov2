import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../lib/use-api.js';
import { getProgramElementsList } from './api.js';
import type { ProgramElementListItem } from './types.js';

const SERVICE_OPTIONS = [
  { label: 'All services', value: '' },
  { label: 'Army', value: 'ARMY' },
  { label: 'Navy', value: 'NAVY' },
  { label: 'Air Force', value: 'AIR_FORCE' },
  { label: 'Space Force', value: 'SPACE_FORCE' },
  { label: 'DoD', value: 'DOD' },
];

export function ProgramElementFinderPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [service, setService] = useState('');

  const listQuery = useQuery({
    queryKey: ['program-element-finder', term.trim(), service],
    queryFn: () =>
      getProgramElementsList(api, {
        q: term.trim() || undefined,
        service: service || undefined,
        page: 1,
        limit: 50,
      }),
    staleTime: 60 * 1000,
  });

  const rows = listQuery.data?.data ?? [];

  const columns: ColumnsType<ProgramElementListItem> = useMemo(
    () => [
      {
        title: 'PE code',
        dataIndex: 'peCode',
        key: 'peCode',
        width: 160,
        render: (value: string) => (
          <a onClick={() => navigate(`/program-elements/${encodeURIComponent(value)}`)}>{value}</a>
        ),
        sorter: (a, b) => a.peCode.localeCompare(b.peCode),
      },
      { title: 'Title', dataIndex: 'title', key: 'title', ellipsis: true },
      {
        title: 'Service',
        dataIndex: 'service',
        key: 'service',
        width: 140,
        render: (value: string | null) => <Tag>{value ?? '—'}</Tag>,
      },
      {
        title: 'Budget activity',
        dataIndex: 'budgetActivity',
        key: 'budgetActivity',
        width: 150,
        render: (value: string | null) => (value ? <Tag color="blue">{value}</Tag> : '—'),
      },
      {
        title: '',
        key: 'open',
        width: 100,
        render: (_value: unknown, row: ProgramElementListItem) => (
          <Button
            size="small"
            onClick={() => navigate(`/program-elements/${encodeURIComponent(row.peCode)}`)}
          >
            View
          </Button>
        ),
      },
    ],
    [navigate],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="Program Element Finder"
        extra={
          <Button onClick={() => navigate('/program-elements/mark-up-monitor')}>Mark-up Monitor</Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Search by PE code or title, then open a Program Element to watch it and review its history.
        </Typography.Paragraph>

        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search code or title (e.g. 0603270A, electronic warfare)"
            style={{ width: 460 }}
            allowClear
          />
          <Select
            value={service}
            onChange={(value) => setService(value)}
            options={SERVICE_OPTIONS}
            style={{ width: 180 }}
          />
        </Space>

        {listQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="Unable to load program elements"
            description={listQuery.error instanceof Error ? listQuery.error.message : 'Please retry in a moment.'}
          />
        ) : (
          <Table<ProgramElementListItem>
            rowKey="peCode"
            loading={listQuery.isLoading}
            dataSource={rows}
            columns={columns}
            pagination={false}
            locale={{
              emptyText: <Empty description="No program elements matched your search" />,
            }}
          />
        )}
      </Card>
    </Space>
  );
}
