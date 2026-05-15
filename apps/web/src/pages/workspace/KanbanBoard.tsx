import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Avatar, Empty, Skeleton, Tag, Typography } from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { WorkflowInstance, WorkflowStatus } from './workflowTypes.js';
import { KANBAN_COLUMNS, STATUS_TAG_COLORS } from './workflowTypes.js';
import { WorkflowDrawer } from './WorkflowDrawer.js';

export function KanbanBoard() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<WorkflowStatus | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const instances = useQuery<WorkflowInstance[]>({
    queryKey: ['workflow-instances'],
    queryFn: async () => (await api.get<WorkflowInstance[]>('/api/workflows/instances')).data,
    staleTime: 15_000,
  });

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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
    },
  });

  const handleDragStart = (id: string) => setDraggingId(id);
  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStatus(null);
  };

  const handleDragOver = (e: React.DragEvent, status: WorkflowStatus) => {
    e.preventDefault();
    setDragOverStatus(status);
  };

  const handleDrop = (e: React.DragEvent, targetStatus: WorkflowStatus) => {
    e.preventDefault();
    setDragOverStatus(null);
    if (!draggingId) return;
    const dragging = (instances.data ?? []).find((inst) => inst.id === draggingId);
    if (!dragging || dragging.status === targetStatus) return;
    updateStatus.mutate({ id: draggingId, status: targetStatus });
    setDraggingId(null);
  };

  const openCard = (instance: WorkflowInstance) => {
    setSelectedInstance(instance);
    setDrawerOpen(true);
  };

  const data = instances.data ?? [];

  return (
    <div className="kanban-view">
      <div className="kanban-board">
        {KANBAN_COLUMNS.map((col) => {
          const colInstances = data.filter((inst) => inst.status === col.status);
          const isDragOver = dragOverStatus === col.status;
          return (
            <div
              key={col.status}
              className={`kanban-column${isDragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, col.status)}
              onDragLeave={() => setDragOverStatus(null)}
              onDrop={(e) => handleDrop(e, col.status)}
            >
              <div className="kanban-column-header">
                <Typography.Text strong>{col.label}</Typography.Text>
                <span className="kanban-column-count">{colInstances.length}</span>
              </div>

              <div className="kanban-column-body">
                {instances.isLoading ? (
                  <>
                    <Skeleton active paragraph={{ rows: 2 }} className="kanban-card-skeleton" />
                    <Skeleton active paragraph={{ rows: 2 }} className="kanban-card-skeleton" />
                  </>
                ) : colInstances.length ? (
                  colInstances.map((inst) => (
                    <KanbanCard
                      key={inst.id}
                      instance={inst}
                      isDragging={draggingId === inst.id}
                      onClick={() => openCard(inst)}
                      onDragStart={() => handleDragStart(inst.id)}
                      onDragEnd={handleDragEnd}
                    />
                  ))
                ) : (
                  <div className="kanban-column-empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
    </div>
  );
}

function KanbanCard({
  instance,
  isDragging,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  instance: WorkflowInstance;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      className={`kanban-card${isDragging ? ' is-dragging' : ''}`}
      draggable
      tabIndex={0}
      role="button"
      aria-label={`Open ${instance.title}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <Typography.Text strong className="kanban-card-title">
        {instance.title}
      </Typography.Text>
      {instance.template ? (
        <Typography.Text type="secondary" className="kanban-card-template">
          {instance.template.name}
        </Typography.Text>
      ) : null}
      <div className="kanban-card-meta">
        {instance.client ? (
          <Tag color={STATUS_TAG_COLORS[instance.status]} className="kanban-card-client-tag">
            <Avatar size={14} style={{ fontSize: 9 }}>
              {initials(instance.client.name)}
            </Avatar>
            {instance.client.name}
          </Tag>
        ) : null}
        <Typography.Text type="secondary" className="kanban-card-date">
          {relativeTime(instance.createdAt)}
        </Typography.Text>
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
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}
