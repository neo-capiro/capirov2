import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Popconfirm,
  Result,
  Space,
  Select,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../../lib/use-api.js';
import { useMe } from '../../lib/me.js';
import { getProgramMatchQueue, resolveProgramMatch } from './programs-api.js';
import type {
  ProgramConfidenceBand,
  ProgramEvidenceItem,
  ProgramMatchDecision,
  ProgramMatchQueueRow,
} from './programs-api.js';

const { Title, Paragraph, Text } = Typography;

type StatusFilter = 'candidate' | 'quarantined' | 'all';

const BAND_COLOR: Record<ProgramConfidenceBand, string> = {
  high: 'green',
  medium: 'gold',
  low: 'orange',
  weak: 'default',
};

function bandTag(band: ProgramConfidenceBand) {
  return <Tag color={BAND_COLOR[band] ?? 'default'}>{band}</Tag>;
}

function statusTag(status: string) {
  const color = status === 'candidate' ? 'gold' : status === 'quarantined' ? 'orange' : 'default';
  return <Tag color={color}>{status}</Tag>;
}

function evidenceHref(item: ProgramEvidenceItem): string | null {
  if (!item.sourceUrl) return null;
  return item.pageNumber ? `${item.sourceUrl}#page=${item.pageNumber}` : item.sourceUrl;
}

function EvidenceLinks({ evidence }: { evidence: ProgramEvidenceItem[] }) {
  const linked = (Array.isArray(evidence) ? evidence : []).filter((e) => e.sourceUrl);
  if (linked.length === 0) return <Text type="secondary">—</Text>;
  return (
    <Space size={[4, 4]} wrap>
      {linked.map((e, i) => {
        const href = evidenceHref(e);
        const label = `${e.kind ?? 'source'}${e.pageNumber ? ` p.${e.pageNumber}` : ''}`;
        return href ? (
          <a key={`${href}-${i}`} href={href} target="_blank" rel="noreferrer">
            <Tooltip title={e.quote ?? e.sourceUrl}>
              <Tag color="green">{label}</Tag>
            </Tooltip>
          </a>
        ) : (
          <Tag key={`${label}-${i}`}>{label}</Tag>
        );
      })}
    </Space>
  );
}

/**
 * Step 2.1 — PE→Program match review queue (capiro_admin only). Lists candidate /
 * quarantined PeProgramMatch rows with the Why-shown evidence line, confidence band,
 * status badge, and source evidence links. Each row can be accepted / rejected /
 * quarantined (Popconfirm) with optional notes. Nothing is auto-applied; resolving a
 * match writes an AuditLog server-side and invalidates this queue + the PE programs panel.
 */
export function ProgramMatchQueuePage() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const isCapiroAdmin = me.data?.role === 'capiro_admin';

  const [status, setStatus] = useState<StatusFilter>('candidate');
  const [pending, setPending] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  const queue = useQuery({
    queryKey: ['program-match-queue', status],
    enabled: isCapiroAdmin,
    queryFn: () => getProgramMatchQueue(api, status, 200),
    staleTime: 30_000,
  });

  const resolve = useMutation({
    mutationFn: (vars: { id: string; decision: ProgramMatchDecision; notes?: string }) =>
      resolveProgramMatch(api, vars.id, vars.decision, vars.notes),
    onMutate: (vars) => setPending(vars.id),
    onSuccess: (_res, vars) => {
      message.success(
        vars.decision === 'accept'
          ? 'Accepted — the match now shows on the PE Programs panel.'
          : vars.decision === 'reject'
            ? 'Rejected — the match is removed.'
            : 'Quarantined — held back from the PE profile.',
      );
      void qc.invalidateQueries({ queryKey: ['program-match-queue'] });
      // The PE profile "Programs" panel reads getProgramsForPe; refresh it too.
      void qc.invalidateQueries({ queryKey: ['program-element-programs'] });
    },
    onError: (e: unknown) => message.error(`Resolve failed: ${(e as Error).message}`),
    onSettled: () => setPending(null),
  });

  const columns: ColumnsType<ProgramMatchQueueRow> = useMemo(
    () => [
      {
        title: 'Program',
        key: 'program',
        render: (_v, r) => (
          <div>
            <Text strong>{r.program?.canonicalName ?? '(unknown program)'}</Text>
            <div style={{ fontSize: 12, color: '#888' }}>
              {[r.program?.mdapCode ? `MDAP ${r.program.mdapCode}` : null, r.program?.component]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>
          </div>
        ),
      },
      {
        title: 'Program Element',
        key: 'pe',
        render: (_v, r) => (
          <div>
            <Text code>{r.peCode}</Text>
            {r.projectCode ? <Tag style={{ marginLeft: 6 }}>{r.projectCode}</Tag> : null}
            <div style={{ fontSize: 12, color: '#888' }}>
              {r.programElement?.title ?? ''}
              {r.programElement?.service ? ` (${r.programElement.service})` : ''}
            </div>
          </div>
        ),
      },
      {
        title: 'Confidence',
        key: 'confidence',
        width: 110,
        sorter: (a, b) => a.score - b.score,
        defaultSortOrder: 'descend',
        render: (_v, r) => (
          <Tooltip title={`score ${r.score.toFixed(2)} · tier ${r.evidenceTier}`}>{bandTag(r.confidenceBand)}</Tooltip>
        ),
      },
      {
        title: 'Why shown',
        dataIndex: 'whyShown',
        key: 'whyShown',
        render: (v: string) => (v ? <Text>{v}</Text> : <Text type="secondary">—</Text>),
      },
      {
        title: 'Evidence',
        key: 'evidence',
        width: 200,
        render: (_v, r) => <EvidenceLinks evidence={r.evidence} />,
      },
      { title: 'Status', key: 'status', width: 110, render: (_v, r) => statusTag(r.status) },
      {
        title: 'Notes',
        key: 'notes',
        width: 180,
        render: (_v, r) => (
          <Input
            size="small"
            placeholder="Optional"
            aria-label={`notes ${r.id}`}
            value={notesById[r.id] ?? ''}
            onChange={(e) => setNotesById((prev) => ({ ...prev, [r.id]: e.target.value }))}
          />
        ),
      },
      {
        title: 'Action',
        key: 'action',
        width: 240,
        render: (_v, r) => (
          <Space size="small">
            <Popconfirm
              title="Accept this match?"
              description="Marks the PE→Program link accepted; it shows on the PE Programs panel."
              okText="Accept"
              onConfirm={() => resolve.mutate({ id: r.id, decision: 'accept', notes: notesById[r.id] })}
            >
              <Button type="primary" size="small" loading={pending === r.id}>
                Accept
              </Button>
            </Popconfirm>
            <Popconfirm
              title="Quarantine this match?"
              description="Holds it back from the PE profile; it stays in the queue."
              okText="Quarantine"
              onConfirm={() => resolve.mutate({ id: r.id, decision: 'quarantine', notes: notesById[r.id] })}
            >
              <Button size="small" loading={pending === r.id}>
                Quarantine
              </Button>
            </Popconfirm>
            <Popconfirm
              title="Reject this match?"
              description="Discards the proposed link."
              okText="Reject"
              onConfirm={() => resolve.mutate({ id: r.id, decision: 'reject', notes: notesById[r.id] })}
            >
              <Button danger size="small" loading={pending === r.id}>
                Reject
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [pending, resolve, notesById],
  );

  if (me.isLoading) return <Spin />;
  if (!isCapiroAdmin) {
    return <Result status="403" title="403" subTitle="The program match queue is restricted to Capiro administrators." />;
  }

  return (
    <Card>
      <Title level={3}>Program Match Review Queue</Title>
      <Paragraph type="secondary">
        Machine-proposed PE→Program links awaiting review. Each row shows why it matched, the source
        evidence, and a confidence band. Accept to surface it on the PE profile, quarantine to hold it
        back, or reject to discard it. Nothing is applied automatically; every decision is audit-logged.
      </Paragraph>
      <Space style={{ marginBottom: 16 }}>
        <Text>Status:</Text>
        <Select<StatusFilter>
          value={status}
          onChange={(v) => setStatus(v)}
          style={{ width: 180 }}
          aria-label="status filter"
          options={[
            { value: 'candidate', label: 'Candidates' },
            { value: 'quarantined', label: 'Quarantined' },
            { value: 'all', label: 'Candidates + quarantined' },
          ]}
        />
      </Space>
      {queue.isError && (
        <Alert type="error" message="Failed to load the program match queue." showIcon style={{ marginBottom: 16 }} />
      )}
      <Table<ProgramMatchQueueRow>
        rowKey="id"
        loading={queue.isLoading}
        columns={columns}
        dataSource={queue.data?.data ?? []}
        pagination={{ pageSize: 25, total: queue.data?.total ?? 0, showSizeChanger: false }}
        locale={{ emptyText: `No ${status === 'all' ? 'candidate or quarantined' : status} matches.` }}
      />
    </Card>
  );
}

export default ProgramMatchQueuePage;
