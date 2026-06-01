import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Result, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../../lib/use-api.js';
import { useMe } from '../../lib/me.js';

const { Title, Paragraph, Text } = Typography;

interface ReconciliationEntry {
  id: string;
  peCode: string;
  fy: number;
  fieldName: string;
  currentValue: string | null;
  conflictingSource: string;
  conflictingValue: string | null;
  deltaPct: number | null;
  queuedAt: string;
  status: string;
}

interface QueueResponse {
  data: ReconciliationEntry[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Step 29 — cross-source reconciliation review queue (capiro_admin only).
 * Surfaces budget-field conflicts flagged by the reconciliation service:
 * > 10% delta on non-enacted fields, or any conflict on the enacted field.
 */
export function PeReconciliationPage() {
  const api = useApi();
  const me = useMe();
  const isCapiroAdmin = me.data?.role === 'capiro_admin';

  const queue = useQuery({
    queryKey: ['reconciliation-queue', 'open'],
    enabled: isCapiroAdmin,
    queryFn: async (): Promise<QueueResponse> =>
      (await api.get<QueueResponse>('/program-elements/admin/reconciliation-queue', { params: { status: 'open' } })).data,
  });

  const columns: ColumnsType<ReconciliationEntry> = useMemo(
    () => [
      { title: 'PE Code', dataIndex: 'peCode', key: 'peCode', render: (v: string) => <Text code>{v}</Text> },
      { title: 'FY', dataIndex: 'fy', key: 'fy', width: 80 },
      {
        title: 'Field',
        dataIndex: 'fieldName',
        key: 'fieldName',
        render: (v: string) => <Tag color={v === 'enacted' ? 'red' : 'blue'}>{v}</Tag>,
      },
      { title: 'Canonical', dataIndex: 'currentValue', key: 'currentValue', render: (v: string | null) => v ?? '—' },
      { title: 'Conflicting source', dataIndex: 'conflictingSource', key: 'conflictingSource' },
      { title: 'Conflicting value', dataIndex: 'conflictingValue', key: 'conflictingValue', render: (v: string | null) => v ?? '—' },
      {
        title: 'Δ%',
        dataIndex: 'deltaPct',
        key: 'deltaPct',
        width: 90,
        render: (v: number | null) =>
          v === null ? '—' : <Tag color={v > 0.1 ? 'volcano' : 'gold'}>{(v * 100).toFixed(1)}%</Tag>,
      },
      {
        title: 'Queued',
        dataIndex: 'queuedAt',
        key: 'queuedAt',
        render: (v: string) => new Date(v).toLocaleString(),
      },
    ],
    [],
  );

  if (me.isLoading) return <Spin />;
  if (!isCapiroAdmin) {
    return <Result status="403" title="403" subTitle="Reconciliation review is restricted to Capiro administrators." />;
  }

  return (
    <Card>
      <Title level={3}>Reconciliation Review Queue</Title>
      <Paragraph type="secondary">
        Cross-source budget conflicts flagged for review: greater than 10% disagreement on a non-enacted field, or any
        disagreement on the enacted (appropriated) value. The canonical value follows source priority; entries here are
        lower-priority sources that diverge and warrant a human check.
      </Paragraph>
      {queue.isError && <Alert type="error" message="Failed to load the reconciliation queue." showIcon style={{ marginBottom: 16 }} />}
      <Table
        rowKey="id"
        loading={queue.isLoading}
        columns={columns}
        dataSource={queue.data?.data ?? []}
        pagination={{ pageSize: 25, total: queue.data?.total ?? 0 }}
        locale={{ emptyText: 'No open reconciliation conflicts.' }}
      />
    </Card>
  );
}

export default PeReconciliationPage;
