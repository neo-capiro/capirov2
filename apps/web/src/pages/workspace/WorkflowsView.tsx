import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Avatar, Button, Empty, Input, Select, Skeleton, Tag, Typography } from 'antd';
import { FilterOutlined, PlusOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import { WorkflowDrawer } from './WorkflowDrawer.js';
import type { WorkflowInstance, WorkflowStatus } from './workflowTypes.js';
import { STATUS_LABELS, STATUS_TAG_COLORS } from './workflowTypes.js';

const STATUS_OPTIONS: Array<{ label: string; value: WorkflowStatus | 'all' }> = [
  { label: 'All statuses', value: 'all' },
  { label: 'Triage', value: 'triage' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Under Review', value: 'review' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Complete', value: 'complete' },
];

export function WorkflowsView() {
  const api = useApi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();

  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);

  const instances = useQuery<WorkflowInstance[]>({
    queryKey: ['workflow-instances'],
    queryFn: async () => (await api.get<WorkflowInstance[]>('/api/workflows/instances')).data,
    staleTime: 15_000,
  });

  const clients = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Array<{ id: string; name: string }>>('/api/clients')).data,
    staleTime: 30_000,
  });

  const data = instances.data ?? [];

  const summary = useMemo(() => {
    const counts: Record<WorkflowStatus, number> = {
      triage: 0,
      in_progress: 0,
      review: 0,
      submitted: 0,
      complete: 0,
    };
    for (const workflow of data) counts[workflow.status] += 1;
    return counts;
  }, [data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.filter((workflow) => {
      if (statusFilter !== 'all' && workflow.status !== statusFilter) return false;
      if (selectedClientId !== 'all' && workflow.client?.id !== selectedClientId) return false;
      if (!needle) return true;
      const haystack = [workflow.title, workflow.template?.name, workflow.client?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [data, search, selectedClientId, statusFilter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [filtered],
  );

  const clientOptions = useMemo(
    () => [
      { value: 'all', label: 'All clients' },
      ...(clients.data ?? [])
        .filter((client) => client.name.trim().length > 0)
        .map((client) => ({ value: client.id, label: client.name })),
    ],
    [clients.data],
  );

  const openCard = (workflow: WorkflowInstance) => {
    const slug = String(workflow.templateSlug ?? workflow.template?.slug ?? '').toLowerCase();
    const isProgramWhitePaper =
      slug === 'program-white-paper' ||
      slug === 'program_white_paper' ||
      (slug.includes('white') && slug.includes('paper'));

    if (isProgramWhitePaper && workflow.strategyId) {
      navigate(`/workspace/strategy/${workflow.strategyId}/white-paper/${workflow.id}`);
      return;
    }

    setSelectedInstance(workflow);
    setDrawerOpen(true);
  };

  return (
    <section className="workflows-view" aria-label="Workspace workflows">
      <header className="workflows-head">
        <div>
          <Typography.Title level={2}>Workflows</Typography.Title>
          <Typography.Text type="secondary">
            Every active deliverable across strategy workstreams, without duplicating the client-profile kanban.
          </Typography.Text>
        </div>
        <div className="workflows-head-actions">
          <Button icon={<FilterOutlined />} onClick={() => message.info('Use the status/client/search controls below to refine this list view.')}>Filter</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/workspace/library')}>
            New workflow
          </Button>
        </div>
      </header>

      <div className="workflows-summary-grid">
        <SummaryCard label="Triage" count={summary.triage} tone="triage" />
        <SummaryCard label="In Progress" count={summary.in_progress} tone="in_progress" />
        <SummaryCard label="Under Review" count={summary.review} tone="review" />
        <SummaryCard label="Submitted" count={summary.submitted} tone="submitted" />
        <SummaryCard label="Complete" count={summary.complete} tone="complete" />
      </div>

      <div className="workflows-filters">
        <Input
          placeholder="Search title, template, or client"
          value={search}
          allowClear
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as WorkflowStatus | 'all')}
        />
        <Select options={clientOptions} value={selectedClientId} onChange={setSelectedClientId} />
      </div>

      {instances.isLoading ? (
        <div className="workflows-loading">
          <Skeleton active paragraph={{ rows: 2 }} />
          <Skeleton active paragraph={{ rows: 2 }} />
          <Skeleton active paragraph={{ rows: 2 }} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="workflows-empty">
          <Empty description="No workflows match this filter." />
        </div>
      ) : (
        <div className="workflows-list" role="list">
          {sorted.map((workflow) => (
            <button
              key={workflow.id}
              className="workflow-row"
              type="button"
              role="listitem"
              onClick={() => openCard(workflow)}
            >
              <div className="workflow-row-main">
                <Typography.Text strong>{workflow.title}</Typography.Text>
                <Typography.Text type="secondary" className="workflow-row-template">
                  {workflow.template?.name ?? 'Template unavailable'}
                </Typography.Text>
              </div>
              <div className="workflow-row-meta">
                <Tag color={STATUS_TAG_COLORS[workflow.status]}>{STATUS_LABELS[workflow.status]}</Tag>
                {workflow.client ? (
                  <span className="workflow-row-client">
                    <Avatar size={16}>{initials(workflow.client.name)}</Avatar>
                    {workflow.client.name}
                  </span>
                ) : (
                  <span className="workflow-row-client workflow-row-client-muted">Unassigned</span>
                )}
                <span className="workflow-row-updated">Updated {relativeTime(workflow.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <WorkflowDrawer
        open={drawerOpen}
        instance={selectedInstance}
        onClose={() => setDrawerOpen(false)}
        onDeleted={(id) => {
          setDrawerOpen(false);
          setSelectedInstance(null);
          qc.setQueryData<WorkflowInstance[]>(['workflow-instances'], (old) =>
            (old ?? []).filter((inst) => inst.id !== id),
          );
        }}
        onUpdated={(updated) => {
          setSelectedInstance(updated);
          qc.setQueryData<WorkflowInstance[]>(['workflow-instances'], (old) =>
            (old ?? []).map((inst) => (inst.id === updated.id ? updated : inst)),
          );
        }}
      />
    </section>
  );
}

function SummaryCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: WorkflowStatus;
}) {
  return (
    <article className="workflow-summary-card" data-tone={tone}>
      <span>{label}</span>
      <strong>{count}</strong>
    </article>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'C';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

function relativeTime(value: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(value).getTime());
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}
