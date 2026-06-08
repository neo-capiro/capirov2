import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
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
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
}

interface QueueResponse {
  data: ReconciliationEntry[];
  total: number;
  page: number;
  limit: number;
}

type ResolveDecision = 'keep_current' | 'accept_conflicting' | 'manual_value';
type StatusFilter = 'open' | 'resolved' | 'all';

/**
 * Step 29 / 0.2 — cross-source reconciliation review queue (capiro_admin only).
 * Surfaces budget-field conflicts (>10% delta on non-enacted fields, any conflict on enacted)
 * and lets an admin resolve each: keep the canonical value, accept the conflicting source's
 * value, or enter a manual value. Accept/manual write through the writer's manual_override path.
 */
export function PeReconciliationPage() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const isCapiroAdmin = me.data?.role === 'capiro_admin';

  const [status, setStatus] = useState<StatusFilter>('open');
  const [pending, setPending] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<ReconciliationEntry | null>(null);
  const [form] = Form.useForm<{ manualValue: number; notes?: string }>();

  const queue = useQuery({
    queryKey: ['reconciliation-queue', status],
    enabled: isCapiroAdmin,
    queryFn: async (): Promise<QueueResponse> =>
      (await api.get<QueueResponse>('/api/program-elements/admin/reconciliation-queue', { params: { status } })).data,
  });

  const resolve = useMutation({
    mutationFn: (vars: { id: string; decision: ResolveDecision; manualValue?: number; notes?: string }) =>
      api.post(`/api/program-elements/admin/reconciliation-queue/${encodeURIComponent(vars.id)}/resolve`, {
        decision: vars.decision,
        manualValue: vars.manualValue,
        notes: vars.notes,
      }),
    onMutate: (vars) => setPending(vars.id),
    onSuccess: (_res, vars) => {
      message.success(
        vars.decision === 'keep_current'
          ? 'Kept the canonical value.'
          : vars.decision === 'accept_conflicting'
            ? 'Accepted the conflicting value — canonical updated.'
            : 'Manual value applied — canonical updated.',
      );
      setManualFor(null);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['reconciliation-queue'] });
    },
    onError: (e: unknown) => message.error(`Resolve failed: ${(e as Error).message}`),
    onSettled: () => setPending(null),
  });

  const columns: ColumnsType<ReconciliationEntry> = useMemo(
    () => [
      { title: 'PE Code', dataIndex: 'peCode', key: 'peCode', render: (v: string) => <Text code>{v}</Text> },
      { title: 'FY', dataIndex: 'fy', key: 'fy', width: 70 },
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
        width: 80,
        render: (v: number | null) =>
          v === null ? '—' : <Tag color={v > 0.1 ? 'volcano' : 'gold'}>{(v * 100).toFixed(1)}%</Tag>,
      },
      {
        title: 'Action',
        key: 'action',
        width: 240,
        render: (_v: unknown, r: ReconciliationEntry) =>
          r.status !== 'open' ? (
            <Tag color={r.status === 'resolved' ? 'green' : 'default'}>{r.status}</Tag>
          ) : (
            <Space size="small">
              <Popconfirm
                title="Keep the canonical value?"
                description="Marks this conflict reviewed; no value change."
                okText="Keep"
                onConfirm={() => resolve.mutate({ id: r.id, decision: 'keep_current' })}
              >
                <Button size="small" loading={pending === r.id}>
                  Keep
                </Button>
              </Popconfirm>
              <Popconfirm
                title={`Accept ${r.conflictingSource}'s value (${r.conflictingValue ?? '—'})?`}
                description="Sets it as the canonical value (admin override)."
                okText="Accept"
                onConfirm={() => resolve.mutate({ id: r.id, decision: 'accept_conflicting' })}
              >
                <Button type="primary" size="small" loading={pending === r.id}>
                  Accept
                </Button>
              </Popconfirm>
              <Button
                size="small"
                loading={pending === r.id}
                onClick={() => {
                  form.resetFields();
                  setManualFor(r);
                }}
              >
                Manual…
              </Button>
            </Space>
          ),
      },
    ],
    [pending, resolve, form],
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
        disagreement on the enacted (appropriated) value. The canonical value follows source priority; resolve each entry
        by keeping the canonical value, accepting the conflicting source, or entering a manual value (in $ millions).
      </Paragraph>
      <Space style={{ marginBottom: 16 }}>
        <Text>Status:</Text>
        <Select<StatusFilter>
          value={status}
          onChange={(v) => setStatus(v)}
          style={{ width: 160 }}
          aria-label="status filter"
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
        />
      </Space>
      {queue.isError && (
        <Alert type="error" message="Failed to load the reconciliation queue." showIcon style={{ marginBottom: 16 }} />
      )}
      <Table
        rowKey="id"
        loading={queue.isLoading}
        columns={columns}
        dataSource={queue.data?.data ?? []}
        pagination={{ pageSize: 25, total: queue.data?.total ?? 0 }}
        locale={{ emptyText: `No ${status} reconciliation entries.` }}
      />
      <Modal
        open={!!manualFor}
        title={`Manual value — ${manualFor?.peCode ?? ''} FY${manualFor?.fy ?? ''} ${manualFor?.fieldName ?? ''}`}
        okText="Apply value"
        confirmLoading={resolve.isPending}
        onCancel={() => setManualFor(null)}
        onOk={() => {
          void form.validateFields().then((v) => {
            if (manualFor) {
              resolve.mutate({ id: manualFor.id, decision: 'manual_value', manualValue: v.manualValue, notes: v.notes });
            }
          });
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Value ($ millions)"
            name="manualValue"
            rules={[{ required: true, message: 'Enter a numeric value in $ millions' }]}
          >
            <InputNumber style={{ width: '100%' }} step={0.01} />
          </Form.Item>
          <Form.Item label="Notes (optional)" name="notes">
            <Input.TextArea rows={2} placeholder="Why this value?" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default PeReconciliationPage;
