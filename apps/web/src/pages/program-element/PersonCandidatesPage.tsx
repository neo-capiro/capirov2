import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../../lib/use-api.js';
import { useMe } from '../../lib/me.js';
import { getPersonCandidates, resolvePersonCandidate, suggestPersonForPe } from './api.js';
import type { PersonCandidate } from './types.js';

const { Title, Paragraph, Text } = Typography;

/** Score -> colored confidence tag. */
function scoreTag(score: number) {
  const pct = Math.round(score * 100);
  const color = score >= 0.85 ? 'green' : score >= 0.7 ? 'gold' : 'default';
  return <Tag color={color}>{pct}%</Tag>;
}

/** capiro_admin view: review queue with confirm/reject. */
function ReviewQueue() {
  const api = useApi();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['pe-person-candidates', 'open'],
    queryFn: () => getPersonCandidates(api, { status: 'open', limit: 200 }),
    staleTime: 30_000,
  });

  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'confirm' | 'reject' }) =>
      resolvePersonCandidate(api, id, decision),
    onMutate: ({ id }) => setPending(id),
    onSuccess: (res, { decision }) => {
      message.success(
        decision === 'confirm'
          ? res.linked
            ? 'Confirmed — person linked to PE.'
            : 'Confirmed (person was already linked).'
          : 'Rejected.',
      );
      void qc.invalidateQueries({ queryKey: ['pe-person-candidates'] });
    },
    onError: (e: unknown) => message.error(`Failed: ${(e as Error).message}`),
    onSettled: () => setPending(null),
  });

  const rows = queue.data?.data ?? [];

  const columns: ColumnsType<PersonCandidate> = useMemo(
    () => [
      {
        title: 'Person',
        key: 'person',
        render: (_v, r) => (
          <div>
            <Text strong>{r.person?.fullName ?? '(unknown)'}</Text>
            <div style={{ fontSize: 12, color: '#888' }}>
              {[r.person?.organization, r.person?.title].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        ),
      },
      {
        title: 'Proposed PE',
        key: 'pe',
        render: (_v, r) => (
          <div>
            <Text code>{r.peCode}</Text>
            <div style={{ fontSize: 12, color: '#888' }}>
              {r.programElement?.title ?? ''}
              {r.programElement?.service ? ` (${r.programElement.service})` : ''}
            </div>
          </div>
        ),
      },
      {
        title: 'Score',
        key: 'score',
        width: 90,
        sorter: (a, b) => a.score - b.score,
        defaultSortOrder: 'descend',
        render: (_v, r) => scoreTag(r.score),
      },
      { title: 'Why it matched', dataIndex: 'matchBasis', key: 'matchBasis', ellipsis: true },
      {
        title: 'Action',
        key: 'action',
        width: 200,
        render: (_v, r) => (
          <Space>
            <Popconfirm
              title="Confirm this person → PE link?"
              description="This sets the person's primary PE and attaches a citation."
              onConfirm={() => resolve.mutate({ id: r.id, decision: 'confirm' })}
              okText="Confirm link"
            >
              <Button type="primary" size="small" loading={pending === r.id}>
                Confirm
              </Button>
            </Popconfirm>
            <Button
              danger
              size="small"
              loading={pending === r.id}
              onClick={() => resolve.mutate({ id: r.id, decision: 'reject' })}
            >
              Reject
            </Button>
          </Space>
        ),
      },
    ],
    [pending, resolve],
  );

  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        Person → Program Element review queue
      </Title>
      <Paragraph type="secondary">
        Proposed links awaiting your review. Confirming sets the person&apos;s primary PE and attaches a J-book
        citation; rejecting discards the suggestion. Nothing is applied automatically.
      </Paragraph>
      {queue.isError && <Alert type="error" message="Failed to load the queue." style={{ marginBottom: 12 }} />}
      <Table<PersonCandidate>
        rowKey="id"
        loading={queue.isLoading}
        dataSource={rows}
        columns={columns}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="No open candidates — queue is clear." /> }}
      />
    </Card>
  );
}

/** user_admin view: suggest a person they know for a PE. */
function SuggestForm() {
  const api = useApi();
  const [form] = Form.useForm();

  const submit = useMutation({
    mutationFn: (v: { peCode: string; fullName: string; roleTitle?: string; organization?: string; notes?: string }) =>
      suggestPersonForPe(api, v.peCode.trim().toUpperCase(), {
        fullName: v.fullName.trim(),
        roleTitle: v.roleTitle?.trim() || undefined,
        organization: v.organization?.trim() || undefined,
        notes: v.notes?.trim() || undefined,
      }),
    onSuccess: () => {
      message.success('Thanks — your suggestion was submitted for review.');
      form.resetFields();
    },
    onError: (e: unknown) => message.error(`Failed: ${(e as Error).message}`),
  });

  return (
    <Card style={{ maxWidth: 640 }}>
      <Title level={4} style={{ marginTop: 0 }}>
        Suggest a program contact
      </Title>
      <Paragraph type="secondary">
        Know who runs a program? Tell us their name and the Program Element (PE) code. Our team reviews every
        suggestion before it&apos;s added — this never changes the data directly.
      </Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => submit.mutate(v)} disabled={submit.isPending}>
        <Form.Item
          label="Program Element (PE) code"
          name="peCode"
          rules={[{ required: true, message: 'Enter the PE code, e.g. 0604201A' }]}
        >
          <Input placeholder="e.g. 0604201A" />
        </Form.Item>
        <Form.Item label="Person's full name" name="fullName" rules={[{ required: true, message: 'Enter a name' }]}>
          <Input placeholder="e.g. Jane A. Smith" />
        </Form.Item>
        <Form.Item label="Role / title (optional)" name="roleTitle">
          <Input placeholder="e.g. Project Manager, Apache Helicopters" />
        </Form.Item>
        <Form.Item label="Organization (optional)" name="organization">
          <Input placeholder="e.g. CPE Aviation" />
        </Form.Item>
        <Form.Item label="Notes (optional)" name="notes">
          <Input.TextArea rows={2} placeholder="How do you know this? Any context helps our review." />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={submit.isPending}>
            Submit suggestion
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

/**
 * Person → PE link management. capiro_admin sees the scored review queue;
 * user_admin sees a lightweight "suggest a name" form that feeds the same queue.
 */
export function PersonCandidatesPage() {
  const me = useMe();
  const role = me.data?.role;

  if (me.isLoading) {
    return (
      <Card loading>
        <span />
      </Card>
    );
  }

  return role === 'capiro_admin' ? <ReviewQueue /> : <SuggestForm />;
}
