import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Avatar, Button, Input, Select, Skeleton, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import { WorkflowDrawer } from './WorkflowDrawer.js';
import type { WorkflowInstance, WorkflowStatus } from './workflowTypes.js';
import { KANBAN_COLUMNS } from './workflowTypes.js';

export function WorkflowsView() {
  const api = useApi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();

  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<WorkflowStatus | null>(null);

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

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.filter((workflow) => {
      if (selectedClientId !== 'all' && workflow.client?.id !== selectedClientId) return false;
      if (!needle) return true;
      const haystack = [workflow.title, workflow.template?.name, workflow.client?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [data, search, selectedClientId]);

  const byStatus = useMemo(() => {
    const map: Record<WorkflowStatus, WorkflowInstance[]> = {
      triage: [],
      in_progress: [],
      review: [],
      submitted: [],
      complete: [],
    };
    for (const workflow of [...filtered].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )) {
      map[workflow.status]?.push(workflow);
    }
    return map;
  }, [filtered]);

  const clientOptions = useMemo(
    () => [
      { value: 'all', label: 'All clients' },
      ...(clients.data ?? [])
        .filter((client) => client.name.trim().length > 0)
        .map((client) => ({ value: client.id, label: client.name })),
    ],
    [clients.data],
  );

  // ── Status change via drag-and-drop (optimistic) ──────────────────────────
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: WorkflowStatus }) =>
      (await api.patch<WorkflowInstance>(`/api/workflows/instances/${id}`, { status })).data,
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['workflow-instances'] });
      const previous = qc.getQueryData<WorkflowInstance[]>(['workflow-instances']);
      qc.setQueryData<WorkflowInstance[]>(['workflow-instances'], (old) =>
        (old ?? []).map((inst) => (inst.id === id ? { ...inst, status } : inst)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['workflow-instances'], ctx.previous);
      message.error('Could not update workflow status');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['workflow-instances'] }),
  });

  // ── Delete (optimistic) ───────────────────────────────────────────────────
  const deleteInstance = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/workflows/instances/${id}`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['workflow-instances'] });
      const previous = qc.getQueryData<WorkflowInstance[]>(['workflow-instances']);
      qc.setQueryData<WorkflowInstance[]>(['workflow-instances'], (old) =>
        (old ?? []).filter((inst) => inst.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(['workflow-instances'], ctx.previous);
      message.error('Could not delete workflow');
    },
    onSuccess: () => message.success('Workflow deleted'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['workflow-instances'] }),
  });

  const confirmDelete = (workflow: WorkflowInstance) => {
    modal.confirm({
      title: 'Delete this workflow?',
      content: `"${workflow.title}" will be permanently deleted. This cannot be undone.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => deleteInstance.mutateAsync(workflow.id),
    });
  };

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

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const handleDrop = (event: React.DragEvent, targetStatus: WorkflowStatus) => {
    event.preventDefault();
    setDragOverStatus(null);
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const dragging = data.find((inst) => inst.id === id);
    if (!dragging || dragging.status === targetStatus) return;
    updateStatus.mutate({ id, status: targetStatus });
  };

  // Deep-link support: /workspace/workflows?instance=<id> auto-opens that workflow.
  const [searchParams, setSearchParams] = useSearchParams();
  const openedFromUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const instanceId = searchParams.get('instance');
    if (!instanceId || openedFromUrlRef.current === instanceId) return;
    const target = (instances.data ?? []).find((w) => w.id === instanceId);
    if (!target) return;
    openedFromUrlRef.current = instanceId;
    openCard(target);
    const next = new URLSearchParams(searchParams);
    next.delete('instance');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, instances.data]);

  return (
    <section className="workflows-view" aria-label="Workspace workflows">
      <header className="workflows-head">
        <div>
          <Typography.Title level={2}>Workflows</Typography.Title>
          <Typography.Text type="secondary">
            Every active deliverable across strategy workstreams. Drag cards between columns to update status.
          </Typography.Text>
        </div>
        <div className="workflows-head-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/workspace/library')}>
            New workflow
          </Button>
        </div>
      </header>

      <div className="workflows-filters workflows-filters--kanban">
        <Input
          placeholder="Search title, template, or client"
          value={search}
          allowClear
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select options={clientOptions} value={selectedClientId} onChange={setSelectedClientId} />
      </div>

      {instances.isLoading ? (
        <div className="wf-kanban" aria-hidden>
          {KANBAN_COLUMNS.map((col) => (
            <div key={col.status} className="wf-kanban-col" data-status={col.status}>
              <div className="wf-kanban-col-head">
                <span className="wf-kanban-col-dot" />
                <span className="wf-kanban-col-title">{col.label}</span>
              </div>
              <div className="wf-kanban-col-body">
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="wf-kanban" role="list">
          {KANBAN_COLUMNS.map((col) => {
            const colInstances = byStatus[col.status];
            const isOver = dragOverStatus === col.status;
            return (
              <div
                key={col.status}
                className={`wf-kanban-col${isOver ? ' is-over' : ''}`}
                data-status={col.status}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dragOverStatus !== col.status) setDragOverStatus(col.status);
                }}
                onDragLeave={(event) => {
                  // Only clear when leaving the column, not when moving over a child.
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDragOverStatus((prev) => (prev === col.status ? null : prev));
                  }
                }}
                onDrop={(event) => handleDrop(event, col.status)}
              >
                <div className="wf-kanban-col-head">
                  <span className="wf-kanban-col-dot" />
                  <span className="wf-kanban-col-title">{col.label}</span>
                  <span className="wf-kanban-col-count">{colInstances.length}</span>
                </div>
                <div className="wf-kanban-col-body">
                  {colInstances.length ? (
                    colInstances.map((workflow) => (
                      <WorkflowCard
                        key={workflow.id}
                        workflow={workflow}
                        isDragging={draggingId === workflow.id}
                        onOpen={() => openCard(workflow)}
                        onDelete={() => confirmDelete(workflow)}
                        onDragStart={() => setDraggingId(workflow.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverStatus(null);
                        }}
                      />
                    ))
                  ) : (
                    <div className="wf-kanban-col-empty">No workflows</div>
                  )}
                </div>
              </div>
            );
          })}
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

function WorkflowCard({
  workflow,
  isDragging,
  onOpen,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  workflow: WorkflowInstance;
  isDragging: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      className={`wf-kanban-card${isDragging ? ' is-dragging' : ''}`}
      role="listitem"
      tabIndex={0}
      draggable
      aria-label={`Open ${workflow.title}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="wf-kanban-card-top">
        <Typography.Text strong className="wf-kanban-card-title">
          {workflow.title}
        </Typography.Text>
        <Tooltip title="Delete workflow">
          <button
            type="button"
            className="wf-kanban-card-delete"
            aria-label={`Delete ${workflow.title}`}
            draggable={false}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            onDragStart={(event) => event.preventDefault()}
          >
            <DeleteOutlined />
          </button>
        </Tooltip>
      </div>
      {workflow.template ? (
        <Typography.Text type="secondary" className="wf-kanban-card-template">
          {workflow.template.name}
        </Typography.Text>
      ) : null}
      <div className="wf-kanban-card-foot">
        {workflow.client ? (
          <span className="wf-kanban-card-client">
            <Avatar size={16} style={{ fontSize: 9 }}>
              {initials(workflow.client.name)}
            </Avatar>
            {workflow.client.name}
          </span>
        ) : (
          <span className="wf-kanban-card-client wf-kanban-card-client--muted">Unassigned</span>
        )}
        <span className="wf-kanban-card-updated">{relativeTime(workflow.updatedAt)}</span>
      </div>
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
