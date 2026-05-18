import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Empty,
  Input,
  Modal,
  Progress,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import type { Strategy, StrategyTarget, WorkflowInstance, WorkflowTemplate } from './workflowTypes.js';
import { WorkflowDrawer } from './WorkflowDrawer.js';
import type { DirectoryApiResponse, DirectoryEntry } from '../directory/directoryData.js';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fromNow(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}

const { Title, Text } = Typography;

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}

const CATEGORY_TAG_COLORS: Record<string, string> = {
  authorization: 'geekblue',
  appropriations: 'blue',
  language: 'purple',
  supporting: 'cyan',
};

const CATEGORY_SHORT: Record<string, string> = {
  authorization: 'NDAA',
  appropriations: 'APPR',
  language: 'LANG',
  supporting: 'DOC',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'blue',
  complete: 'green',
  archived: 'default',
  draft: 'orange',
};

const INSTANCE_STATUS_COLORS: Record<string, string> = {
  not_started: 'default',
  in_progress: 'processing',
  in_review: 'warning',
  submitted: 'success',
  complete: 'green',
  rejected: 'error',
};

const OUTREACH_COLORS: Record<string, string> = {
  not_started: 'default',
  meeting_requested: 'orange',
  meeting_scheduled: 'blue',
  met: 'green',
  followup_sent: 'cyan',
  complete: 'success',
};

const OUTREACH_OPTIONS = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'meeting_requested', label: 'Meeting Requested' },
  { value: 'meeting_scheduled', label: 'Meeting Scheduled' },
  { value: 'met', label: 'Met' },
  { value: 'followup_sent', label: 'Follow-Up Sent' },
  { value: 'complete', label: 'Complete' },
];

export function StrategyDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  // UI state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);
  const [addSubmissionModal, setAddSubmissionModal] = useState(false);
  const [addTargetModal, setAddTargetModal] = useState(false);
  const [targetSearchQ, setTargetSearchQ] = useState('');
  const [debouncedTargetQ, setDebouncedTargetQ] = useState('');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleTargetSearchChange(val: string) {
    setTargetSearchQ(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedTargetQ(val), 400);
  }

  // Strategy query
  const {
    data: strategy,
    isLoading,
    isError,
  } = useQuery<Strategy & { instances: (WorkflowInstance & { template: WorkflowTemplate })[] }>({
    queryKey: ['strategy', id],
    queryFn: () => api.get(`/api/strategies/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  // Templates query (for add submission modal)
  const { data: templates } = useQuery<WorkflowTemplate[]>({
    queryKey: ['workflow-templates'],
    queryFn: () => api.get('/api/workflows/templates').then((r) => r.data),
    enabled: addSubmissionModal,
  });

  // Directory search for add target modal
  const { data: dirResults, isFetching: dirFetching } = useQuery<DirectoryApiResponse>({
    queryKey: ['directory-search-strategy', debouncedTargetQ],
    queryFn: () =>
      api
        .get('/api/directory/contacts', { params: { q: debouncedTargetQ, pageSize: 20, page: 1 } })
        .then((r) => r.data),
    enabled: debouncedTargetQ.length >= 2,
  });

  // Rename mutation
  const renameMutation = useMutation({
    mutationFn: (name: string) => api.patch(`/api/strategies/${id}`, { name }).then((r) => r.data),
    onSuccess: (updated) => {
      queryClient.setQueryData(['strategy', id], (old: any) => ({ ...old, name: updated.name }));
      setEditingName(false);
      message.success('Strategy renamed');
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // AI fill mutation
  const aiFillMutation = useMutation({
    mutationFn: (instanceId: string) =>
      api
        .post(`/api/workflows/instances/${instanceId}/ai-fill`, { clientId: strategy?.clientId })
        .then((r) => r.data),
    onSuccess: () => {
      message.success('Document generated');
      queryClient.invalidateQueries({ queryKey: ['strategy', id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // Generate document mutation (supporting docs)
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const generateDocMutation = useMutation({
    mutationFn: (instanceId: string) =>
      api
        .post<{ generated_document: string }>(`/api/workflows/instances/${instanceId}/generate-document`)
        .then((r) => r.data),
    onMutate: (instanceId) => {
      setGeneratingIds((prev) => new Set([...prev, instanceId]));
    },
    onSuccess: (result, instanceId) => {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
      message.success('Document generated');
      queryClient.setQueryData(['strategy', id], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          instances: old.instances.map((i: any) =>
            String(i.id) === String(instanceId)
              ? { ...i, formData: { ...(i.formData ?? {}), generated_document: result.generated_document } }
              : i
          ),
        };
      });
    },
    onError: (err, instanceId) => {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
      message.error(errorMessage(err));
    },
  });

  // Add submission mutation
  const addSubmissionMutation = useMutation({
    mutationFn: async (slugs: string[]) => {
      for (const templateSlug of slugs) {
        await api.post('/api/workflows/instances', {
          templateSlug,
          clientId: strategy?.clientId,
          strategyId: id,
        });
      }
    },
    onSuccess: () => {
      message.success('Submissions added');
      setAddSubmissionModal(false);
      setSelectedTemplates([]);
      queryClient.invalidateQueries({ queryKey: ['strategy', id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // Update target outreach status mutation
  const updateTargetMutation = useMutation({
    mutationFn: ({ targetId, payload }: { targetId: string; payload: Record<string, unknown> }) =>
      api.patch(`/api/strategies/${id}/targets/${targetId}`, payload).then((r) => r.data),
    onSuccess: (updated, { targetId }) => {
      queryClient.setQueryData(['strategy', id], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          targets: old.targets.map((t: any) =>
            String(t.id) === String(targetId) ? { ...t, ...updated } : t
          ),
        };
      });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // Delete target mutation
  const deleteTargetMutation = useMutation({
    mutationFn: (targetId: string) =>
      api.delete(`/api/strategies/${id}/targets/${targetId}`).then((r) => r.data),
    onSuccess: (_, targetId) => {
      queryClient.setQueryData(['strategy', id], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          targets: old.targets.filter((t: any) => String(t.id) !== String(targetId)),
        };
      });
      message.success('Target removed');
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // Add target mutation
  const addTargetMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post(`/api/strategies/${id}/targets`, payload).then((r) => r.data),
    onSuccess: (newTarget) => {
      queryClient.setQueryData(['strategy', id], (old: any) => {
        if (!old) return old;
        return { ...old, targets: [...(old.targets ?? []), newTarget] };
      });
      message.success('Target added');
      setAddTargetModal(false);
      setTargetSearchQ('');
      setDebouncedTargetQ('');
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // Start outreach mutation
  const startOutreachMutation = useMutation({
    mutationFn: ({ memberName }: { memberName: string }) =>
      api
        .post('/api/workflows/instances', {
          templateSlug: 'meeting_letter',
          strategyId: id,
          targetMember: memberName,
          clientId: strategy?.clientId,
        })
        .then((r) => r.data),
    onSuccess: () => {
      message.success('Meeting letter started');
      queryClient.invalidateQueries({ queryKey: ['strategy', id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // Loading state
  if (isLoading) {
    return (
      <div style={{ padding: 32 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  // Error / not found
  if (isError || !strategy) {
    return (
      <div style={{ padding: 32 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/workspace/strategies')}
          style={{ marginBottom: 24 }}
        >
          Back to Strategies
        </Button>
        <Empty description="Strategy not found" />
      </div>
    );
  }

  const instances = strategy.instances ?? [];
  const targets: StrategyTarget[] = (strategy as any).targets ?? [];
  const clientName = (strategy as any).client?.name ?? '';
  const capabilityName = (strategy as any).capability?.name ?? '';
  const stratStatus = (strategy.status as string) ?? 'active';

  // Progress calculations
  const completedSubmissions = instances.filter(
    (i) => i.status === 'submitted' || i.status === 'complete'
  ).length;
  const completedTargets = targets.filter((t) => (t as any).outreachStatus === 'complete').length;
  const subProgressPct =
    instances.length > 0 ? Math.round((completedSubmissions / instances.length) * 100) : 0;
  const targetProgressPct =
    targets.length > 0 ? Math.round((completedTargets / targets.length) * 100) : 0;

  // Existing template slugs in strategy
  const existingSlugs = new Set(instances.map((i) => i.templateSlug ?? (i as any).template?.slug));

  // Available templates to add
  const availableTemplates = (templates ?? []).filter((t) => !existingSlugs.has(t.slug));

  // Directory entries for add target modal
  const dirEntries: DirectoryEntry[] =
    (dirResults as any)?.data ??
    (dirResults as any)?.contacts ??
    (Array.isArray(dirResults) ? (dirResults as any) : []);

  // Activity timeline
  interface ActivityItem {
    text: string;
    timestamp: string;
  }
  const activityItems: ActivityItem[] = [];

  for (const inst of instances) {
    if (inst.updatedAt) {
      const statusLabel =
        inst.status === 'triage'
          ? 'Triage'
          : inst.status === 'in_progress'
          ? 'In Progress'
          : inst.status === 'review'
          ? 'Under Review'
          : inst.status === 'submitted'
          ? 'Submitted'
          : inst.status === 'complete'
          ? 'Complete'
          : (inst.status as string) ?? 'Updated';
      activityItems.push({
        text: `${inst.title} moved to ${statusLabel}`,
        timestamp: inst.updatedAt,
      });
    }
  }

  for (const target of targets) {
    if ((target as any).meetingDate) {
      activityItems.push({
        text: `Meeting with ${(target as any).memberName} scheduled for ${fmtDate((target as any).meetingDate)}`,
        timestamp: (target as any).meetingDate,
      });
    }
  }

  activityItems.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const recentActivity = activityItems.slice(0, 10);

  // Submissions table columns
  const submissionColumns = [
    {
      title: 'Type',
      key: 'type',
      width: 80,
      render: (_: unknown, inst: WorkflowInstance & { template: WorkflowTemplate }) => {
        const cat = inst.template?.category ?? '';
        return (
          <Tag color={CATEGORY_TAG_COLORS[cat] ?? 'default'}>
            {CATEGORY_SHORT[cat] ?? (cat.toUpperCase() || '—')}
          </Tag>
        );
      },
    },
    {
      title: 'Title',
      key: 'title',
      render: (_: unknown, inst: WorkflowInstance & { template: WorkflowTemplate }) => (
        <Text>{inst.title}</Text>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 130,
      render: (_: unknown, inst: WorkflowInstance & { template: WorkflowTemplate }) => {
        const s = inst.status ?? 'not_started';
        const label = s
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
        return <Tag color={INSTANCE_STATUS_COLORS[s] ?? 'default'}>{label}</Tag>;
      },
    },
    {
      title: 'Deadline',
      key: 'deadline',
      width: 100,
      render: (_: unknown, inst: WorkflowInstance & { template: WorkflowTemplate }) =>
        (inst as any).submissionDeadline
          ? fmtDate((inst as any).submissionDeadline)
          : '—',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: unknown, inst: WorkflowInstance & { template: WorkflowTemplate }) => {
        const isSupporting = inst.template?.category === 'supporting';
        const hasGeneratedDoc = Boolean((inst.formData ?? {}).generated_document);
        const isGenerating = generatingIds.has(String(inst.id));

        return (
          <Space size="small">
            {isSupporting && !hasGeneratedDoc ? (
              <Button
                size="small"
                type="primary"
                loading={isGenerating}
                onClick={() => generateDocMutation.mutate(String(inst.id))}
              >
                Generate
              </Button>
            ) : (
              <Button
                size="small"
                onClick={() => {
                  setSelectedInstance(inst);
                  setDrawerOpen(true);
                }}
              >
                {isSupporting && hasGeneratedDoc ? 'View & Edit' : 'Open'}
              </Button>
            )}
            {isSupporting && hasGeneratedDoc && (
              <Button
                size="small"
                type="dashed"
                loading={isGenerating}
                onClick={() => generateDocMutation.mutate(String(inst.id))}
              >
                Regen
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  // Targets table columns
  const targetColumns = [
    {
      title: 'Member',
      key: 'member',
      render: (_: unknown, target: any) => (
        <div>
          <Text strong>{target.memberName}</Text>
          {target.memberParty && target.memberState && (
            <Tag style={{ marginLeft: 8 }}>
              {target.memberParty}-{target.memberState}
            </Tag>
          )}
          {target.memberTitle && (
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {target.memberTitle}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Committee',
      key: 'committee',
      render: (_: unknown, target: any) => (
        <Text type="secondary">{target.committee ?? '—'}</Text>
      ),
    },
    {
      title: 'Outreach Status',
      key: 'outreachStatus',
      width: 200,
      render: (_: unknown, target: any) => (
        <Select
          size="small"
          value={target.outreachStatus ?? 'not_started'}
          style={{ width: '100%' }}
          options={OUTREACH_OPTIONS}
          onChange={(val) =>
            updateTargetMutation.mutate({
              targetId: String(target.id),
              payload: { outreachStatus: val },
            })
          }
        />
      ),
    },
    {
      title: 'Meeting Date',
      key: 'meetingDate',
      width: 160,
      render: (_: unknown, target: any) => (
        <Input
          type="date"
          size="small"
          style={{ width: 140 }}
          value={target.meetingDate ? target.meetingDate.slice(0, 10) : ''}
          onChange={(e) =>
            updateTargetMutation.mutate({
              targetId: String(target.id),
              payload: { meetingDate: e.target.value ? new Date(e.target.value).toISOString() : null },
            })
          }
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_: unknown, target: any) => (
        <Space size="small">
          {target.outreachStatus === 'not_started' && (
            <Button
              size="small"
              type="dashed"
              onClick={() =>
                startOutreachMutation.mutate({ memberName: target.memberName })
              }
            >
              Start Outreach
            </Button>
          )}
          <Button
            size="small"
            danger
            onClick={() => deleteTargetMutation.mutate(String(target.id))}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 32 }}>
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="strategy-header" style={{ marginBottom: 36 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          type="text"
          onClick={() => navigate('/workspace/strategies')}
          style={{ marginBottom: 12, paddingLeft: 0 }}
        >
          Back to Strategies
        </Button>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          {editingName ? (
            <Space>
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onPressEnter={() => renameMutation.mutate(nameInput)}
                style={{ width: 340 }}
                autoFocus
              />
              <Button
                type="primary"
                size="small"
                loading={renameMutation.isPending}
                onClick={() => renameMutation.mutate(nameInput)}
              >
                Save
              </Button>
              <Button size="small" onClick={() => setEditingName(false)}>
                Cancel
              </Button>
            </Space>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Title level={3} style={{ margin: 0 }}>
                {strategy.name}
              </Title>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setNameInput(strategy.name);
                  setEditingName(true);
                }}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          {clientName && <Tag>{clientName}</Tag>}
          {capabilityName && <Tag>{capabilityName}</Tag>}
          <Tag color="geekblue">{strategy.fiscalYear}</Tag>
          <Tag color={STATUS_COLORS[stratStatus] ?? 'default'}>
            {stratStatus.charAt(0).toUpperCase() + stratStatus.slice(1)}
          </Tag>
        </div>

        <div style={{ maxWidth: 500 }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
          >
            <Text type="secondary" style={{ fontSize: 13 }}>
              Submissions — {completedSubmissions}/{instances.length} complete
            </Text>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {subProgressPct}%
            </Text>
          </div>
          <Progress percent={subProgressPct} showInfo={false} size="small" style={{ marginBottom: 8 }} />

          <div
            style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
          >
            <Text type="secondary" style={{ fontSize: 13 }}>
              Targets reached — {completedTargets}/{targets.length}
            </Text>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {targetProgressPct}%
            </Text>
          </div>
          <Progress
            percent={targetProgressPct}
            showInfo={false}
            size="small"
            strokeColor="#52c41a"
          />
        </div>
      </div>

      {/* ─── Submissions Section ─────────────────────────────────────────── */}
      <div className="strategy-submissions" style={{ marginBottom: 40 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <Title level={5} style={{ margin: 0 }}>
            Submissions
          </Title>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => setAddSubmissionModal(true)}
          >
            Add Submission
          </Button>
        </div>

        {instances.length === 0 ? (
          <Empty description="No submissions yet" />
        ) : (
          <Table
            dataSource={instances}
            columns={submissionColumns}
            rowKey="id"
            pagination={false}
            size="small"
          />
        )}
      </div>

      {/* ─── Targets Section ─────────────────────────────────────────────── */}
      <div className="strategy-targets" style={{ marginBottom: 40 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <Title level={5} style={{ margin: 0 }}>
            Target Members & Outreach
          </Title>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => setAddTargetModal(true)}
          >
            Add Target
          </Button>
        </div>

        {targets.length === 0 ? (
          <Empty description="No targets added" />
        ) : (
          <Table
            dataSource={targets}
            columns={targetColumns}
            rowKey="id"
            pagination={false}
            size="small"
          />
        )}
      </div>

      {/* ─── Activity Timeline ───────────────────────────────────────────── */}
      <div className="strategy-timeline" style={{ marginBottom: 40 }}>
        <Title level={5} style={{ marginBottom: 16 }}>
          Recent Activity
        </Title>

        {recentActivity.length === 0 ? (
          <Text type="secondary">No activity yet.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {recentActivity.map((item, idx) => (
              <div
                key={idx}
                className="strategy-timeline-item"
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '10px 0',
                  borderBottom: idx < recentActivity.length - 1 ? '1px solid #f0f0f0' : 'none',
                }}
              >
                <Text
                  type="secondary"
                  style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 100 }}
                >
                  {fromNow(item.timestamp)}
                </Text>
                <Text style={{ fontSize: 13 }}>{item.text}</Text>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── WorkflowDrawer ─────────────────────────────────────────────── */}
      {selectedInstance && (
        <WorkflowDrawer
          instance={selectedInstance}
          open={drawerOpen}
          strategyName={strategy?.name}
          onClose={() => {
            setDrawerOpen(false);
            setSelectedInstance(null);
          }}
          onDeleted={(instanceId) => {
            queryClient.setQueryData(['strategy', id], (old: any) => {
              if (!old) return old;
              return {
                ...old,
                instances: old.instances.filter(
                  (i: any) => String(i.id) !== String(instanceId)
                ),
              };
            });
            setDrawerOpen(false);
            setSelectedInstance(null);
          }}
          onUpdated={(updated) => {
            queryClient.setQueryData(['strategy', id], (old: any) => {
              if (!old) return old;
              return {
                ...old,
                instances: old.instances.map((i: any) =>
                  String(i.id) === String(updated.id) ? { ...i, ...updated } : i
                ),
              };
            });
            setSelectedInstance((prev) =>
              prev && String(prev.id) === String(updated.id)
                ? { ...prev, ...updated }
                : prev
            );
          }}
        />
      )}

      {/* ─── Add Submission Modal ────────────────────────────────────────── */}
      <Modal
        title="Add Submissions"
        open={addSubmissionModal}
        onCancel={() => {
          setAddSubmissionModal(false);
          setSelectedTemplates([]);
        }}
        onOk={() => {
          if (selectedTemplates.length === 0) {
            return;
          }
          addSubmissionMutation.mutate(selectedTemplates);
        }}
        okText="Add Selected"
        confirmLoading={addSubmissionMutation.isPending}
        okButtonProps={{ disabled: selectedTemplates.length === 0 }}
      >
        {availableTemplates.length === 0 ? (
          <Text type="secondary">All available submission types are already added.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {availableTemplates.map((t) => (
              <div key={t.slug ?? t.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id={`tmpl-${t.id}`}
                  checked={selectedTemplates.includes(t.slug ?? String(t.id))}
                  onChange={(e) => {
                    const key = t.slug ?? String(t.id);
                    setSelectedTemplates((prev) =>
                      e.target.checked ? [...prev, key] : prev.filter((k) => k !== key)
                    );
                  }}
                />
                <label htmlFor={`tmpl-${t.id}`} style={{ cursor: 'pointer' }}>
                  <Tag
                    color={CATEGORY_TAG_COLORS[t.category ?? ''] ?? 'default'}
                    style={{ marginRight: 8 }}
                  >
                    {CATEGORY_SHORT[t.category ?? ''] ?? 'DOC'}
                  </Tag>
                  {t.name}
                </label>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ─── Add Target Modal ────────────────────────────────────────────── */}
      <Modal
        title="Add Target Member"
        open={addTargetModal}
        onCancel={() => {
          setAddTargetModal(false);
          setTargetSearchQ('');
          setDebouncedTargetQ('');
        }}
        footer={null}
        width={600}
      >
        <Input
          placeholder="Search members, committees, or staffers..."
          value={targetSearchQ}
          onChange={(e) => handleTargetSearchChange(e.target.value)}
          style={{ marginBottom: 16 }}
          autoFocus
        />

        {dirFetching && <Skeleton active paragraph={{ rows: 3 }} />}

        {!dirFetching && debouncedTargetQ.length >= 2 && dirEntries.length === 0 && (
          <Text type="secondary">No results found.</Text>
        )}

        {dirEntries.length > 0 && (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {dirEntries.map((entry) => {
              const entryId = String(entry.id);
              const alreadyTarget = targets.some(
                (t) => String((t as any).directoryContactId) === entryId
              );
              return (
                <div
                  key={entryId}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid #f5f5f5',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <Text strong>{entry.memberName ?? entry.fullName ?? ''}</Text>
                    {(entry as any).party && (entry as any).state && (
                      <Tag style={{ marginLeft: 8 }}>
                        {(entry as any).party}-{(entry as any).state}
                      </Tag>
                    )}
                    {entry.title && (
                      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {entry.title}
                      </Text>
                    )}
                    {(entry as any).committees?.[0] && (
                      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {(entry as any).committees[0]}
                      </Text>
                    )}
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    disabled={alreadyTarget}
                    loading={addTargetMutation.isPending}
                    onClick={() => {
                      addTargetMutation.mutate({
                        memberName: entry.memberName ?? entry.fullName ?? '',
                        memberTitle: entry.title ?? null,
                        memberParty: (entry as any).party ?? null,
                        memberState: (entry as any).state ?? null,
                        committee: (entry as any).committees?.[0] ?? null,
                        outreachStatus: 'not_started',
                        directoryContactId: entryId,
                      });
                    }}
                  >
                    {alreadyTarget ? 'Added' : 'Add'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {!dirFetching && debouncedTargetQ.length < 2 && (
          <Text type="secondary">Type at least 2 characters to search.</Text>
        )}
      </Modal>
    </div>
  );
}
