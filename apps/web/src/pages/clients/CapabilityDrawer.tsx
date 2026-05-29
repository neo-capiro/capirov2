import { useState } from 'react';
import { CloseOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';

interface LdaIssueOption {
  code: string;
  name: string;
}

export interface Capability {
  id: string;
  clientId: string;
  name: string;
  type: string;
  description: string | null;
  sector: string | null;
  tags: string[];
  issueCodes: string[];
  trl: number | null;
  mrl: number | null;
  peNumber: string | null;
  appropriationAccount: string | null;
  serviceBranch: string | null;
  targetSubcommittee: string | null;
  fundingAsk: number | null;
  fundingAskLabel: string | null;
  justification: string | null;
  districtNexus: string | null;
  existingContracts: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionHistory {
  id: string;
  clientId: string;
  capabilityId: string | null;
  fiscalYear: string;
  title: string;
  meta: string | null;
  outcome: string | null;
  outcomeType: string;
  notes: string | null;
  createdAt: string;
}

const OUTCOME_CSS: Record<string, string> = {
  success: 'she-outcome-success',
  partial: 'she-outcome-partial',
  failed: 'she-outcome-failed',
  in_progress: 'she-outcome-in_progress',
};

const DOT_CSS: Record<string, string> = {
  success: 'she-dot-success',
  partial: 'she-dot-partial',
  failed: 'she-dot-failed',
  in_progress: 'she-dot-in_progress',
};

const OUTCOME_LABELS: Record<string, string> = {
  success: 'Success',
  partial: 'Partial',
  failed: 'Failed',
  in_progress: 'In Progress',
};

const TYPE_CSS: Record<string, string> = {
  product: 'cap-type-product',
  service: 'cap-type-service',
  platform: 'cap-type-platform',
  technology: 'cap-type-technology',
};

const TRL_LABELS = [
  'Basic principles',
  'Concept formulated',
  'Proof of concept',
  'Lab validated',
  'Relevant environment',
  'Prototype demonstrated',
  'System prototype',
  'System qualified',
  'Operational proven',
];

const MRL_LABELS = [
  'Manufacturing implications',
  'Concepts identified',
  'Proof of concept',
  'Lab environment',
  'Prototype capability',
  'Relevant environment',
  'Production environment',
  'Pilot line',
  'Low rate production',
  'Full rate production',
];

interface Props {
  capability: Capability | null;
  clientId: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function CapabilityDrawer({ capability, clientId, onClose, onUpdated }: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [drawerTab, setDrawerTab] = useState<'profile' | 'history' | 'documents'>('profile');
  const [addingHistory, setAddingHistory] = useState(false);

  const historyQuery = useQuery<SubmissionHistory[]>({
    queryKey: ['client-capability-history', clientId, capability?.id],
    queryFn: async () =>
      (
        await api.get<SubmissionHistory[]>(
          `/api/clients/${clientId}/capabilities/${capability!.id}/history`,
        )
      ).data,
    enabled: Boolean(capability?.id) && drawerTab === 'history',
  });

  const patchCapability = useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      (await api.patch(`/api/clients/${clientId}/capabilities/${capability!.id}`, patch)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-capabilities', clientId] });
      onUpdated();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const createHistory = useMutation({
    mutationFn: async (data: {
      fiscalYear: string;
      title: string;
      meta?: string;
      outcomeType?: string;
      notes?: string;
    }) =>
      (await api.post(`/api/clients/${clientId}/capabilities/${capability!.id}/history`, data))
        .data,
    onSuccess: () => {
      message.success('Entry added');
      setAddingHistory(false);
      qc.invalidateQueries({ queryKey: ['client-capability-history', clientId, capability?.id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const deleteHistory = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/clients/${clientId}/history/${id}`)).data,
    onSuccess: () => {
      message.success('Entry removed');
      qc.invalidateQueries({ queryKey: ['client-capability-history', clientId, capability?.id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  if (!capability) return null;

  const typeClass = TYPE_CSS[capability.type] ?? 'cap-type-product';

  return (
    <div className="cap-drawer">
      <div className="cap-drawer-hd">
        <div style={{ flex: 1 }}>
          <div className="cap-drawer-name">{capability.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className={`cap-type-tag ${typeClass}`} style={{ textTransform: 'capitalize' }}>
              {capability.type}
            </span>
            {capability.sector ? (
              <span className="cap-sector-tag">{capability.sector}</span>
            ) : null}
          </div>
        </div>
        <button className="cp-back" onClick={onClose} aria-label="Close drawer">
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </div>

      <div className="cap-drawer-tabs">
        {(['profile', 'history', 'documents'] as const).map((tab) => (
          <div
            key={tab}
            className={`cap-drawer-tab${drawerTab === tab ? ' active' : ''}`}
            onClick={() => setDrawerTab(tab)}
            role="tab"
          >
            {tab === 'profile'
              ? 'Profile'
              : tab === 'history'
                ? 'Submission History'
                : 'Documents'}
          </div>
        ))}
      </div>

      <div className="cap-drawer-body">
        {drawerTab === 'profile' && (
          <ProfileTab capability={capability} onPatch={(p) => patchCapability.mutate(p)} />
        )}
        {drawerTab === 'history' && (
          <HistoryTab
            history={historyQuery.data ?? []}
            loading={historyQuery.isLoading}
            addingHistory={addingHistory}
            onAdd={() => setAddingHistory(true)}
            onCancelAdd={() => setAddingHistory(false)}
            onCreateHistory={(data) => createHistory.mutate(data)}
            onDeleteHistory={(id) => {
              modal.confirm({
                title: 'Remove this entry?',
                okText: 'Remove',
                okButtonProps: { danger: true },
                onOk: () => deleteHistory.mutateAsync(id),
              });
            }}
            creating={createHistory.isPending}
          />
        )}
        {drawerTab === 'documents' && (
          <div className="cp-doc-placeholder">
            <Typography.Text type="secondary">
              Document filtering by capability is coming soon. Upload documents from the client&apos;s
              Documents tab.
            </Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileTab({
  capability,
  onPatch,
}: {
  capability: Capability;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const api = useApi();

  const issuesQuery = useQuery<LdaIssueOption[]>({
    queryKey: ['lda-issues-options'],
    queryFn: async () => (await api.get<LdaIssueOption[]>('/api/lda-intel/issues')).data,
    staleTime: 30 * 60 * 1000,
  });

  const issueCodeOptions = (issuesQuery.data ?? []).map((issue) => ({
    value: issue.code,
    label: `${issue.code}, ${issue.name}`,
  }));

  return (
    <>
      <div className="readiness-matrix">
        <ReadinessItem
          label="TRL"
          value={capability.trl}
          max={9}
          labels={TRL_LABELS}
          onSave={(v) => onPatch({ trl: v })}
        />
        <ReadinessItem
          label="MRL"
          value={capability.mrl}
          max={10}
          labels={MRL_LABELS}
          onSave={(v) => onPatch({ mrl: v })}
        />
      </div>

      <InlineTextArea
        label="Description"
        value={capability.description ?? ''}
        placeholder="Describe this capability..."
        onSave={(v) => onPatch({ description: v || null })}
      />

      <div style={{ marginTop: 16 }}>
        <div className="ps-title">Government Engagement</div>
        <InlineFieldRow
          label="PE Number"
          value={capability.peNumber ?? ''}
          placeholder="e.g. 0603286F"
          onSave={(v) => onPatch({ peNumber: v || null })}
        />
        <InlineFieldRow
          label="Appropriation Account"
          value={capability.appropriationAccount ?? ''}
          placeholder="e.g. RDT&E Army"
          onSave={(v) => onPatch({ appropriationAccount: v || null })}
        />
        <InlineFieldRow
          label="Service Branch"
          value={capability.serviceBranch ?? ''}
          placeholder="e.g. Army, Navy, AF"
          onSave={(v) => onPatch({ serviceBranch: v || null })}
        />
        <InlineFieldRow
          label="Target Subcommittee"
          value={capability.targetSubcommittee ?? ''}
          placeholder="e.g. HASC, SASC-SA"
          onSave={(v) => onPatch({ targetSubcommittee: v || null })}
        />
        <InlineNumberRow
          label="Funding Ask ($)"
          value={capability.fundingAsk}
          onSave={(v) => onPatch({ fundingAsk: v ?? null })}
        />
        <InlineFieldRow
          label="Ask Label"
          value={capability.fundingAskLabel ?? ''}
          placeholder="e.g. SAC-D FY27 ask"
          onSave={(v) => onPatch({ fundingAskLabel: v || null })}
        />
        <InlineFieldRow
          label="Existing Contracts"
          value={capability.existingContracts ?? ''}
          placeholder="e.g. SBIR Phase II, ONR BAA"
          onSave={(v) => onPatch({ existingContracts: v || null })}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        <InlineTextArea
          label="Justification"
          value={capability.justification ?? ''}
          placeholder="Congressional justification..."
          onSave={(v) => onPatch({ justification: v || null })}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        <InlineTextArea
          label="District Nexus"
          value={capability.districtNexus ?? ''}
          placeholder="Connection to district/state..."
          onSave={(v) => onPatch({ districtNexus: v || null })}
        />
      </div>

      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <div className="ps-title" style={{ marginBottom: 6 }}>LDA Issue Codes</div>
        <Select
          mode="multiple"
          allowClear
          showSearch
          placeholder={issuesQuery.isLoading ? 'Loading issue codes…' : 'Select issue codes'}
          value={Array.isArray(capability.issueCodes) ? capability.issueCodes : []}
          options={issueCodeOptions}
          optionFilterProp="label"
          loading={issuesQuery.isLoading}
          disabled={issuesQuery.isError}
          onChange={(values) => onPatch({ issueCodes: values })}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        <InlineTextArea
          label="Notes"
          value={capability.notes ?? ''}
          placeholder="Internal notes..."
          onSave={(v) => onPatch({ notes: v || null })}
        />
      </div>
    </>
  );
}

function HistoryTab({
  history,
  loading,
  addingHistory,
  onAdd,
  onCancelAdd,
  onCreateHistory,
  onDeleteHistory,
  creating,
}: {
  history: SubmissionHistory[];
  loading: boolean;
  addingHistory: boolean;
  onAdd: () => void;
  onCancelAdd: () => void;
  onCreateHistory: (data: {
    fiscalYear: string;
    title: string;
    meta?: string;
    outcomeType?: string;
    notes?: string;
  }) => void;
  onDeleteHistory: (id: string) => void;
  creating: boolean;
}) {
  const [fy, setFy] = useState('');
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState('');
  const [outcomeType, setOutcomeType] = useState('in_progress');
  const [notes, setNotes] = useState('');

  const resetForm = () => {
    setFy('');
    setTitle('');
    setMeta('');
    setOutcomeType('in_progress');
    setNotes('');
    onCancelAdd();
  };

  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;

  return (
    <>
      {history.length === 0 && !addingHistory ? (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          No submission history yet.
        </Typography.Text>
      ) : null}

      {history.map((entry) => (
        <div className="sub-hist-entry" key={entry.id}>
          <div className="she-year">{entry.fiscalYear}</div>
          <div className={`she-dot ${DOT_CSS[entry.outcomeType] ?? 'she-dot-in_progress'}`} />
          <div className="she-content">
            <div className="she-title">{entry.title}</div>
            {entry.meta ? <div className="she-meta">{entry.meta}</div> : null}
            <span
              className={`she-outcome ${OUTCOME_CSS[entry.outcomeType] ?? 'she-outcome-in_progress'}`}
            >
              {OUTCOME_LABELS[entry.outcomeType] ?? entry.outcomeType}
            </span>
            {entry.notes ? <div className="she-notes">{entry.notes}</div> : null}
          </div>
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            danger
            onClick={() => onDeleteHistory(entry.id)}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
        </div>
      ))}

      {addingHistory ? (
        <div
          style={{
            border: '1px solid #e8e8e8',
            borderRadius: 8,
            padding: '14px 16px',
            marginTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <Typography.Text strong style={{ fontSize: 12 }}>
            New Entry
          </Typography.Text>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="FY27"
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              style={{ width: 80 }}
              size="small"
            />
            <Input
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ flex: 1 }}
              size="small"
            />
          </div>
          <Input
            placeholder="Meta (committee, member, PE)"
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            size="small"
          />
          <Select
            size="small"
            value={outcomeType}
            onChange={setOutcomeType}
            options={[
              { label: 'In Progress', value: 'in_progress' },
              { label: 'Success', value: 'success' },
              { label: 'Partial', value: 'partial' },
              { label: 'Failed', value: 'failed' },
            ]}
          />
          <Input.TextArea
            placeholder="Notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            size="small"
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={resetForm}>
              Cancel
            </Button>
            <Button
              size="small"
              type="primary"
              loading={creating}
              disabled={!fy.trim() || !title.trim()}
              onClick={() => {
                onCreateHistory({
                  fiscalYear: fy.trim(),
                  title: title.trim(),
                  meta: meta.trim() || undefined,
                  outcomeType,
                  notes: notes.trim() || undefined,
                });
                resetForm();
              }}
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <button className="she-add-btn" onClick={onAdd}>
          <PlusOutlined /> Add submission entry
        </button>
      )}
    </>
  );
}

function ReadinessItem({
  label,
  value,
  max,
  labels,
  onSave,
}: {
  label: string;
  value: number | null;
  max: number;
  labels: string[];
  onSave: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);
  const pct = value != null ? Math.round((value / max) * 100) : 0;
  const desc = value != null ? (labels[value - 1] ?? '') : '';

  return (
    <div className="rm-item">
      <div className="rm-label">{label}</div>
      {editing ? (
        <InputNumber
          min={1}
          max={max}
          value={draft ?? undefined}
          onChange={(v) => setDraft(v ?? null)}
          onBlur={() => {
            setEditing(false);
            onSave(draft);
          }}
          onPressEnter={() => {
            setEditing(false);
            onSave(draft);
          }}
          size="small"
          style={{ width: 70 }}
          autoFocus
        />
      ) : (
        <div
          className="rm-val"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          style={{ cursor: 'pointer' }}
          title="Click to edit"
        >
          {value != null ? value : '-'}
        </div>
      )}
      <div className="rm-bar">
        <div className="rm-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {desc ? <div className="rm-desc">{desc}</div> : null}
    </div>
  );
}

function InlineFieldRow({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div className="cap-field-row">
      <span className="cap-field-key">{label}</span>
      {editing ? (
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            onSave(draft);
          }}
          onPressEnter={() => {
            setEditing(false);
            onSave(draft);
          }}
          size="small"
          autoFocus
          style={{ flex: 1 }}
        />
      ) : (
        <span
          className="cap-field-val"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          style={{ cursor: 'pointer', minHeight: 18 }}
          title="Click to edit"
        >
          {value || (
            <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>{placeholder ?? '-'}</span>
          )}
        </span>
      )}
    </div>
  );
}

function InlineNumberRow({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);

  const display = value != null ? `$${value.toLocaleString()}` : null;

  return (
    <div className="cap-field-row">
      <span className="cap-field-key">{label}</span>
      {editing ? (
        <InputNumber
          value={draft ?? undefined}
          onChange={(v) => setDraft(v ?? null)}
          onBlur={() => {
            setEditing(false);
            onSave(draft);
          }}
          onPressEnter={() => {
            setEditing(false);
            onSave(draft);
          }}
          size="small"
          autoFocus
          style={{ flex: 1 }}
          formatter={(v) => (v ? `$${Number(v).toLocaleString()}` : '')}
          parser={(v) => Number(v?.replace(/[^0-9]/g, '') ?? 0)}
          min={0}
        />
      ) : (
        <span
          className="cap-field-val"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          style={{ cursor: 'pointer', minHeight: 18 }}
          title="Click to edit"
        >
          {display ?? <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>-</span>}
        </span>
      )}
    </div>
  );
}

function InlineTextArea({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="ps-title" style={{ marginBottom: 6 }}>
        {label}
      </div>
      {editing ? (
        <Input.TextArea
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            onSave(draft);
          }}
          rows={3}
          autoFocus
        />
      ) : (
        <div
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          style={{
            fontSize: 12.5,
            color: value ? '#262626' : '#bfbfbf',
            fontStyle: value ? 'normal' : 'italic',
            cursor: 'pointer',
            lineHeight: 1.6,
            padding: '4px 0',
            minHeight: 22,
          }}
          title="Click to edit"
        >
          {value || placeholder || '-'}
        </div>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
