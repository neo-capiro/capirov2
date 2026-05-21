import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BulbOutlined, CheckOutlined, CopyOutlined, DeleteOutlined, RedoOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { Client } from '../clients/clientTypes.js';
import { useApi } from '../../lib/use-api.js';
import {
  type FieldDefinition,
  type RequestType,
  type SubmissionMethod,
  type WorkflowInstance,
  type WorkflowStatus,
  STATUS_LABELS,
  STATUS_TAG_COLORS,
} from './workflowTypes.js';

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const SLUG_TO_SUBCOMMITTEE: Record<string, string> = {
  'ndaa-authorization-request': 'Defense',
  'hac-defense-programmatic': 'Defense',
  'hac-agriculture-programmatic': 'Agriculture, Rural Development, FDA',
  'hac-cjs-programmatic': 'Commerce, Justice, Science',
  'hac-energy-water-programmatic': 'Energy and Water Development',
  'hac-fsgg-programmatic': 'Financial Services and General Government',
  'hac-homeland-programmatic': 'Homeland Security',
  'hac-interior-programmatic': 'Interior, Environment',
  'hac-labor-hhs-programmatic': 'Labor, HHS, Education',
  'hac-legbranch-programmatic': 'Legislative Branch',
  'hac-milcon-va-programmatic': 'Military Construction, Veterans Affairs',
  'hac-natsec-state-programmatic': 'National Security, State Department',
  'hac-thud-programmatic': 'Transportation, HUD',
};

interface AiSuggestion {
  value: string;
  reasoning: string;
}

interface WorkflowDrawerProps {
  instance: WorkflowInstance | null;
  open: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onUpdated: (updated: WorkflowInstance) => void;
  strategyName?: string;
}

export function WorkflowDrawer({
  instance,
  open,
  onClose,
  onDeleted,
  onUpdated,
  strategyName,
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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [requesterPrepopulated, setRequesterPrepopulated] = useState(false);
  const [clientPrepopulated, setClientPrepopulated] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, AiSuggestion>>({});
  const [enhancingKey, setEnhancingKey] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [acceptedKeys, setAcceptedKeys] = useState<Set<string>>(new Set());

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contactInfo = useQuery<Record<string, unknown>>({
    queryKey: ['contact-info'],
    queryFn: async () =>
      (await api.get<Record<string, unknown>>('/api/tenant-admin/contact-info')).data,
    enabled: open,
    staleTime: 60_000,
  });

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
    staleTime: 60_000,
  });

  const strategyQuery = useQuery<{
    capability?: { name: string; peNumber: string | null; fundingAsk: number | null; fundingAskLabel: string | null } | null;
  }>({
    queryKey: ['strategy', instance?.strategyId],
    queryFn: async () => (await api.get(`/api/strategies/${instance!.strategyId}`)).data,
    enabled: open && Boolean(instance?.strategyId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!instance) return;
    setTitle(instance.title ?? '');
    setFormData({ ...(instance.formData ?? {}) });
    setTargetMember(instance.targetMember ?? '');
    setSubmissionDeadline(instance.submissionDeadline ?? null);
    setSubmissionMethod(instance.submissionMethod ?? null);
    setNotes(instance.notes ?? '');
    setSaveStatus('saved');
    setSelectedClientId(instance.clientId ?? null);
    setRequesterPrepopulated(false);
    setClientPrepopulated(false);
  }, [instance?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // C: Auto-set subcommittee from template slug when empty
  useEffect(() => {
    if (!instance) return;
    const slug = instance.template?.slug ?? '';
    const subcommittee = SLUG_TO_SUBCOMMITTEE[slug];
    if (!subcommittee) return;
    setFormData((prev) => {
      if (prev.subcommittee) return prev;
      return { ...prev, subcommittee };
    });
  }, [instance?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // B: Auto-populate form fields from strategy capability
  useEffect(() => {
    if (!strategyQuery.data) return;
    const cap = strategyQuery.data.capability;
    if (!cap) return;
    const cat = template?.category;
    setFormData((prev) => {
      const next = { ...prev };
      if (cap.peNumber && !prev.program_element) next.program_element = cap.peNumber;
      if (cap.fundingAsk != null && !prev.requested_funding_amount) next.requested_funding_amount = cap.fundingAsk;
      if (cap.name && !prev.program) next.program = cap.name;
      if (cap.name && !prev.title_of_request) {
        next.title_of_request = `FY27 ${cap.name} ${cat === 'authorization' ? 'Authorization' : 'Appropriations'} Request`;
      }
      return next;
    });
  }, [instance?.id, strategyQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate requesterContact fields from tenant contact settings
  useEffect(() => {
    if (!contactInfo.data || !instance || !requesterContact) return;
    const tenantFields = requesterContact.fields.filter((f) => f.source === 'tenant_settings');
    if (tenantFields.length === 0) return;
    const instanceFormData = instance.formData ?? {};
    const wouldFill = tenantFields.some((f) => {
      if (instanceFormData[f.key] !== undefined && instanceFormData[f.key] !== null && instanceFormData[f.key] !== '') return false;
      const ciKey = requesterKeyToContactKey(f.key);
      return Boolean(ciKey && contactInfo.data![ciKey]);
    });
    setFormData((prev) => {
      const next = { ...prev };
      for (const field of tenantFields) {
        if (prev[field.key] !== undefined && prev[field.key] !== null && prev[field.key] !== '') continue;
        const ciKey = requesterKeyToContactKey(field.key);
        const val = ciKey ? contactInfo.data![ciKey] : undefined;
        if (typeof val === 'string' && val.trim()) next[field.key] = val;
      }
      return next;
    });
    if (wouldFill) setRequesterPrepopulated(true);
  }, [instance?.id, contactInfo.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate orgContact fields when drawer opens with existing clientId (C3)
  useEffect(() => {
    if (!instance?.clientId || !clients.data || !orgContact) return;
    const client = clients.data.find((c) => c.id === instance.clientId);
    if (!client) return;
    const instanceFormData = instance.formData ?? {};
    const wouldFill = orgContact.fields.some((f) => {
      if (instanceFormData[f.key] !== undefined && instanceFormData[f.key] !== null && instanceFormData[f.key] !== '') return false;
      return Boolean(getClientFieldValue(f.key, client));
    });
    setFormData((prev) => {
      const next = { ...prev };
      for (const field of orgContact.fields) {
        if (prev[field.key] !== undefined && prev[field.key] !== null && prev[field.key] !== '') continue;
        const val = getClientFieldValue(field.key, client);
        if (val) next[field.key] = val;
      }
      return next;
    });
    if (wouldFill) setClientPrepopulated(true);
  }, [instance?.id, clients.data]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const syncFromStrategy = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/strategies/${instance!.strategyId}/sync-data`)).data,
    onSuccess: (result) => {
      message.success(`Synced ${(result as { synced: number }).synced} submission${(result as { synced: number }).synced !== 1 ? 's' : ''} from strategy`);
      qc.invalidateQueries({ queryKey: ['strategy', instance!.strategyId] });
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const generateDoc = useMutation({
    mutationFn: async () =>
      (await api.post<{ generated_document: string }>(`/api/workflows/instances/${instance!.id}/generate-document`)).data,
    onSuccess: (result) => {
      message.success('Document generated');
      setFormData((prev) => ({ ...prev, generated_document: result.generated_document }));
      onUpdated({ ...instance!, formData: { ...(instance!.formData ?? {}), generated_document: result.generated_document } });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const saveRef = useRef<() => void>(() => undefined);
  saveRef.current = () => {
    if (!instance) return;
    setSaveStatus('saving');
    const payload: Partial<WorkflowInstance> = { title, formData, targetMember, submissionDeadline, submissionMethod, notes, clientId: selectedClientId };
    // G: Auto-transition from triage to in_progress on first save
    if (instance.status === 'triage') payload.status = 'in_progress';
    updateInstance.mutate(payload);
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

  const handleClientSelect = (clientId: string | null) => {
    setSelectedClientId(clientId);
    scheduleAutoSave();
    if (!clientId || !orgContact) return;
    const client = clients.data?.find((c) => c.id === clientId);
    if (!client) return;
    const wouldFill = orgContact.fields.some((f) => {
      if (formData[f.key] !== undefined && formData[f.key] !== null && formData[f.key] !== '') return false;
      return Boolean(getClientFieldValue(f.key, client));
    });
    setFormData((prev) => {
      const next = { ...prev };
      for (const field of orgContact.fields) {
        if (prev[field.key] !== undefined && prev[field.key] !== null && prev[field.key] !== '') continue;
        const val = getClientFieldValue(field.key, client);
        if (val) next[field.key] = val;
      }
      return next;
    });
    if (wouldFill) setClientPrepopulated(true);
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

  const handleAiFill = async () => {
    if (!instance || !selectedClientId) return;
    setAiLoading(true);
    try {
      const resp = await api.post<{ suggestions: Record<string, AiSuggestion> }>(
        `/api/workflows/instances/${instance.id}/ai-fill`,
        { clientId: selectedClientId },
      );
      const suggestions = resp.data.suggestions ?? {};
      if (Object.keys(suggestions).length === 0) {
        message.info('No suggestions — all fillable fields may already have values, or the AI found insufficient context.');
        return;
      }
      setAiSuggestions(suggestions);
      setAcceptedKeys(new Set());
      setShowAiModal(true);
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setAiLoading(false);
    }
  };

  const handleEnhanceField = async (fieldKey: string, currentValue: string) => {
    if (!instance || !currentValue.trim()) return;
    setEnhancingKey(fieldKey);
    try {
      const resp = await api.post<{ enhanced: string }>(
        `/api/workflows/instances/${instance.id}/ai-enhance-field`,
        { fieldKey, currentValue },
      );
      handleFieldChange(fieldKey, resp.data.enhanced);
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setEnhancingKey(null);
    }
  };

  const acceptSuggestion = (key: string) => {
    const suggestion = aiSuggestions[key];
    if (!suggestion) return;
    // Coerce AI string values to proper types for integer/boolean fields
    let value: unknown = suggestion.value;
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (typeof value === 'string' && /^\d+$/.test(value)) {
      // Check if this is an integer field before converting
      const rt = (formData.request_type as string) ?? 'funding';
      const sec = rt === 'funding' ? sections?.funding : sections?.policy;
      const fields = (sec as Record<string, unknown> | undefined)?.section1 as { fields?: FieldDefinition[] } | undefined;
      const fieldDef = fields?.fields?.find((f) => f.key === key);
      if (fieldDef?.type === 'integer') value = Number(value);
    }
    handleFieldChange(key, value);
    setAcceptedKeys((prev) => new Set([...prev, key]));
  };

  const acceptAllSuggestions = () => {
    for (const key of Object.keys(aiSuggestions)) {
      acceptSuggestion(key);
    }
  };

  const template = instance?.template ?? null;
  const sections = template?.requiredSections?.sections ?? null;

  // A: authorization/defense templates only support funding requests
  const hideRequestTypeToggle =
    template?.category === 'authorization' ||
    template?.slug?.startsWith('hac-defense') ||
    template?.slug?.startsWith('ndaa-') ||
    // I: supporting templates with a generated document are view-only
    (template?.category === 'supporting' && Boolean(formData.generated_document));

  const requestType: RequestType = hideRequestTypeToggle
    ? 'funding'
    : ((formData.request_type as RequestType) ?? 'funding');

  const section1 =
    requestType === 'funding'
      ? (sections?.funding?.section1 ?? null)
      : (sections?.policy?.section1 ?? null);
  const requesterContact = sections?.shared?.requesterContact ?? null;
  const orgContact = sections?.shared?.orgContact ?? null;

  const requiredFields = useMemo(() => {
    if (!sections) return [];
    const typeSection =
      requestType === 'funding' ? sections.funding : sections.policy;
    const s1Fields = typeSection?.section1?.fields ?? [];
    const rcFields = sections.shared?.requesterContact?.fields ?? [];
    const ocFields = sections.shared?.orgContact?.fields ?? [];

    return [...s1Fields, ...rcFields, ...ocFields].filter((f) => {
      if (!f.required) return false;
      if (f.conditional) {
        const parentVal = formData[f.conditional.field];
        if (parentVal !== f.conditional.value) return false;
      }
      return true;
    });
  }, [sections, requestType, formData]);

  const completedCount = requiredFields.filter((f) => {
    const val = formData[f.key];
    return val !== undefined && val !== null && val !== '';
  }).length;

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
      width={580}
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
              icon={<CheckOutlined />}
              disabled={
                instance?.status === 'review' ||
                instance?.status === 'submitted' ||
                instance?.status === 'complete'
              }
              onClick={() => {
                if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
                updateInstance.mutate({
                  title, formData, targetMember, submissionDeadline, submissionMethod, notes,
                  clientId: selectedClientId,
                  status: 'review',
                });
              }}
            >
              Submit for Approval
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
          {/* Strategy banner */}
          {instance.strategyId && (
            <div className="workflow-drawer-strategy-banner">
              <span>
                Part of strategy:{' '}
                <Link to={`/workspace/strategy/${instance.strategyId}`}>
                  {strategyName ?? 'View Strategy'}
                </Link>
              </span>
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={syncFromStrategy.isPending}
                onClick={() => syncFromStrategy.mutate()}
              >
                Sync from strategy
              </Button>
            </div>
          )}

          {/* Client association */}
          <div className="workflow-drawer-section">
            <Typography.Text strong className="workflow-field-section-label">
              Client
            </Typography.Text>
            <Select
              style={{ width: '100%' }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Associate a client..."
              value={selectedClientId ?? undefined}
              onChange={(val: string | undefined) => handleClientSelect(val ?? null)}
              options={(clients.data ?? [])
                .filter((c) => c.status !== 'archived')
                .map((c) => ({ value: c.id, label: c.name }))}
              loading={clients.isPending}
            />
            {clientPrepopulated ? (
              <Alert
                type="info"
                showIcon
                message="Pre-populated from client profile"
                style={{ marginTop: 8, padding: '4px 8px', fontSize: 12 }}
              />
            ) : null}
          </div>

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

          {/* Request Type Toggle — hidden for authorization/defense and viewing generated docs */}
          {!hideRequestTypeToggle && (
            <div className="workflow-drawer-type-toggle">
              <Typography.Text strong className="workflow-field-section-label">
                Request Type
              </Typography.Text>
              <Radio.Group
                value={requestType}
                onChange={(e) => handleFieldChange('request_type', e.target.value as RequestType)}
                buttonStyle="solid"
              >
                <Radio.Button value="funding">Funding Request</Radio.Button>
                <Radio.Button value="policy">Policy / Bill Language Request</Radio.Button>
              </Radio.Group>
            </div>
          )}

          {/* AI auto-fill */}
          {section1 ? (
            <div className="workflow-drawer-ai-fill">
              <Button
                icon={<BulbOutlined />}
                type="dashed"
                loading={aiLoading}
                disabled={!selectedClientId}
                onClick={handleAiFill}
                title={selectedClientId ? 'Auto-fill fields using AI and client documents' : 'Select a client first'}
              >
                Auto-fill with AI
              </Button>
              {!selectedClientId ? (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  Select a client to enable AI auto-fill
                </Typography.Text>
              ) : null}
            </div>
          ) : null}

          {/* Section 1: Request-type specific fields */}
          {section1 ? (
            <div className="workflow-drawer-section">
              <Typography.Text strong className="workflow-field-section-label">
                {section1.title}
              </Typography.Text>
              {section1.fields.map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={formData[field.key]}
                  formData={formData}
                  onChange={handleFieldChange}
                  onEnhance={handleEnhanceField}
                  enhancingKey={enhancingKey}
                />
              ))}
            </div>
          ) : null}

          {/* Requester contact info */}
          {requesterContact ? (
            <div className="workflow-drawer-section workflow-drawer-contact-section">
              <Typography.Text strong className="workflow-field-section-label">
                {requesterContact.title}
              </Typography.Text>
              {requesterPrepopulated ? (
                <Alert
                  type="info"
                  showIcon
                  message="Pre-populated from your organization settings"
                  style={{ marginBottom: 8, padding: '4px 8px', fontSize: 12 }}
                />
              ) : null}
              {requesterContact.helpText ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {requesterContact.helpText}
                </Typography.Text>
              ) : null}
              {requesterContact.fields.map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={formData[field.key]}
                  formData={formData}
                  onChange={handleFieldChange}
                />
              ))}
            </div>
          ) : null}

          {/* Org contact info */}
          {orgContact ? (
            <div className="workflow-drawer-section workflow-drawer-contact-section">
              <Typography.Text strong className="workflow-field-section-label">
                {orgContact.title}
              </Typography.Text>
              {orgContact.helpText ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {orgContact.helpText}
                </Typography.Text>
              ) : null}
              {orgContact.fields.map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={formData[field.key]}
                  formData={formData}
                  onChange={handleFieldChange}
                />
              ))}
            </div>
          ) : null}

          {/* Generated document preview */}
          {instance.template?.category === 'supporting' && (
            <div className="workflow-drawer-section">
              <Typography.Text strong className="workflow-field-section-label">
                Generated Document
              </Typography.Text>
              {formData.generated_document ? (
                <>
                  <div className="generated-doc-preview">
                    {String(formData.generated_document)}
                  </div>
                  <div className="generated-doc-actions">
                    <Button
                      size="small"
                      icon={<RedoOutlined />}
                      loading={generateDoc.isPending}
                      onClick={() => generateDoc.mutate()}
                    >
                      Regenerate
                    </Button>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(String(formData.generated_document));
                        message.success('Copied to clipboard');
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  type="dashed"
                  icon={<BulbOutlined />}
                  loading={generateDoc.isPending}
                  onClick={() => generateDoc.mutate()}
                  style={{ width: '100%' }}
                >
                  Generate Document with AI
                </Button>
              )}
            </div>
          )}

        </div>
      ) : null}

      <Modal
        open={showAiModal}
        title={
          <Space>
            <BulbOutlined style={{ color: '#faad14' }} />
            AI Suggestions
          </Space>
        }
        onCancel={() => setShowAiModal(false)}
        footer={
          <Space>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => {
                acceptAllSuggestions();
                setShowAiModal(false);
              }}
            >
              Accept All
            </Button>
            <Button onClick={() => setShowAiModal(false)}>Dismiss</Button>
          </Space>
        }
        width={560}
      >
        <div className="workflow-drawer-ai-suggestions">
          {Object.entries(aiSuggestions).map(([key, suggestion]) => {
            const fieldDef = section1?.fields.find((f) => f.key === key);
            const label = fieldDef?.label ?? key;
            const accepted = acceptedKeys.has(key);
            return (
              <div key={key} className={`workflow-drawer-ai-suggestion${accepted ? ' workflow-drawer-ai-suggestion--accepted' : ''}`}>
                <div className="workflow-drawer-ai-suggestion-header">
                  <Typography.Text strong style={{ fontSize: 13 }}>{label}</Typography.Text>
                  <Button
                    size="small"
                    type={accepted ? 'default' : 'primary'}
                    icon={accepted ? <CheckOutlined /> : null}
                    onClick={() => acceptSuggestion(key)}
                    disabled={accepted}
                  >
                    {accepted ? 'Accepted' : 'Accept'}
                  </Button>
                </div>
                <Typography.Text style={{ fontSize: 13 }}>{suggestion.value}</Typography.Text>
                <div className="workflow-drawer-ai-reasoning">
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {suggestion.reasoning}
                  </Typography.Text>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </Drawer>
  );
}

function FieldRenderer({
  field,
  value,
  formData,
  onChange,
  onEnhance,
  enhancingKey,
}: {
  field: FieldDefinition;
  value: unknown;
  formData: Record<string, unknown>;
  onChange: (key: string, val: unknown) => void;
  onEnhance?: (key: string, currentValue: string) => void;
  enhancingKey?: string | null;
}) {
  if (field.conditional) {
    const parentVal = formData[field.conditional.field];
    if (parentVal !== field.conditional.value) return null;
  }

  const isConditional = !!field.conditional;

  return (
    <div className={`workflow-drawer-field${isConditional ? ' workflow-drawer-conditional' : ''}`}>
      <label className="workflow-field-label">
        {field.label}
        {field.required ? <span className="workflow-field-required">*</span> : null}
      </label>

      {field.type === 'text' && (
        <Input
          value={typeof value === 'string' ? value : ''}
          maxLength={field.maxLength}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}

      {field.type === 'integer' && (
        <InputNumber
          style={{ width: '100%' }}
          value={typeof value === 'number' ? value : undefined}
          precision={0}
          step={1}
          formatter={intFormatter}
          parser={intParser}
          onChange={(val) => onChange(field.key, val ?? undefined)}
        />
      )}

      {field.type === 'textarea' && (
        <>
          <Input.TextArea
            value={typeof value === 'string' ? value : ''}
            autoSize={{ minRows: 3 }}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
          {onEnhance && (
            <Button
              size="small"
              type="text"
              loading={enhancingKey === field.key}
              disabled={!value || (typeof value === 'string' && !value.trim())}
              onClick={() => onEnhance(field.key, typeof value === 'string' ? value : '')}
              style={{ marginTop: 4, padding: '0 4px', fontSize: 12 }}
            >
              ✨ Enhance with AI
            </Button>
          )}
        </>
      )}

      {field.type === 'select' && (
        <Select
          style={{ width: '100%' }}
          value={typeof value === 'string' ? value : undefined}
          options={(field.options ?? []).map((opt) => ({ value: opt, label: opt }))}
          onChange={(val) => onChange(field.key, val)}
          placeholder="Select…"
          allowClear
        />
      )}

      {field.type === 'boolean' && (
        <Radio.Group
          className="workflow-drawer-boolean"
          value={typeof value === 'boolean' ? value : undefined}
          onChange={(e) => onChange(field.key, e.target.value as boolean)}
        >
          <Radio value={true}>Yes</Radio>
          <Radio value={false}>No</Radio>
        </Radio.Group>
      )}

      {field.helpText ? (
        <span className="workflow-drawer-field-help">{field.helpText}</span>
      ) : null}
    </div>
  );
}

function intFormatter(value: number | string | undefined): string {
  if (value === undefined || value === null) return '';
  const num = Math.trunc(Number(value));
  if (!Number.isFinite(num)) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function intParser(value: string | undefined): number {
  const cleaned = (value ?? '').replace(/,/g, '');
  const parsed = parseInt(cleaned, 10);
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

function requesterKeyToContactKey(fieldKey: string): string | null {
  const stripped = fieldKey.replace(/^requester_/, '');
  if (stripped === fieldKey) return null;
  return stripped.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function getClientFieldValue(key: string, client: Client): string | undefined {
  const intake = (client.intakeData ?? {}) as Record<string, unknown>;
  switch (key) {
    case 'org_name': return nonEmpty(client.name);
    case 'org_address1': return nonEmpty(intake.address1 as string | undefined);
    case 'org_address2': return nonEmpty(intake.address2 as string | undefined);
    case 'org_city': return nonEmpty(intake.city as string | undefined);
    case 'org_state': return nonEmpty(intake.state as string | undefined);
    case 'org_zip': return nonEmpty(intake.zip as string | undefined);
    case 'org_phone': return nonEmpty(client.primaryContactPhone);
    case 'poc_name':
      return nonEmpty(client.primaryContactName) ?? nonEmpty(intake.pocName as string | undefined);
    case 'poc_email':
      return nonEmpty(client.primaryContactEmail) ?? nonEmpty(intake.pocEmail as string | undefined);
    case 'poc_phone':
      return nonEmpty(client.primaryContactPhone) ?? nonEmpty(intake.pocPhone as string | undefined);
    case 'org_head_name': return nonEmpty(intake.headName as string | undefined);
    case 'org_head_title': return nonEmpty(intake.headTitle as string | undefined);
    default: return undefined;
  }
}

function nonEmpty(val: string | null | undefined): string | undefined {
  return val && val.trim() ? val.trim() : undefined;
}
