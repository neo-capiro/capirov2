import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import {
  CAPABILITY_TAG_SUGGESTIONS,
  SECTOR_LABELS,
  SECTOR_TAGS,
  SUBMISSION_TRACK_LABELS,
  normalizeSector,
  type SectorTag,
  type SubmissionTrack,
} from '@capiro/shared';
import type { Capability } from './CapabilityDrawer.js';
import { CapabilityDrawer } from './CapabilityDrawer.js';
import type { Client, ClientAttachment, ClientFormSubmit } from './clientTypes.js';
import { IntelligenceTab } from './IntelligenceTab.js';

interface WorkflowInstance {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  template?: { name: string; category: string };
}

interface ClientPerson {
  id: string;
  clientId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  lastContact: string | null;
  notes: string | null;
  createdAt: string;
}

type ProfileTab = 'overview' | 'capabilities' | 'people' | 'workflows' | 'documents' | 'intelligence';

const STATUS_COLOR: Record<string, string> = {
  active: '#52c41a',
  inactive: '#faad14',
  archived: '#8c8c8c',
};

const WORKFLOW_STATUS_COLORS: Record<string, string> = {
  triage: 'orange',
  in_progress: 'blue',
  review: 'purple',
  submitted: 'cyan',
  complete: 'green',
  cancelled: 'default',
};

interface Props {
  client: Client;
  canManageClients: boolean;
  canRemoveClients: boolean;
  onBack: () => void;
  onEdit: (client: Client) => void;
  onRemove: (client: Client) => void;
  onUploadLogo: (client: Client, file: File) => Promise<void>;
  onClientUpdated: () => void;
}

export function ClientProfilePage({
  client,
  canManageClients,
  canRemoveClients,
  onBack,
  onEdit,
  onRemove,
  onUploadLogo,
  onClientUpdated,
}: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [selectedCapability, setSelectedCapability] = useState<Capability | null>(null);
  const [addCapabilityOpen, setAddCapabilityOpen] = useState(false);
  const [addPersonOpen, setAddPersonOpen] = useState(false);

  const capabilities = useQuery<Capability[]>({
    queryKey: ['client-capabilities', client.id],
    queryFn: async () =>
      (await api.get<Capability[]>(`/api/clients/${client.id}/capabilities`)).data,
  });

  const people = useQuery<ClientPerson[]>({
    queryKey: ['client-people', client.id],
    queryFn: async () =>
      (await api.get<ClientPerson[]>(`/api/clients/${client.id}/people`)).data,
    // Eager-load for tab badge counts; cheap query and lets the tab strip
    // show "(N)" without waiting for the user to click in.
  });

  const workflows = useQuery<WorkflowInstance[]>({
    queryKey: ['workflow-instances', { clientId: client.id }],
    queryFn: async () =>
      (
        await api.get<WorkflowInstance[]>('/api/workflows/instances', {
          params: { clientId: client.id },
        })
      ).data,
  });

  const docsCount = useQuery<{ id: string }[]>({
    queryKey: ['client-attachments-count', client.id],
    queryFn: async () =>
      (
        await api.get<{ id: string }[]>('/api/engagement/attachments', {
          params: { clientId: client.id },
        })
      ).data,
    staleTime: 60_000,
  });

  const createCapability = useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await api.post(`/api/clients/${client.id}/capabilities`, data)).data,
    onSuccess: () => {
      message.success('Capability added');
      setAddCapabilityOpen(false);
      qc.invalidateQueries({ queryKey: ['client-capabilities', client.id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const deleteCapability = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/clients/${client.id}/capabilities/${id}`)).data,
    onSuccess: () => {
      message.success('Capability removed');
      if (selectedCapability) setSelectedCapability(null);
      qc.invalidateQueries({ queryKey: ['client-capabilities', client.id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const createPerson = useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await api.post(`/api/clients/${client.id}/people`, data)).data,
    onSuccess: () => {
      message.success('Person added');
      setAddPersonOpen(false);
      qc.invalidateQueries({ queryKey: ['client-people', client.id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const deletePerson = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/clients/${client.id}/people/${id}`)).data,
    onSuccess: () => {
      message.success('Person removed');
      qc.invalidateQueries({ queryKey: ['client-people', client.id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const intake = toRecord(client.intakeData);
  const tags = portfolioTags(client);

  return (
    <div
      className="redesign"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg-canvas)' }}
    >
      <h1 className="cp-page-title">Portfolio</h1>

      {/* Banner */}
      <div className="cp-banner">
        <button className="cp-back" onClick={onBack} aria-label="Back to clients">
          <ArrowLeftOutlined style={{ fontSize: 13 }} />
        </button>

        <div className="cp-logo">
          {client.logoUrl ? (
            <img src={client.logoUrl} alt={client.name} />
          ) : (
            initials(client.name)
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cp-name">{client.name}</div>
          <div className="cp-meta">
            {client.website ? (
              <a
                href={externalUrl(client.website)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <LinkOutlined /> {client.website}
              </a>
            ) : null}
            {client.primaryContactName ? <span>{client.primaryContactName}</span> : null}
            {client.primaryContactEmail ? (
              <a href={`mailto:${client.primaryContactEmail}`}>
                <MailOutlined /> {client.primaryContactEmail}
              </a>
            ) : null}
            {client.primaryContactPhone ? (
              <a href={`tel:${client.primaryContactPhone.replace(/[^\d+]/g, '')}`}>
                <PhoneOutlined /> {client.primaryContactPhone}
              </a>
            ) : null}
          </div>
          {tags.length ? (
            <div className="cp-tag-row">
              {tags.slice(0, 5).map((tag) => (
                <span key={tag} className="cp-tag">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="cp-actions">
          <Upload
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              if ((file as File).size > 2 * 1024 * 1024) {
                void message.error('Logo must be 2 MB or smaller.');
                return Upload.LIST_IGNORE;
              }
              void onUploadLogo(client, file as File).then(() => onClientUpdated());
              return false;
            }}
          >
            <Tooltip title="PNG, JPG, SVG or WebP. Max 2 MB.">
              <Button
                size="small"
                icon={<UploadOutlined />}
                style={{
                  borderColor: 'rgba(255,255,255,.25)',
                  color: 'rgba(255,255,255,.8)',
                  background: 'transparent',
                }}
              >
                Logo
              </Button>
            </Tooltip>
          </Upload>
          <Button
            size="small"
            disabled={!canManageClients}
            onClick={() => onEdit(client)}
            style={{
              borderColor: 'rgba(255,255,255,.25)',
              color: 'rgba(255,255,255,.8)',
              background: 'transparent',
            }}
          >
            Edit
          </Button>
          {canRemoveClients ? (
            <Button
              size="small"
              onClick={() => onRemove(client)}
              style={{
                borderColor: 'rgba(255,100,100,.4)',
                color: '#ff7875',
                background: 'transparent',
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {/* Tab nav */}
      <div className="cp-tabs">
        {(['overview', 'capabilities', 'people', 'workflows', 'documents', 'intelligence'] as ProfileTab[]).map((tab) => {
          const badge =
            tab === 'capabilities'
              ? capabilities.data?.length
              : tab === 'people'
                ? people.data?.length
                : tab === 'workflows'
                  ? workflows.data?.length
                  : tab === 'documents'
                    ? docsCount.data?.length
                    : null;
          return (
            <div
              key={tab}
              className={`cp-tab${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
              role="tab"
            >
              <span>
                {tab === 'overview'
                  ? 'Overview'
                  : tab === 'capabilities'
                    ? 'Capabilities'
                    : tab === 'people'
                      ? 'People'
                      : tab === 'workflows'
                        ? 'Workflows'
                        : tab === 'documents'
                          ? 'Documents'
                          : 'Intelligence'}
              </span>
              {badge != null && badge > 0 ? (
                <span className="cp-tab-badge num">{badge}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className="cp-body">
        <div
          className="cp-content"
          style={selectedCapability ? { flex: 1, overflowY: 'auto' } : {}}
        >
          {activeTab === 'overview' && (
            <OverviewTab
              client={client}
              intake={intake}
              capabilities={capabilities.data ?? []}
              capsLoading={capabilities.isLoading}
              people={people.data ?? []}
              peopleLoading={people.isLoading}
              onViewAllCaps={() => setActiveTab('capabilities')}
              onViewAllPeople={() => setActiveTab('people')}
              onCapClick={setSelectedCapability}
              onAddCap={() => setAddCapabilityOpen(true)}
            />
          )}
          {activeTab === 'capabilities' && (
            <CapabilitiesTab
              clientId={client.id}
              capabilities={capabilities.data ?? []}
              loading={capabilities.isLoading}
              onCapClick={setSelectedCapability}
              onAddCap={() => setAddCapabilityOpen(true)}
              onDeleteCap={(id) => {
                modal.confirm({
                  title: 'Remove this capability?',
                  content: 'This will also remove all submission history for this capability.',
                  okText: 'Remove',
                  okButtonProps: { danger: true },
                  onOk: () => deleteCapability.mutateAsync(id),
                });
              }}
            />
          )}
          {activeTab === 'people' && (
            <PeopleTab
              people={people.data ?? []}
              loading={people.isLoading}
              onAddPerson={() => setAddPersonOpen(true)}
              onDeletePerson={(id) => {
                modal.confirm({
                  title: 'Remove this person?',
                  okText: 'Remove',
                  okButtonProps: { danger: true },
                  onOk: () => deletePerson.mutateAsync(id),
                });
              }}
            />
          )}
          {activeTab === 'workflows' && (
            <WorkflowsTab workflows={workflows.data ?? []} loading={workflows.isLoading} />
          )}
          {activeTab === 'documents' && (
            <DocumentsTab
              client={client}
              canManage={canManageClients}
              onClientUpdated={onClientUpdated}
            />
          )}
          {activeTab === 'intelligence' && (
            <IntelligenceTab clientId={client.id} clientName={client.name} />
          )}
        </div>

        {selectedCapability ? (
          <CapabilityDrawer
            capability={selectedCapability}
            clientId={client.id}
            onClose={() => setSelectedCapability(null)}
            onUpdated={() => {
              qc.invalidateQueries({ queryKey: ['client-capabilities', client.id] });
            }}
          />
        ) : null}
      </div>

      <AddCapabilityModal
        open={addCapabilityOpen}
        onCancel={() => setAddCapabilityOpen(false)}
        onSubmit={(data) => createCapability.mutate(data)}
        submitting={createCapability.isPending}
      />

      <AddPersonModal
        open={addPersonOpen}
        onCancel={() => setAddPersonOpen(false)}
        onSubmit={(data) => createPerson.mutate(data)}
        submitting={createPerson.isPending}
      />
    </div>
  );
}

/* ── Overview Tab ────────────────────────────────────────────────────────── */

function OverviewTab({
  client,
  intake,
  capabilities,
  capsLoading,
  people,
  peopleLoading,
  onViewAllCaps,
  onViewAllPeople,
  onCapClick,
  onAddCap,
}: {
  client: Client;
  intake: Record<string, unknown>;
  capabilities: Capability[];
  capsLoading: boolean;
  people: ClientPerson[];
  peopleLoading: boolean;
  onViewAllCaps: () => void;
  onViewAllPeople: () => void;
  onCapClick: (c: Capability) => void;
  onAddCap: () => void;
}) {
  const api = useApi();
  const cageCode = readText(intake, ['cageCode', 'cage_code']);
  const uei = readText(intake, ['uei']);
  const primaryNaics = readText(intake, ['primaryNaics', 'primary_naics', 'naics']);
  const samStatus = readText(intake, ['samStatus', 'sam_status']);
  const existingContracts = readText(intake, ['existingContracts', 'existing_contracts']);

  const sectorLabel = sectorLabelFor(client) ?? readText(intake, ['sector']);
  const submissionTracks = (client.submissionTracks ?? []).map(
    (t) => SUBMISSION_TRACK_LABELS[t as SubmissionTrack] ?? t,
  );

  // Engagement snapshot — uses existing endpoints; falls back to 0/— if any
  // single endpoint is unavailable so the card always renders.
  const trackedBills = useQuery<{ total: number } | null>({
    queryKey: ['tracked-bills', client.id, 'overview'],
    queryFn: async () => {
      try {
        return (
          await api.get<{ total: number }>(`/api/intelligence/clients/${client.id}/tracked-bills`)
        ).data;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  const profile = useQuery<{ lda?: { totalSpending: number | null } } | null>({
    queryKey: ['client-intel-profile', client.id, 'overview'],
    queryFn: async () => {
      try {
        return (await api.get<{ lda?: { totalSpending: number | null } }>(
          `/api/intelligence/client-profile/${client.id}`,
        )).data;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  // Engagement snapshot card advertises "last 90 days" — pass `from` so the
  // count actually reflects that window instead of all-time.
  const meetingsFromIso = useMemo(
    () => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );
  const meetings = useQuery<unknown[]>({
    queryKey: ['client-meetings', client.id, meetingsFromIso],
    queryFn: async () => {
      try {
        return (
          await api.get<unknown[]>('/api/engagement/meetings', {
            params: { clientId: client.id, from: meetingsFromIso },
          })
        ).data;
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });
  const commentAlerts = useQuery<{ alerts: Array<{ clientId: string; daysToDeadline: number }> }>({
    queryKey: ['comment-alerts'],
    queryFn: async () => {
      try {
        return (
          await api.get<{ alerts: Array<{ clientId: string; daysToDeadline: number }> }>(
            '/api/intelligence/comment-alerts',
          )
        ).data;
      } catch {
        return { alerts: [] };
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const activeDeadlines = (commentAlerts.data?.alerts ?? []).filter((a) => a.clientId === client.id);

  const snapshotCells: Array<{
    label: string;
    value: string;
    detail: string;
    tone?: 'critical' | 'info' | 'notable';
  }> = [
    {
      label: 'Meetings',
      value: String(meetings.data?.length ?? 0),
      detail: 'Last 90 days',
    },
    {
      label: 'Bills tracked',
      value: String(trackedBills.data?.total ?? 0),
      detail: 'Via LDA issue codes',
      tone: 'info',
    },
    {
      label: 'Active deadlines',
      value: String(activeDeadlines.length),
      detail:
        activeDeadlines.length > 0
          ? `${activeDeadlines.filter((a) => a.daysToDeadline < 7).length} this week`
          : 'None in next 14 days',
      tone: activeDeadlines.length > 0 ? 'critical' : undefined,
    },
    {
      label: 'LDA spend (LTM)',
      value: profile.data?.lda?.totalSpending
        ? formatCompactDollars(profile.data.lda.totalSpending)
        : '$0',
      detail: profile.data?.lda?.totalSpending ? 'From confirmed mapping' : 'No LDA mapping',
    },
  ];

  return (
    <div className="overview-grid">
      <div>
        {/* Engagement snapshot — last 90 days */}
        <section className="surface" style={{ marginBottom: 14 }}>
          <header className="surface-head">
            <h3>Engagement snapshot</h3>
            <span className="sub">last 90 days</span>
          </header>
          <div className="snapshot-grid">
            {snapshotCells.map((s) => (
              <div className="snapshot-cell" key={s.label}>
                <div className="snapshot-label">{s.label}</div>
                <div
                  className="snapshot-value num"
                  style={
                    s.tone === 'critical'
                      ? { color: 'var(--critical)' }
                      : s.tone === 'info'
                        ? { color: 'var(--info)' }
                        : s.tone === 'notable'
                          ? { color: 'var(--notable)' }
                          : undefined
                  }
                >
                  {s.value}
                </div>
                <div className="snapshot-detail">{s.detail}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Company information */}
        <section className="surface">
          <header className="surface-head">
            <h3>Company information</h3>
          </header>
          <div className="info-table">
            <InfoRow label="Name" value={<span style={{ fontWeight: 600 }}>{client.name}</span>} />
            <InfoRow
              label="Website"
              value={
                client.website ? (
                  <a
                    href={externalUrl(client.website)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--info)' }}
                  >
                    {client.website}
                  </a>
                ) : null
              }
            />
            <InfoRow label="Description" value={client.description} />
            <InfoRow
              label="Sector"
              value={
                sectorLabel ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span
                      className="tag-chip"
                      style={{
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-ink)',
                        borderColor: 'transparent',
                        fontWeight: 600,
                      }}
                    >
                      {sectorLabel}
                    </span>
                  </span>
                ) : null
              }
            />
            <InfoRow
              label="Submission tracks"
              value={
                submissionTracks.length ? (
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {submissionTracks.map((t) => (
                      <span key={t} className="tag-chip">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : null
              }
            />
            <InfoRow label="Product / Service" value={client.productDescription} />
            <InfoRow
              label="Engagement"
              value={
                <span>
                  <span style={{ color: STATUS_COLOR[client.status] ?? '#8c8c8c', fontWeight: 600 }}>
                    {titleCase(client.status)}
                  </span>
                  {' · since '}
                  {formatDate(client.createdAt)}
                </span>
              }
            />
          </div>
        </section>

        {/* Government Registration — only show if any field is populated */}
        {cageCode || uei || primaryNaics || samStatus || existingContracts ? (
          <section className="surface" style={{ marginTop: 14 }}>
            <header className="surface-head">
              <h3>Government registration</h3>
            </header>
            <div className="info-table">
              <InfoRow label="CAGE Code" value={cageCode} />
              <InfoRow label="UEI (SAM)" value={uei} />
              <InfoRow label="Primary NAICS" value={primaryNaics} />
              <InfoRow label="SAM Status" value={samStatus} />
              <InfoRow label="Existing Contracts" value={existingContracts} />
            </div>
          </section>
        ) : null}
      </div>

      <div>
        {/* Capabilities preview */}
        <section className="surface">
          <header className="surface-head">
            <h3>Capabilities</h3>
            <span className="sub">{capabilities.length} total</span>
            <button className="surface-link" onClick={onViewAllCaps} type="button">
              View all →
            </button>
          </header>
          <div style={{ padding: 4 }}>
            {capsLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : capabilities.length === 0 ? (
              <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-3)' }}>
                No capabilities yet.
              </div>
            ) : (
              capabilities.slice(0, 4).map((cap) => (
                <button
                  type="button"
                  key={cap.id}
                  onClick={() => onCapClick(cap)}
                  className="overview-cap-row"
                >
                  <span className="overview-cap-name">{cap.name}</span>
                  <span className="overview-cap-meta">
                    {cap.type ? (
                      <span className={`cap-pill ${cap.type.toLowerCase()}`}>{cap.type}</span>
                    ) : null}
                    {cap.sector ? <span className="cap-sector">{cap.sector}</span> : null}
                  </span>
                  <span className="overview-cap-trl num">
                    {cap.trl != null ? `TRL ${cap.trl}` : '—'}
                    {cap.mrl != null ? ` · MRL ${cap.mrl}` : ''}
                  </span>
                </button>
              ))
            )}
          </div>
          <button className="she-add-btn" onClick={onAddCap} style={{ margin: '4px 14px 14px' }}>
            <PlusOutlined /> Add capability
          </button>
        </section>

        {/* Primary contacts preview */}
        <section className="surface" style={{ marginTop: 14 }}>
          <header className="surface-head">
            <h3>Primary contacts</h3>
            {people.length > 0 ? <span className="sub">{people.length} total</span> : null}
            {people.length > 0 ? (
              <button className="surface-link" onClick={onViewAllPeople} type="button">
                View all →
              </button>
            ) : null}
          </header>
          <div style={{ padding: '6px 14px 14px' }}>
            {peopleLoading ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : people.length === 0 ? (
              <div style={{ padding: '20px 0', fontSize: 12, color: 'var(--ink-3)' }}>
                No people added yet.
              </div>
            ) : (
              people.slice(0, 3).map((p) => (
                <div key={p.id} className="overview-person-row">
                  <span className="overview-person-avatar" style={{ background: avatarColor(p.id) }}>
                    {personInitials(p.name)}
                  </span>
                  <span className="overview-person-text">
                    <span className="overview-person-name">{p.name}</span>
                    {p.title ? <span className="overview-person-title">{p.title}</span> : null}
                  </span>
                  {p.role ? <PersonRoleTag role={p.role} /> : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="info-row">
      <span className="k">{label}</span>
      <span className={`v${empty ? ' muted' : ''}`}>{empty ? '—' : value}</span>
    </div>
  );
}

function PersonRoleTag({ role }: { role: string }) {
  const lower = role.toLowerCase();
  const isPoc = lower.includes('primary') || lower.includes('poc');
  const isExec = lower.includes('exec') || lower.includes('ceo') || lower.includes('cfo') || lower.includes('president');
  const bg = isPoc ? 'var(--accent-soft)' : isExec ? 'var(--notable-soft)' : 'var(--bg-sunken)';
  const color = isPoc ? 'var(--accent-ink)' : isExec ? 'var(--notable)' : 'var(--ink-2)';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        padding: '3px 8px',
        borderRadius: 4,
        background: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {role}
    </span>
  );
}

function personInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

const AVATAR_PALETTE = ['#5e7ce2', '#7a3fb5', '#c98a1d', '#2e6b43', '#b5301b', '#1a3f9f', '#3a7a4d'];
function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0]!;
}

function formatCompactDollars(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/* ── Capabilities Tab ────────────────────────────────────────────────────── */

function CapabilitiesTab({
  clientId,
  capabilities,
  loading,
  onCapClick,
  onAddCap,
  onDeleteCap,
}: {
  clientId: string;
  capabilities: Capability[];
  loading: boolean;
  onCapClick: (c: Capability) => void;
  onAddCap: () => void;
  onDeleteCap: (id: string) => void;
}) {
  const navigate = useNavigate();
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} />;

  return (
    <>
      <header className="cp-tab-header">
        <div>
          <h3 className="cp-tab-h3">Capabilities</h3>
          <p className="cp-tab-dek">
            Products, services, technologies, and programs — with full submission history per
            capability.
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} size="small" onClick={onAddCap}>
          Add capability
        </Button>
      </header>

      {capabilities.length ? (
        capabilities.map((cap) => (
          <div key={cap.id} style={{ position: 'relative', marginBottom: 8 }}>
            <CapabilityCard cap={cap} onClick={() => onCapClick(cap)} large />
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                display: 'flex',
                gap: 6,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                size="small"
                type="default"
                onClick={() =>
                  navigate(
                    `/workspace/strategy/new?clientId=${encodeURIComponent(clientId)}&capabilityId=${encodeURIComponent(cap.id)}`,
                  )
                }
              >
                Start FY Strategy
              </Button>
              <Button
                size="small"
                type="text"
                icon={<DeleteOutlined />}
                danger
                onClick={() => onDeleteCap(cap.id)}
              />
            </div>
          </div>
        ))
      ) : (
        <div className="cp-tab-empty">
          <Empty description="No capabilities yet." />
          <Button type="primary" icon={<PlusOutlined />} onClick={onAddCap}>
            Add capability
          </Button>
        </div>
      )}
    </>
  );
}

/* ── People Tab ─────────────────────────────────────────────────────────── */

function PeopleTab({
  people,
  loading,
  onAddPerson,
  onDeletePerson,
}: {
  people: ClientPerson[];
  loading: boolean;
  onAddPerson: () => void;
  onDeletePerson: (id: string) => void;
}) {
  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;

  return (
    <>
      <header className="cp-tab-header">
        <div>
          <h3 className="cp-tab-h3">People</h3>
          <p className="cp-tab-dek">
            Key contacts at this client — executives, government affairs, compliance, and
            operational POCs.
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} size="small" onClick={onAddPerson}>
          Add person
        </Button>
      </header>

      {people.length ? (
        <div className="cp-people-grid">
          {people.map((person) => (
            <PersonCard key={person.id} person={person} onDelete={() => onDeletePerson(person.id)} />
          ))}
        </div>
      ) : (
        <div className="cp-tab-empty">
          <Empty description="No people added yet." />
          <Button type="primary" icon={<PlusOutlined />} onClick={onAddPerson}>
            Add person
          </Button>
        </div>
      )}
    </>
  );
}

/* ── Workflows Tab ──────────────────────────────────────────────────────── */

function WorkflowsTab({
  workflows,
  loading,
}: {
  workflows: WorkflowInstance[];
  loading: boolean;
}) {
  if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;

  // Group workflow statuses into 3 spec columns. The backend has more granular
  // statuses (triage, in_progress, review, submitted, complete, cancelled);
  // we collapse review+submitted into "In Progress" and complete+cancelled
  // into "Done" so the column count matches the spec.
  const cols: Array<{ key: 'triage' | 'in-progress' | 'done'; title: string; statuses: string[] }> = [
    { key: 'triage', title: 'Triage', statuses: ['triage'] },
    { key: 'in-progress', title: 'In Progress', statuses: ['in_progress', 'review', 'submitted'] },
    { key: 'done', title: 'Done', statuses: ['complete', 'cancelled'] },
  ];

  const grouped = new Map<string, WorkflowInstance[]>();
  for (const c of cols) grouped.set(c.key, []);
  for (const wf of workflows) {
    const col = cols.find((c) => c.statuses.includes(wf.status))?.key ?? 'triage';
    grouped.get(col)!.push(wf);
  }

  return (
    <>
      <header className="cp-tab-header">
        <div>
          <h3 className="cp-tab-h3">Workflows</h3>
          <p className="cp-tab-dek">
            Active engagement work — drafts, requests, outreach, intel runs. Status moves the card.
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} size="small" disabled>
          New workflow
        </Button>
      </header>

      <div className="kanban">
        {cols.map((col) => {
          const cards = grouped.get(col.key) ?? [];
          return (
            <div key={col.key} className="kb-col" data-status={col.key}>
              <div className="kb-col-head">
                <span className="kb-col-dot" aria-hidden />
                <span className="kb-col-title">{col.title}</span>
                <span className="kb-col-count num">{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <div className="kb-col-empty">Nothing here yet</div>
              ) : (
                cards.map((wf) => {
                  const category = (wf.template?.category ?? 'supporting').toLowerCase();
                  return (
                    <div className="kb-card" key={wf.id} data-cat={category}>
                      <span className="cat">{wf.template?.category ?? 'Workflow'}</span>
                      <div className="title">{wf.title}</div>
                      <div className="foot">
                        <span className="num">{formatDate(wf.createdAt)}</span>
                        <span className="owner">{wf.title.charAt(0).toUpperCase()}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Documents Tab ──────────────────────────────────────────────────────── */

function DocumentsTab({
  client,
  canManage,
  onClientUpdated,
}: {
  client: Client;
  canManage: boolean;
  onClientUpdated: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState(() => {
    const v = toRecord(client.intakeData)['profileNotes'];
    return typeof v === 'string' ? v : '';
  });
  const [notesDirty, setNotesDirty] = useState(false);

  const docs = useQuery<ClientAttachment[]>({
    queryKey: ['client-attachments', client.id],
    queryFn: async () =>
      (
        await api.get<ClientAttachment[]>('/api/engagement/attachments', {
          params: { clientId: client.id },
        })
      ).data,
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/engagement/attachments/${id}`)).data,
    onSuccess: () => {
      message.success('Document removed');
      qc.invalidateQueries({ queryKey: ['client-attachments', client.id] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const saveNotes = useMutation({
    mutationFn: async (value: string) =>
      (
        await api.put(`/api/clients/${client.id}`, {
          intakeData: { ...toRecord(client.intakeData), profileNotes: value },
        })
      ).data,
    onSuccess: () => {
      message.success('Notes saved');
      setNotesDirty(false);
      onClientUpdated();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    if (!fileArr.length) return;
    setUploading(true);
    try {
      for (const file of fileArr) {
        const contentType = file.type || 'application/octet-stream';
        const presigned = (
          await api.post<{ url: string; fields: Record<string, string>; s3Key: string }>(
            '/api/engagement/attachments/upload-url',
            { clientId: client.id, fileName: file.name, contentType, contentLength: file.size },
          )
        ).data;
        const form = new FormData();
        for (const [k, v] of Object.entries(presigned.fields)) form.append(k, v);
        form.append('file', file);
        const res = await fetch(presigned.url, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
        await api.post('/api/engagement/attachments/confirm', {
          clientId: client.id,
          fileName: file.name,
          contentType,
          s3Key: presigned.s3Key,
        });
      }
      message.success(
        fileArr.length === 1 ? 'Document uploaded' : `${fileArr.length} documents uploaded`,
      );
      qc.invalidateQueries({ queryKey: ['client-attachments', client.id] });
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.txt,image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
        }}
      />

      <header className="cp-tab-header">
        <div>
          <h3 className="cp-tab-h3">Documents</h3>
          <p className="cp-tab-dek">
            Capiro auto-parses every upload and routes findings into the Intelligence tab.
          </p>
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {docs.data?.length ?? 0} file{(docs.data?.length ?? 0) === 1 ? '' : 's'}
        </span>
      </header>

      <div
        className={`doc-drop-zone${dragging ? ' dragging' : ''}`}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files);
        }}
      >
        {uploading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Spin size="small" />
            <span>Uploading…</span>
          </div>
        ) : (
          <>
            <div className="doc-drop-zone-icon">
              <CloudUploadOutlined />
            </div>
            <div style={{ fontFamily: 'var(--font-sans-rd)' }}>
              Drop files here or{' '}
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>click to upload</span>
            </div>
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--ink-3)' }}>
              PDF, DOC, DOCX, TXT, images · max 25 MB each
            </div>
          </>
        )}
      </div>

      {docs.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : docs.data?.length ? (
        <div className="doc-list">
          {docs.data.map((doc) => {
            const { bg, fg } = docColors(doc.contentType, doc.fileName);
            return (
              <div className="doc-item" key={doc.id}>
                <div className="doc-icon" style={{ background: bg, color: fg }}>
                  {docIcon(doc.contentType, doc.fileName)}
                </div>
                <div className="doc-info">
                  <div className="doc-name" title={doc.fileName}>
                    {doc.fileName}
                  </div>
                  <div className="doc-meta">
                    {formatDate(doc.createdAt)}
                    {doc.byteSize != null ? ` · ${formatBytes(doc.byteSize)}` : ''}
                  </div>
                </div>
                <div className="doc-actions">
                  {doc.downloadUrl ? (
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      type="text"
                      href={doc.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                    />
                  ) : null}
                  <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    type="text"
                    danger
                    onClick={() => {
                      modal.confirm({
                        title: 'Remove document?',
                        okText: 'Remove',
                        okButtonProps: { danger: true },
                        onOk: () => deleteDoc.mutateAsync(doc.id),
                      });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20, fontSize: 13 }}>
          No documents yet. Upload files above.
        </Typography.Text>
      )}

      <div className="doc-notes-label">Client Notes</div>
      <Input.TextArea
        rows={4}
        placeholder="Add any additional context about this client…"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setNotesDirty(true);
        }}
        disabled={!canManage}
        style={{ marginBottom: 8 }}
      />
      {canManage && notesDirty && (
        <Button
          size="small"
          type="primary"
          loading={saveNotes.isPending}
          onClick={() => saveNotes.mutate(notes)}
        >
          Save notes
        </Button>
      )}
    </div>
  );
}

function docColors(contentType: string, fileName: string): { bg: string; fg: string } {
  if (contentType.startsWith('image/')) return { bg: '#d1fae5', fg: '#065f46' };
  if (contentType === 'application/pdf' || /\.pdf$/i.test(fileName))
    return { bg: '#fee2e2', fg: '#991b1b' };
  if (contentType.includes('word') || /\.docx?$/i.test(fileName))
    return { bg: '#dbeafe', fg: '#1e40af' };
  if (contentType === 'text/plain' || /\.txt$/i.test(fileName))
    return { bg: '#f1f5f9', fg: '#475569' };
  return { bg: '#f2f4f7', fg: '#475467' };
}

function docIcon(contentType: string, fileName: string): ReactNode {
  if (contentType.startsWith('image/')) return <FileImageOutlined />;
  if (contentType === 'application/pdf' || /\.pdf$/i.test(fileName)) return <FilePdfOutlined />;
  if (contentType === 'text/plain' || /\.txt$/i.test(fileName)) return <FileTextOutlined />;
  return <FileOutlined />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Shared sub-components ───────────────────────────────────────────────── */

function CapabilityCard({
  cap,
  onClick,
  large,
}: {
  cap: Capability;
  onClick: () => void;
  large?: boolean;
}) {
  const typeKey = (cap.type ?? 'product').toLowerCase();
  const tags = Array.isArray(cap.tags) ? (cap.tags as string[]) : [];
  const ownerInitial = (cap.peNumber || cap.name || '?')[0]?.toUpperCase() ?? '?';

  return (
    <div className={`cap-card${large ? ' cap-card-large' : ''}`} onClick={onClick}>
      <div className="cap-card-hd">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cap-name" style={large ? { fontSize: 16 } : undefined}>
            {cap.name}
            {large ? <span className={`cap-pill ${typeKey}`}>{cap.type ?? 'Product'}</span> : null}
          </div>
          {!large ? (
            <div className="cap-tags-row">
              <span className={`cap-pill ${typeKey}`} style={{ textTransform: 'capitalize' }}>
                {cap.type}
              </span>
              {cap.sector ? <span className="cap-sector">{cap.sector}</span> : null}
              {tags.slice(0, 2).map((t) => (
                <span key={t} className="cap-sector">
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <div className="cap-sectors">
              {cap.sector ? <span className="cap-sector">{cap.sector}</span> : null}
              {tags.slice(0, 4).map((t) => (
                <span key={t} className="cap-sector">
                  {t}
                </span>
              ))}
            </div>
          )}
          {large && cap.description ? <p className="cap-desc">{cap.description}</p> : null}
          {!large && (cap.trl != null || cap.mrl != null) ? (
            <div className="cap-trl">
              {[cap.trl != null ? `TRL ${cap.trl}` : null, cap.mrl != null ? `MRL ${cap.mrl}` : null]
                .filter(Boolean)
                .join(' · ')}
            </div>
          ) : null}
        </div>
        {!large && cap.fundingAsk != null ? (
          <div className="cap-ask">
            ${(cap.fundingAsk / 1_000_000).toFixed(cap.fundingAsk >= 10_000_000 ? 0 : 1)}M
            {cap.fundingAskLabel ? (
              <div className="cap-ask-label">{cap.fundingAskLabel}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      {large ? (
        <aside className="cap-trl-block">
          <div className="cap-trl-label">Maturity</div>
          <div className="cap-trl-row">
            <span className="cap-trl-key">TRL</span>
            <div className="cap-trl-bar">
              <span style={{ width: `${((cap.trl ?? 0) / 9) * 100}%`, background: 'var(--accent)' }} />
            </div>
            <span className="cap-trl-val num">{cap.trl ?? '—'}/9</span>
          </div>
          <div className="cap-trl-row">
            <span className="cap-trl-key">MRL</span>
            <div className="cap-trl-bar">
              <span style={{ width: `${((cap.mrl ?? 0) / 10) * 100}%`, background: 'var(--notable)' }} />
            </div>
            <span className="cap-trl-val num">{cap.mrl ?? '—'}/10</span>
          </div>
          {cap.fundingAsk != null ? (
            <div className="cap-trl-foot">
              <span className="cap-trl-foot-label">Funding ask</span>
              <span className="cap-trl-foot-value num">
                ${(cap.fundingAsk / 1_000_000).toFixed(cap.fundingAsk >= 10_000_000 ? 0 : 1)}M
              </span>
            </div>
          ) : null}
          <div className="cap-trl-foot" style={{ borderTop: '1px solid var(--border-1)', paddingTop: 10 }}>
            <span className="cap-trl-owner-avatar">{ownerInitial}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Capability owner</span>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function PersonCard({ person, onDelete }: { person: ClientPerson; onDelete: () => void }) {
  const AVATAR_COLORS = [
    '#1a5276', '#1b4fd8', '#6b21a8', '#166534',
    '#0369a1', '#b45309', '#9d174d', '#1d4ed8',
  ];
  const idx = person.name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const avatarColor = AVATAR_COLORS[idx] ?? '#1a5276';

  return (
    <div className="cp-person-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div className="cp-person-avatar" style={{ background: avatarColor }}>
          {initials(person.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong style={{ fontSize: 13, display: 'block' }}>
            {person.name}
          </Typography.Text>
          {person.title ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {person.title}
            </Typography.Text>
          ) : null}
        </div>
        {person.role ? <PersonRoleTag role={person.role} /> : null}
        <Button size="small" type="text" icon={<DeleteOutlined />} danger onClick={onDelete} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          fontSize: 12,
          color: 'var(--ink-2, #595959)',
        }}
      >
        {person.email ? (
          <a
            href={`mailto:${person.email}`}
            style={{ color: 'var(--ink-2, #595959)', textDecoration: 'none' }}
          >
            <MailOutlined style={{ marginRight: 5 }} />
            {person.email}
          </a>
        ) : null}
        {person.phone ? (
          <a
            href={`tel:${person.phone.replace(/[^\d+]/g, '')}`}
            style={{ color: 'var(--ink-2, #595959)', textDecoration: 'none' }}
          >
            <PhoneOutlined style={{ marginRight: 5 }} />
            {person.phone}
          </a>
        ) : null}
        {person.lastContact ? (
          <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
            Last contact: {formatDate(person.lastContact)}
          </Typography.Text>
        ) : null}
      </div>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value?: ReactNode | string | null }) {
  return (
    <div className="ps-field">
      <span className="ps-key">{label}</span>
      <span className="ps-val">
        {value == null || value === '' ? (
          <span className="ps-val-empty">Not provided</span>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

/* ── Modals ──────────────────────────────────────────────────────────────── */

function AddCapabilityModal({
  open,
  onCancel,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const [form] = Form.useForm();
  return (
    <Modal
      title="Add Capability"
      open={open}
      onCancel={() => { form.resetFields(); onCancel(); }}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      okText="Add Capability"
      width={600}
      afterClose={() => form.resetFields()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => {
          onSubmit({
            name: values.name,
            type: values.type ?? 'product',
            description: values.description ?? null,
            sector: values.sector ?? null,
            tags: Array.isArray(values.tags) ? values.tags : [],
            trl: values.trl ? Number(values.trl) : null,
            mrl: values.mrl ? Number(values.mrl) : null,
            fundingAsk: values.fundingAsk ? Number(values.fundingAsk) : null,
            fundingAskLabel: values.fundingAskLabel ?? null,
          });
        }}
      >
        <Form.Item name="name" label="Name" rules={[{ required: true, min: 1 }]}>
          <Input placeholder="e.g. JaiaBot Hydro" />
        </Form.Item>
        <Form.Item name="type" label="Type" initialValue="product">
          <Select
            options={[
              { label: 'Product', value: 'product' },
              { label: 'Service', value: 'service' },
              { label: 'Platform', value: 'platform' },
              { label: 'Technology', value: 'technology' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="sector"
          label="Sector"
          tooltip="Pick the closest sector. Used for downstream agency/policy matching."
        >
          <Select
            allowClear
            placeholder="Pick a sector"
            options={SECTOR_TAGS.map((t) => ({ label: SECTOR_LABELS[t], value: t }))}
          />
        </Form.Item>
        <Form.Item
          name="tags"
          label="Tags"
          tooltip="Pick from suggestions or type-and-enter custom tags. Used for bill matching and intelligence triage."
        >
          <Select
            mode="tags"
            allowClear
            placeholder="Pick or add tags"
            tokenSeparators={[',']}
            options={CAPABILITY_TAG_SUGGESTIONS.map((t) => ({ label: t, value: t }))}
          />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="trl" label="TRL (1–9)" style={{ flex: 1 }}>
            <Input type="number" min={1} max={9} />
          </Form.Item>
          <Form.Item name="mrl" label="MRL (1–10)" style={{ flex: 1 }}>
            <Input type="number" min={1} max={10} />
          </Form.Item>
          <Form.Item name="fundingAsk" label="Funding Ask ($)" style={{ flex: 2 }}>
            <Input type="number" min={0} placeholder="e.g. 28000000" />
          </Form.Item>
        </div>
        <Form.Item name="fundingAskLabel" label="Ask Label">
          <Input placeholder="e.g. SAC-D FY27 ask" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function AddPersonModal({
  open,
  onCancel,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const [form] = Form.useForm();
  return (
    <Modal
      title="Add Person"
      open={open}
      onCancel={() => { form.resetFields(); onCancel(); }}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      okText="Add Person"
      afterClose={() => form.resetFields()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => {
          onSubmit({
            name: values.name,
            title: values.title ?? null,
            email: values.email ?? null,
            phone: values.phone ?? null,
            role: values.role ?? null,
            notes: values.notes ?? null,
          });
        }}
      >
        <Form.Item name="name" label="Full Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="title" label="Title">
          <Input placeholder="e.g. VP Government Affairs" />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="email" label="Email" style={{ flex: 1 }} rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone" style={{ flex: 1 }}>
            <Input placeholder="+1 202-555-0142" />
          </Form.Item>
        </div>
        <Form.Item name="role" label="Role">
          <Select
            placeholder="Select role"
            allowClear
            options={[
              { label: 'Primary POC', value: 'Primary POC' },
              { label: 'Executive', value: 'Executive' },
              { label: 'BD', value: 'BD' },
              { label: 'Technical', value: 'Technical' },
              { label: 'Legal', value: 'Legal' },
              { label: 'Finance', value: 'Finance' },
            ]}
          />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function portfolioTags(client: Client): string[] {
  const intake = toRecord(client.intakeData);
  const tags: string[] = [];
  const sectorLabel = sectorLabelFor(client);
  if (sectorLabel) tags.push(sectorLabel);
  for (const track of client.submissionTracks ?? []) {
    const label = SUBMISSION_TRACK_LABELS[track as SubmissionTrack] ?? track;
    if (label) tags.push(label);
  }
  const raw = (intake['portfolio'] ?? intake['tags']) as unknown;
  const explicit = Array.isArray(raw)
    ? (raw as unknown[]).map((t) => String(t ?? '').trim()).filter(Boolean)
    : [];
  for (const t of explicit) if (!tags.includes(t)) tags.push(t);
  if (!tags.length) {
    const fallback = readText(intake, ['requestType', 'request_type']);
    if (fallback) tags.push(fallback);
  }
  return tags;
}

function sectorLabelFor(client: Client): string | undefined {
  if (client.sectorTag) {
    return SECTOR_LABELS[client.sectorTag as SectorTag] ?? client.sectorTag;
  }
  const intake = toRecord(client.intakeData);
  const raw = readText(intake, ['sector']);
  if (!raw) return undefined;
  const normalized = normalizeSector(raw);
  return normalized ? SECTOR_LABELS[normalized] : raw;
}

function readText(record: Record<string, unknown>, keys: string[]): string | undefined {
  const val = readFirst(record, keys);
  if (val == null) return undefined;
  if (typeof val === 'string') return val.trim() || undefined;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return undefined;
}

function readFirst(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CL';
  const first = parts[0] ?? '';
  const second = parts[1] ?? '';
  if (!second) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ''}${second[0] ?? ''}`.toUpperCase();
}

function externalUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function titleCase(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
