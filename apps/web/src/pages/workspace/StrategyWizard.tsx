import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Checkbox,
  Divider,
  Input,
  Select,
  Skeleton,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import type { Client } from '../clients/clientTypes.js';
import type { Capability } from '../clients/CapabilityDrawer.js';
import type { DirectoryApiResponse, DirectoryEntry } from '../directory/directoryData.js';

const { Title, Text } = Typography;

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}

interface DraftTarget {
  directoryId: string;
  memberName: string;
  memberTitle: string | null;
  memberParty: string | null;
  memberState: string | null;
  committee: string | null;
  stafferName: string;
  stafferEmail: string;
}

const SUBMISSION_GROUPS = [
  {
    category: 'authorization',
    label: 'Authorization',
    items: [
      { key: 'ndaa-authorization-request', label: 'NDAA Authorization Request', shortLabel: 'NDAA', cat: 'authorization' },
    ],
  },
  {
    category: 'appropriations',
    label: 'Appropriations',
    items: [
      { key: 'hac-defense-programmatic', label: 'HAC Defense Programmatic', shortLabel: 'HAC-D', cat: 'appropriations' },
      { key: 'hac-homeland-programmatic', label: 'HAC Homeland Security', shortLabel: 'HAC-HS', cat: 'appropriations' },
      { key: 'hac-milcon-va-programmatic', label: 'HAC Military Construction/VA', shortLabel: 'HAC-MC', cat: 'appropriations' },
      { key: 'hac-agriculture-programmatic', label: 'HAC Agriculture', shortLabel: 'HAC-AG', cat: 'appropriations' },
      { key: 'hac-cjs-programmatic', label: 'HAC Commerce, Justice, Science', shortLabel: 'HAC-CJS', cat: 'appropriations' },
      { key: 'hac-energy-water-programmatic', label: 'HAC Energy & Water', shortLabel: 'HAC-EW', cat: 'appropriations' },
      { key: 'hac-labor-hhs-programmatic', label: 'HAC Labor, HHS, Education', shortLabel: 'HAC-LH', cat: 'appropriations' },
      { key: 'hac-thud-programmatic', label: 'HAC Transportation/HUD', shortLabel: 'HAC-TH', cat: 'appropriations' },
    ],
  },
  {
    category: 'language',
    label: 'Language',
    items: [
      { key: 'hac-language-request', label: 'Bill/Report Language Request', shortLabel: 'LANG', cat: 'language' },
    ],
  },
  {
    category: 'supporting',
    label: 'Supporting Documents',
    items: [
      { key: 'program-white-paper', label: 'Program White Paper', shortLabel: 'WP', cat: 'supporting' },
      { key: 'meeting-request-letter', label: 'Meeting Request Letter', shortLabel: 'MTG', cat: 'supporting' },
      { key: 'leave-behind-talking-points', label: 'Leave-Behind / Talking Points', shortLabel: 'LB', cat: 'supporting' },
      { key: 'follow-up-letter', label: 'Follow-Up Letter', shortLabel: 'FU', cat: 'supporting' },
    ],
  },
];

const APPROP_KEYS = ['hac-defense-programmatic', 'hac-homeland-programmatic', 'hac-milcon-va-programmatic', 'hac-agriculture-programmatic', 'hac-cjs-programmatic', 'hac-energy-water-programmatic', 'hac-labor-hhs-programmatic', 'hac-thud-programmatic'];
const ALL_SUBMISSION_ITEMS = SUBMISSION_GROUPS.flatMap((g) => g.items);

const STEP_ITEMS = [
  { title: 'Client & Capability' },
  { title: 'Submissions' },
  { title: 'Target Members' },
  { title: 'Review & Create' },
];

export function StrategyWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const api = useApi();
  const { message } = AntApp.useApp();

  const initialClientId = searchParams.get('clientId');
  const initialCapabilityId = searchParams.get('capabilityId');

  const [currentStep, setCurrentStep] = useState(0);
  const [clientId, setClientId] = useState<string | null>(initialClientId);
  const [capabilityId, setCapabilityId] = useState<string | null>(initialCapabilityId);
  const [fiscalYear, setFiscalYear] = useState('FY27');
  const [strategyName, setStrategyName] = useState('');
  const [autoNamedFor, setAutoNamedFor] = useState<string | null>(null);
  const [selectedSubmissions, setSelectedSubmissions] = useState<string[]>([]);
  const [targets, setTargets] = useState<DraftTarget[]>([]);
  const [dirSearchQ, setDirSearchQ] = useState('');
  const [debouncedSearchQ, setDebouncedSearchQ] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce directory search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearchQ(dirSearchQ);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dirSearchQ]);

  // Clients query
  const { data: clients, isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/api/clients').then((r) => r.data),
  });

  // Capabilities query
  const { data: capabilities, isLoading: capsLoading } = useQuery<Capability[]>({
    queryKey: ['capabilities', clientId],
    queryFn: () => api.get(`/api/clients/${clientId}/capabilities`).then((r) => r.data),
    enabled: !!clientId,
  });

  // Directory search
  const { data: dirResults, isFetching: dirFetching } = useQuery<DirectoryApiResponse>({
    queryKey: ['directory-search', debouncedSearchQ],
    queryFn: () =>
      api
        .get('/api/directory/contacts', { params: { q: debouncedSearchQ, pageSize: 20, page: 1 } })
        .then((r) => r.data),
    enabled: debouncedSearchQ.length >= 2,
  });

  // Auto-generate strategy name when capability changes
  useEffect(() => {
    if (!capabilityId || !capabilities) return;
    const cap = capabilities.find((c) => String(c.id) === String(capabilityId));
    if (!cap) return;

    const generated = `${fiscalYear} ${cap.name} Strategy`;
    if (!strategyName || strategyName === autoNamedFor) {
      setStrategyName(generated);
      setAutoNamedFor(generated);
    }

    // Auto-add hac_defense if PE number is set
    if (cap.peNumber) {
      setSelectedSubmissions((prev) =>
        prev.includes('hac-defense-programmatic') ? prev : [...prev, 'hac-defense-programmatic']
      );
    }
  }, [capabilityId, capabilities]);

  // Re-generate name if fiscalYear changes and name was auto-generated
  useEffect(() => {
    if (!capabilityId || !capabilities) return;
    const cap = capabilities.find((c) => String(c.id) === String(capabilityId));
    if (!cap) return;
    if (strategyName === autoNamedFor) {
      const generated = `${fiscalYear} ${cap.name} Strategy`;
      setStrategyName(generated);
      setAutoNamedFor(generated);
    }
  }, [fiscalYear]);

  // Auto-add white_paper when any appropriations key is selected
  useEffect(() => {
    const hasApprop = APPROP_KEYS.some((k) => selectedSubmissions.includes(k));
    if (hasApprop) {
      setSelectedSubmissions((prev) =>
        prev.includes('white_paper') ? prev : [...prev, 'white_paper']
      );
    }
  }, [selectedSubmissions.join(',')]);

  // Smart suggestion: ndaa_auth → auto-add hac_defense
  useEffect(() => {
    if (selectedSubmissions.includes('ndaa-authorization-request')) {
      setSelectedSubmissions((prev) =>
        prev.includes('hac-defense-programmatic') ? prev : [...prev, 'hac-defense-programmatic']
      );
    }
  }, [selectedSubmissions.includes('ndaa-authorization-request')]);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Create strategy
      const stratRes = await api.post('/api/strategies', {
        clientId,
        capabilityId,
        name: strategyName,
        fiscalYear,
        submissionTypes: selectedSubmissions,
      });
      const strategy = stratRes.data;
      const stratId = strategy.id;

      // Step 2: Create submissions
      await api.post(`/api/strategies/${stratId}/create-submissions`);

      // Step 3: Create targets
      for (const t of targets) {
        await api.post(`/api/strategies/${stratId}/targets`, {
          memberName: t.memberName,
          memberTitle: t.memberTitle,
          memberParty: t.memberParty,
          memberState: t.memberState,
          committee: t.committee,
          stafferName: t.stafferName,
          stafferEmail: t.stafferEmail,
          directoryContactId: t.directoryId,
          outreachStatus: 'not_started',
        });
      }

      return stratId;
    },
    onSuccess: (stratId) => {
      message.success('Strategy created');
      navigate(`/workspace/strategy/${stratId}`);
    },
    onError: (err) => {
      message.error(errorMessage(err));
    },
  });

  function validateStep(step: number): string | null {
    if (step === 0) {
      if (!clientId) return 'Please select a client.';
      if (!strategyName.trim()) return 'Please enter a strategy name.';
    }
    if (step === 1) {
      if (selectedSubmissions.length === 0) return 'Please select at least one submission type.';
    }
    return null;
  }

  function handleNext() {
    const err = validateStep(currentStep);
    if (err) {
      message.warning(err);
      return;
    }
    setCurrentStep((s) => s + 1);
  }

  function handleBack() {
    setCurrentStep((s) => s - 1);
  }

  function handleCreate() {
    createMutation.mutate();
  }

  function toggleSubmission(key: string) {
    setSelectedSubmissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function addTargetFromDirectory(entry: DirectoryEntry) {
    if (targets.some((t) => t.directoryId === String(entry.id))) return;
    setTargets((prev) => [
      ...prev,
      {
        directoryId: String(entry.id),
        memberName: entry.memberName ?? entry.fullName ?? '',
        memberTitle: entry.title ?? null,
        memberParty: (entry as any).party ?? null,
        memberState: (entry as any).state ?? null,
        committee: (entry as any).committees?.[0] ?? null,
        stafferName: '',
        stafferEmail: '',
      },
    ]);
  }

  function removeTarget(directoryId: string) {
    setTargets((prev) => prev.filter((t) => t.directoryId !== directoryId));
  }

  function updateTarget(directoryId: string, field: 'stafferName' | 'stafferEmail', value: string) {
    setTargets((prev) =>
      prev.map((t) => (t.directoryId === directoryId ? { ...t, [field]: value } : t))
    );
  }

  const selectedClient = clients?.find((c) => String(c.id) === String(clientId));
  const selectedCap = capabilities?.find((c) => String(c.id) === String(capabilityId));

  return (
    <div className="strategy-wizard">
      <div className="strategy-wizard-header">
        <Title level={4} style={{ marginBottom: 24 }}>
          New Strategy
        </Title>
        <Steps
          current={currentStep}
          items={STEP_ITEMS}
          style={{ maxWidth: 700, marginBottom: 32 }}
        />
      </div>

      <div className="strategy-wizard-step">
        {currentStep === 0 && (
          <StepClientCapability
            clientId={clientId}
            capabilityId={capabilityId}
            fiscalYear={fiscalYear}
            strategyName={strategyName}
            clients={clients ?? []}
            capabilities={capabilities ?? []}
            clientsLoading={clientsLoading}
            capsLoading={capsLoading}
            onClientChange={(val) => {
              setClientId(val);
              setCapabilityId(null);
            }}
            onCapabilityChange={setCapabilityId}
            onFiscalYearChange={setFiscalYear}
            onStrategyNameChange={(val) => {
              setStrategyName(val);
              setAutoNamedFor(null);
            }}
          />
        )}

        {currentStep === 1 && (
          <StepSubmissions
            selectedSubmissions={selectedSubmissions}
            onToggle={toggleSubmission}
          />
        )}

        {currentStep === 2 && (
          <StepTargets
            dirSearchQ={dirSearchQ}
            dirResults={dirResults}
            dirFetching={dirFetching}
            targets={targets}
            onSearchChange={setDirSearchQ}
            onAddTarget={addTargetFromDirectory}
            onRemoveTarget={removeTarget}
            onUpdateTarget={updateTarget}
          />
        )}

        {currentStep === 3 && (
          <StepReview
            strategyName={strategyName}
            clientName={selectedClient?.name ?? clientId ?? ''}
            capabilityName={selectedCap?.name ?? capabilityId ?? ''}
            fiscalYear={fiscalYear}
            selectedSubmissions={selectedSubmissions}
            targets={targets}
          />
        )}
      </div>

      <div className="strategy-wizard-nav" style={{ marginTop: 32, display: 'flex', gap: 12 }}>
        {currentStep > 0 && <Button onClick={handleBack}>Back</Button>}
        {currentStep < 3 && (
          <Button type="primary" onClick={handleNext}>
            Next
          </Button>
        )}
        {currentStep === 3 && (
          <Button
            type="primary"
            loading={createMutation.isPending}
            onClick={handleCreate}
          >
            Create Strategy
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 1: Client & Capability ───────────────────────────────────────────

interface StepClientCapabilityProps {
  clientId: string | null;
  capabilityId: string | null;
  fiscalYear: string;
  strategyName: string;
  clients: Client[];
  capabilities: Capability[];
  clientsLoading: boolean;
  capsLoading: boolean;
  onClientChange: (val: string | null) => void;
  onCapabilityChange: (val: string | null) => void;
  onFiscalYearChange: (val: string) => void;
  onStrategyNameChange: (val: string) => void;
}

function StepClientCapability({
  clientId,
  capabilityId,
  fiscalYear,
  strategyName,
  clients,
  capabilities,
  clientsLoading,
  capsLoading,
  onClientChange,
  onCapabilityChange,
  onFiscalYearChange,
  onStrategyNameChange,
}: StepClientCapabilityProps) {
  return (
    <div style={{ maxWidth: 500 }}>
      <div style={{ marginBottom: 20 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>
          Client <span style={{ color: 'red' }}>*</span>
        </Text>
        {clientsLoading ? (
          <Skeleton.Input active style={{ width: '100%' }} />
        ) : (
          <Select
            style={{ width: '100%' }}
            placeholder="Select a client"
            value={clientId ?? undefined}
            onChange={(val) => onClientChange(val ?? null)}
            showSearch
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={clients.map((c) => ({ value: String(c.id), label: c.name }))}
          />
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>
          Capability
        </Text>
        {capsLoading && clientId ? (
          <Skeleton.Input active style={{ width: '100%' }} />
        ) : (
          <Select
            style={{ width: '100%' }}
            placeholder={clientId ? 'Select a capability' : 'Select a client first'}
            value={capabilityId ?? undefined}
            onChange={(val) => onCapabilityChange(val ?? null)}
            disabled={!clientId}
            showSearch
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={(capabilities ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
          />
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>
          Fiscal Year
        </Text>
        <Input
          value={fiscalYear}
          onChange={(e) => onFiscalYearChange(e.target.value)}
          style={{ width: 120 }}
          placeholder="FY27"
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>
          Strategy Name <span style={{ color: 'red' }}>*</span>
        </Text>
        <Input
          value={strategyName}
          onChange={(e) => onStrategyNameChange(e.target.value)}
          placeholder="e.g. FY27 Radar System Strategy"
          style={{ width: '100%' }}
        />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          Auto-generated from capability, edit freely.
        </Text>
      </div>
    </div>
  );
}

// ─── Step 2: Submissions ────────────────────────────────────────────────────

interface StepSubmissionsProps {
  selectedSubmissions: string[];
  onToggle: (key: string) => void;
}

function StepSubmissions({ selectedSubmissions, onToggle }: StepSubmissionsProps) {
  return (
    <div style={{ maxWidth: 640 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
        Select the submission types for this strategy. Supporting documents are automatically
        suggested based on your selections.
      </Text>
      {SUBMISSION_GROUPS.map((group) => (
        <div key={group.category} style={{ marginBottom: 24 }}>
          <Text strong style={{ display: 'block', marginBottom: 10, textTransform: 'uppercase', fontSize: 11, letterSpacing: 1, color: '#888' }}>
            {group.label}
          </Text>
          <div className="strategy-submission-grid">
            {group.items.map((item) => (
              <div key={item.key} className="strategy-submission-item" style={{ marginBottom: 8 }}>
                <Checkbox
                  checked={selectedSubmissions.includes(item.key)}
                  onChange={() => onToggle(item.key)}
                >
                  <Tag color={
                    item.cat === 'authorization' ? 'geekblue' :
                    item.cat === 'appropriations' ? 'blue' :
                    item.cat === 'language' ? 'purple' : 'cyan'
                  } style={{ marginRight: 8 }}>
                    {item.shortLabel}
                  </Tag>
                  {item.label}
                </Checkbox>
              </div>
            ))}
          </div>
          <Divider style={{ margin: '12px 0' }} />
        </div>
      ))}
      <Text type="secondary">
        {selectedSubmissions.length} submission type{selectedSubmissions.length !== 1 ? 's' : ''} selected
      </Text>
    </div>
  );
}

// ─── Step 3: Target Members ─────────────────────────────────────────────────

interface StepTargetsProps {
  dirSearchQ: string;
  dirResults: DirectoryApiResponse | undefined;
  dirFetching: boolean;
  targets: DraftTarget[];
  onSearchChange: (q: string) => void;
  onAddTarget: (entry: DirectoryEntry) => void;
  onRemoveTarget: (directoryId: string) => void;
  onUpdateTarget: (directoryId: string, field: 'stafferName' | 'stafferEmail', value: string) => void;
}

function StepTargets({
  dirSearchQ,
  dirResults,
  dirFetching,
  targets,
  onSearchChange,
  onAddTarget,
  onRemoveTarget,
  onUpdateTarget,
}: StepTargetsProps) {
  const entries: DirectoryEntry[] = (dirResults as any)?.data ?? (dirResults as any)?.contacts ?? (Array.isArray(dirResults) ? dirResults : []);
  const alreadyAdded = new Set(targets.map((t) => t.directoryId));

  return (
    <div style={{ maxWidth: 800 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Search for congressional members or staffers to add as targets. This step is optional.
      </Text>

      <Input
        prefix={<SearchOutlined />}
        placeholder="Search members, committees, or staffers..."
        value={dirSearchQ}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 400 }}
      />

      {dirFetching && <Skeleton active paragraph={{ rows: 3 }} style={{ marginBottom: 16 }} />}

      {!dirFetching && dirSearchQ.length >= 2 && entries.length === 0 && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          No results found.
        </Text>
      )}

      {entries.length > 0 && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 24 }}>
          {entries.map((entry) => {
            const id = String(entry.id);
            const added = alreadyAdded.has(id);
            return (
              <div
                key={id}
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #f5f5f5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
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
                  type={added ? 'default' : 'primary'}
                  disabled={added}
                  icon={<PlusOutlined />}
                  onClick={() => onAddTarget(entry)}
                >
                  {added ? 'Added' : 'Add'}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {targets.length > 0 && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 12 }}>
            Selected Targets ({targets.length})
          </Text>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f0f0f0', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: '#666', fontSize: 12 }}>Member</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: '#666', fontSize: 12 }}>Committee</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: '#666', fontSize: 12 }}>Staffer Name</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: '#666', fontSize: 12 }}>Staffer Email</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: '#666', fontSize: 12 }}></th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <tr key={target.directoryId} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <Text strong>{target.memberName}</Text>
                    {target.memberParty && target.memberState && (
                      <Tag style={{ marginLeft: 6 }}>
                        {target.memberParty}-{target.memberState}
                      </Tag>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <Text type="secondary">{target.committee ?? '-'}</Text>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <Input
                      size="small"
                      placeholder="Staffer name"
                      value={target.stafferName}
                      onChange={(e) => onUpdateTarget(target.directoryId, 'stafferName', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <Input
                      size="small"
                      placeholder="Staffer email"
                      value={target.stafferEmail}
                      onChange={(e) => onUpdateTarget(target.directoryId, 'stafferEmail', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onRemoveTarget(target.directoryId)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {targets.length === 0 && dirSearchQ.length < 2 && (
        <Text type="secondary">
          Search above to find and add congressional contacts as targets.
        </Text>
      )}
    </div>
  );
}

// ─── Step 4: Review ─────────────────────────────────────────────────────────

interface StepReviewProps {
  strategyName: string;
  clientName: string;
  capabilityName: string;
  fiscalYear: string;
  selectedSubmissions: string[];
  targets: DraftTarget[];
}

function StepReview({
  strategyName,
  clientName,
  capabilityName,
  fiscalYear,
  selectedSubmissions,
  targets,
}: StepReviewProps) {
  return (
    <div style={{ maxWidth: 600 }}>
      <div
        style={{
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 24,
        }}
      >
        <Title level={5} style={{ marginBottom: 16 }}>
          Strategy Summary
        </Title>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 0' }}>
          <Text type="secondary">Name</Text>
          <Text strong>{strategyName}</Text>
          <Text type="secondary">Client</Text>
          <Text>{clientName}</Text>
          <Text type="secondary">Capability</Text>
          <Text>{capabilityName || '-'}</Text>
          <Text type="secondary">Fiscal Year</Text>
          <Tag color="geekblue" style={{ width: 'fit-content' }}>{fiscalYear}</Tag>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Text strong style={{ display: 'block', marginBottom: 10 }}>
          Submissions ({selectedSubmissions.length})
        </Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {selectedSubmissions.map((key) => {
            const item = ALL_SUBMISSION_ITEMS.find((i) => i.key === key);
            return item ? (
              <Tag
                key={key}
                color={
                  item.cat === 'authorization' ? 'geekblue' :
                  item.cat === 'appropriations' ? 'blue' :
                  item.cat === 'language' ? 'purple' : 'cyan'
                }
              >
                {item.shortLabel}, {item.label}
              </Tag>
            ) : null;
          })}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Text strong style={{ display: 'block', marginBottom: 10 }}>
          Targets ({targets.length})
        </Text>
        {targets.length === 0 ? (
          <Text type="secondary">No targets added.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {targets.map((t) => (
              <div key={t.directoryId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text>{t.memberName}</Text>
                {t.memberParty && t.memberState && (
                  <Tag>{t.memberParty}-{t.memberState}</Tag>
                )}
                {t.committee && <Text type="secondary">· {t.committee}</Text>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          background: '#e6f4ff',
          border: '1px solid #91caff',
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          gap: 24,
        }}
      >
        <div>
          <Text strong style={{ fontSize: 20 }}>{selectedSubmissions.length}</Text>
          <Text type="secondary" style={{ marginLeft: 6 }}>submissions</Text>
        </div>
        <div>
          <Text strong style={{ fontSize: 20 }}>{targets.length}</Text>
          <Text type="secondary" style={{ marginLeft: 6 }}>targets</Text>
        </div>
      </div>
    </div>
  );
}
