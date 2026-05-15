import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Collapse,
  Drawer,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import {
  type FieldDefinition,
  type SubmissionMethod,
  type WorkflowInstance,
  type WorkflowStatus,
  STATUS_LABELS,
  STATUS_TAG_COLORS,
} from './workflowTypes.js';

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

interface WorkflowDrawerProps {
  instance: WorkflowInstance | null;
  open: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onUpdated: (updated: WorkflowInstance) => void;
}

export function WorkflowDrawer({
  instance,
  open,
  onClose,
  onDeleted,
  onUpdated,
}: WorkflowDrawerProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();

  const [title, setTitle] = useState('');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [targetMember, setTargetMember] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);
  const [submissionMethod, setSubmissionMethod] = useState<SubmissionMethod | null>(null);
  const [notes, setNotes] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!instance) return;
    setTitle(instance.title ?? '');
    setFormData({ ...(instance.formData ?? {}) });
    setTargetMember(instance.targetMember ?? '');
    setSubmissionDeadline(instance.submissionDeadline ?? null);
    setSubmissionMethod(instance.submissionMethod ?? null);
    setNotes(instance.notes ?? '');
    setSaveStatus('saved');
  }, [instance?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateInstance = useMutation({
    mutationFn: async (payload: Partial<WorkflowInstance>) =>
      (await api.patch<WorkflowInstance>(`/api/workflows/instances/${instance!.id}`, payload)).data,
    onSuccess: (updated) => {
      setSaveStatus('saved');
      onUpdated(updated);
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
    },
    onError: () => setSaveStatus('error'),
  });

  const deleteInstance = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/workflows/instances/${id}`)).data,
    onSuccess: () => {
      message.success('Workflow removed');
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
      onDeleted(instance!.id);
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const saveRef = useRef<() => void>(() => undefined);
  saveRef.current = () => {
    if (!instance) return;
    setSaveStatus('saving');
    updateInstance.mutate({ title, formData, targetMember, submissionDeadline, submissionMethod, notes });
  };

  const scheduleAutoSave = useCallback(() => {
    setSaveStatus('unsaved');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveRef.current();
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const handleFieldChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    scheduleAutoSave();
  };

  const handleDelete = () => {
    if (!instance) return;
    modal.confirm({
      title: 'Remove this workflow?',
      content: 'This cannot be undone.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: () => deleteInstance.mutateAsync(instance.id),
    });
  };

  const template = instance?.template ?? null;

  const sectionGroups = useMemo(() => {
    const groups = new Map<string, FieldDefinition[]>();
    for (const field of template?.requiredSections ?? []) {
      const existing = groups.get(field.section) ?? [];
      existing.push(field);
      groups.set(field.section, existing);
    }
    return [...groups.entries()];
  }, [template?.requiredSections]);

  const requiredFields = useMemo(
    () => (template?.requiredSections ?? []).filter((f) => f.required && !f.computed),
    [template?.requiredSections],
  );

  const completedCount = requiredFields.filter((f) => {
    const val = formData[f.key];
    return val !== undefined && val !== null && val !== '';
  }).length;

  const currentPbr = numericField(formData['current_pbr_funding']);
  const requestedAuth = numericField(formData['requested_authorization']);
  const deltaAbovePbr = requestedAuth - currentPbr;

  const contextEntries = Object.entries(template?.contextInfo ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );

  const statusColor = STATUS_TAG_COLORS[(instance?.status ?? 'triage') as WorkflowStatus];
  const statusLabel = STATUS_LABELS[(instance?.status ?? 'triage') as WorkflowStatus];

  const saveIndicator =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'unsaved'
        ? 'Unsaved changes'
        : saveStatus === 'error'
          ? 'Save failed'
          : 'Saved';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      className="workflow-drawer"
      title={
        <div className="workflow-drawer-header">
          <Input
            value={title}
            variant="borderless"
            className="workflow-drawer-title-input"
            placeholder="Workflow title"
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleAutoSave();
            }}
          />
          <Space size={8}>
            <Tag color={statusColor}>{statusLabel}</Tag>
          </Space>
          {template ? (
            <Typography.Text type="secondary" className="workflow-drawer-template-name">
              {template.name}
            </Typography.Text>
          ) : null}
        </div>
      }
      footer={
        <div className="workflow-drawer-footer">
          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={updateInstance.isPending}
              onClick={() => {
                if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
                saveRef.current();
              }}
            >
              Save
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={deleteInstance.isPending}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </Space>
          <span
            className={`workflow-drawer-save-status workflow-drawer-save-status--${saveStatus}`}
          >
            {saveIndicator}
          </span>
        </div>
      }
    >
      {instance ? (
        <div className="workflow-drawer-body">
          {requiredFields.length > 0 ? (
            <div className="workflow-drawer-progress">
              <div className="workflow-drawer-progress-label">
                <Typography.Text type="secondary">Required fields</Typography.Text>
                <Typography.Text strong>
                  {completedCount} / {requiredFields.length}
                </Typography.Text>
              </div>
              <div className="workflow-drawer-progress-bar">
                <div
                  className="workflow-drawer-progress-fill"
                  style={{
                    width: `${requiredFields.length > 0 ? Math.round((completedCount / requiredFields.length) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ) : null}

          {contextEntries.length > 0 ? (
            <Collapse
              ghost
              className="workflow-drawer-context"
              items={[
                {
                  key: 'context',
                  label: 'Submission Guide',
                  children: (
                    <div className="workflow-drawer-context-entries">
                      {contextEntries.map(([key, value]) => (
                        <div key={key} className="workflow-drawer-context-row">
                          <Typography.Text type="secondary">{labelize(key)}</Typography.Text>
                          <Typography.Text>{String(value)}</Typography.Text>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          ) : null}

          {sectionGroups.map(([section, fields]) => (
            <div key={section} className="workflow-field-section">
              <Typography.Text strong className="workflow-field-section-label">
                {section}
              </Typography.Text>
              {fields.map((field) => {
                if (field.computed && field.key === 'delta_above_pbr') {
                  return (
                    <div key={field.key} className="workflow-field-row">
                      <label className="workflow-field-label">
                        {field.label}
                        <span className="workflow-field-computed-badge">auto</span>
                      </label>
                      <InputNumber
                        style={{ width: '100%' }}
                        prefix="$"
                        value={deltaAbovePbr}
                        readOnly
                        disabled
                        formatter={currencyFormatter}
                        parser={currencyParser}
                      />
                    </div>
                  );
                }
                return (
                  <div key={field.key} className="workflow-field-row">
                    <label className="workflow-field-label">
                      {field.label}
                      {field.required ? <span className="workflow-field-required">*</span> : null}
                      {field.description ? (
                        <span className="workflow-field-hint">{field.description}</span>
                      ) : null}
                    </label>
                    <FieldInput
                      field={field}
                      value={formData[field.key]}
                      onChange={(val) => handleFieldChange(field.key, val)}
                    />
                  </div>
                );
              })}
            </div>
          ))}

          <div className="workflow-field-section">
            <Typography.Text strong className="workflow-field-section-label">
              Details
            </Typography.Text>

            <div className="workflow-field-row">
              <label className="workflow-field-label">Target Member</label>
              <Input
                value={targetMember}
                placeholder="e.g. Rep. Jane Smith (D-CA)"
                onChange={(e) => {
                  setTargetMember(e.target.value);
                  scheduleAutoSave();
                }}
              />
            </div>

            <div className="workflow-field-row">
              <label className="workflow-field-label">Submission Deadline</label>
              <Input
                type="date"
                value={submissionDeadline ? submissionDeadline.slice(0, 10) : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setSubmissionDeadline(val ? new Date(val).toISOString() : null);
                  scheduleAutoSave();
                }}
              />
            </div>

            <div className="workflow-field-row">
              <label className="workflow-field-label">Submission Method</label>
              <Select
                style={{ width: '100%' }}
                allowClear
                placeholder="Select method"
                value={submissionMethod}
                onChange={(val: string | undefined) => {
                  setSubmissionMethod((val as SubmissionMethod) ?? null);
                  scheduleAutoSave();
                }}
                options={[
                  { value: 'portal', label: 'Online Portal' },
                  { value: 'email', label: 'Email' },
                  { value: 'in-person', label: 'In Person' },
                ]}
              />
            </div>

            <div className="workflow-field-row">
              <label className="workflow-field-label">Notes</label>
              <Input.TextArea
                value={notes}
                rows={3}
                placeholder="Internal notes..."
                onChange={(e) => {
                  setNotes(e.target.value);
                  scheduleAutoSave();
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  if (field.type === 'currency') {
    return (
      <InputNumber
        style={{ width: '100%' }}
        prefix="$"
        value={typeof value === 'number' ? value : undefined}
        formatter={currencyFormatter}
        parser={currencyParser}
        onChange={(val) => onChange(val)}
        placeholder="0"
      />
    );
  }
  if (field.type === 'textarea') {
    return (
      <Input.TextArea
        value={typeof value === 'string' ? value : ''}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function numericField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function currencyFormatter(value: number | undefined): string {
  if (value === undefined || value === null) return '';
  return `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function currencyParser(value: string | undefined): number {
  const cleaned = (value ?? '').replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function labelize(key: string): string {
  return key
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
