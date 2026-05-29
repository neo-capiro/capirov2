import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Empty, InputNumber, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../../lib/use-api.js';
import { getMarkupMonitor } from './api.js';
import type { ProgramElementMarkupMonitorItem } from './types.js';

const { Text } = Typography;

function dollarsMm(value: number | null | undefined): string {
  if (value == null) return '-';
  return `$${value.toFixed(2)}m`;
}

function ratioToRequest(mark: number | null, request: number | null): number | null {
  if (mark == null || request == null || request === 0) return null;
  return (mark / request) * 100;
}

function colorForRatio(ratio: number | null): 'green' | 'gold' | 'red' | 'default' {
  if (ratio == null) return 'default';
  if (ratio > 110) return 'green';
  if (ratio >= 95) return 'gold';
  return 'red';
}

function MarkCell({ value, request }: { value: number | null; request: number | null }) {
  const ratio = ratioToRequest(value, request);
  const color = colorForRatio(ratio);

  return (
    <Tag color={color} data-testid={`mark-cell-${color}`}>
      {dollarsMm(value)}
    </Tag>
  );
}

function DivergenceBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        aria-hidden
        style={{
          width: 96,
          height: 8,
          borderRadius: 999,
          background: '#f0f0f0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            background: '#1677ff',
          }}
        />
      </div>
      <Text>{value.toFixed(1)}%</Text>
    </div>
  );
}

export function MarkupMonitorPage() {
  const api = useApi();
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [divergenceThreshold, setDivergenceThreshold] = useState<number>(0);

  const monitorQuery = useQuery({
    queryKey: ['program-element-markup-monitor', serviceFilter, divergenceThreshold],
    queryFn: () =>
      getMarkupMonitor(api, {
        service: serviceFilter === 'all' ? undefined : serviceFilter,
        divergence_threshold: divergenceThreshold,
      }),
    staleTime: 60 * 1000,
  });

  const rows = monitorQuery.data?.data ?? [];

  const serviceOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((row) => row.service).filter((v): v is string => Boolean(v && v.trim()))));
    return [
      { label: 'All services', value: 'all' },
      ...values.sort((a, b) => a.localeCompare(b)).map((value) => ({ label: value, value })),
    ];
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows
      .filter((row) => (serviceFilter === 'all' ? true : row.service === serviceFilter))
      .filter((row) => row.divergencePct >= divergenceThreshold);
  }, [rows, serviceFilter, divergenceThreshold]);

  const columns: ColumnsType<ProgramElementMarkupMonitorItem> = [
    {
      title: 'PE code',
      dataIndex: 'peCode',
      key: 'peCode',
      sorter: (a, b) => a.peCode.localeCompare(b.peCode),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
    },
    {
      title: 'Request',
      dataIndex: 'request',
      key: 'request',
      render: (value: number | null) => dollarsMm(value),
      sorter: (a, b) => (a.request ?? -1) - (b.request ?? -1),
    },
    {
      title: 'HASC',
      dataIndex: 'hascMark',
      key: 'hascMark',
      render: (_value: number | null, row) => <MarkCell value={row.hascMark} request={row.request} />,
    },
    {
      title: 'SASC',
      dataIndex: 'sascMark',
      key: 'sascMark',
      render: (_value: number | null, row) => <MarkCell value={row.sascMark} request={row.request} />,
    },
    {
      title: 'HAC-D',
      dataIndex: 'hacDMark',
      key: 'hacDMark',
      render: (_value: number | null, row) => <MarkCell value={row.hacDMark} request={row.request} />,
    },
    {
      title: 'SAC-D',
      dataIndex: 'sacDMark',
      key: 'sacDMark',
      render: (_value: number | null, row) => <MarkCell value={row.sacDMark} request={row.request} />,
    },
    {
      title: 'Divergence',
      dataIndex: 'divergencePct',
      key: 'divergencePct',
      sorter: (a, b) => a.divergencePct - b.divergencePct,
      defaultSortOrder: 'descend',
      render: (value: number) => <DivergenceBar value={value} />,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space size={16} wrap>
          <Space direction="vertical" size={4}>
            <Text type="secondary">Service</Text>
            <Select
              style={{ width: 220 }}
              options={serviceOptions}
              value={serviceFilter}
              onChange={(value) => setServiceFilter(value)}
            />
          </Space>
          <Space direction="vertical" size={4}>
            <Text type="secondary">Divergence threshold</Text>
            <InputNumber
              min={0}
              max={100}
              step={1}
              value={divergenceThreshold}
              onChange={(value) => setDivergenceThreshold(value ?? 0)}
              addonAfter="%"
            />
          </Space>
        </Space>
      </Card>

      <Card title="Program Element Mark-Up Monitor">
        <Table<ProgramElementMarkupMonitorItem>
          rowKey="peCode"
          dataSource={filteredRows}
          columns={columns}
          loading={monitorQuery.isLoading}
          pagination={false}
          locale={{
            emptyText: <Empty description="Watch some PEs to populate this view" />,
          }}
        />
      </Card>
    </Space>
  );
}
