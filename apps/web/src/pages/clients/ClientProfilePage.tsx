import { useRef, useState, type ReactNode } from 'react';
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
  Spin,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import { Sparkline, HBar } from '../../components/charts.js';
import type { Capability } from './CapabilityDrawer.js';
import { CapabilityDrawer } from './CapabilityDrawer.js';
import type { Client, ClientAttachment, ClientFormSubmit } from './clientTypes.js';

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

type ProfileTab = 'overview' | 'capabilities' | 'people' | 'workflows' | 'documents' | 'federal';

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
    enabled: activeTab === 'people',
  });

  const workflows = useQuery<WorkflowInstance[]>({
    queryKey: ['workflow-instances', { clientId: client.id }],
    queryFn: async () =>
      (
        await api.get<WorkflowInstance[]>('/api/workflows/instances', {
          params: { clientId: client.id },
        })
      ).data,
    enabled: activeTab === 'workflows',
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
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
              <a href={`tel:${client.primaryContactPhone.replace(/\s/g, '')}`}>
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
              void onUploadLogo(client, file as File).then(() => onClientUpdated());
              return false;
            }}
          >
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
        {(['overview', 'capabilities', 'people', 'workflows', 'documents', 'federal'] as ProfileTab[]).map((tab) => (
          <div
            key={tab}
            className={`cp-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
            role="tab"
          >
            {tab === 'overview'
              ? 'Overview'
              : tab === 'capabilities'
                ? `Capabilities${capabilities.data?.length ? ` (${capabilities.data.length})` : ''}`
                : tab === 'people'
                  ? 'People'
                  : tab === 'workflows'
                    ? 'Workflows'
                    : tab === 'documents'
                      ? 'Documents'
                      : 'Federal Intel'}
          </div>
        ))}
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
              onViewAllCaps={() => setActiveTab('capabilities')}
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
          {activeTab === 'federal' && <FederalIntelTab clientName={client.name} />}
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
  onViewAllCaps,
  onCapClick,
  onAddCap,
}: {
  client: Client;
  intake: Record<string, unknown>;
  capabilities: Capability[];
  capsLoading: boolean;
  onViewAllCaps: () => void;
  onCapClick: (c: Capability) => void;
  onAddCap: () => void;
}) {
  const cageCode = readText(intake, ['cageCode', 'cage_code']);
  const uei = readText(intake, ['uei']);
  const primaryNaics = readText(intake, ['primaryNaics', 'primary_naics', 'naics']);
  const samStatus = readText(intake, ['samStatus', 'sam_status']);
  const existingContracts = readText(intake, ['existingContracts', 'existing_contracts']);

  return (
    <div className="overview-grid">
      <div>
        <div className="profile-section">
          <div className="ps-title">Company Information</div>
          <ProfileField label="Name" value={client.name} />
          <ProfileField
            label="Website"
            value={
              client.website ? (
                <a href={externalUrl(client.website)} target="_blank" rel="noreferrer">
                  {client.website}
                </a>
              ) : null
            }
          />
          <ProfileField label="Description" value={client.description} />
          <ProfileField label="Sector" value={readText(intake, ['sector'])} />
          <ProfileField label="Product / Service" value={client.productDescription} />
        </div>

        <div className="profile-section">
          <div className="ps-title">Government Registration</div>
          <ProfileField label="CAGE Code" value={cageCode} />
          <ProfileField label="UEI (SAM)" value={uei} />
          <ProfileField label="Primary NAICS" value={primaryNaics} />
          <ProfileField label="SAM Status" value={samStatus} />
          <ProfileField label="Existing Contracts" value={existingContracts} />
        </div>

        <div className="profile-section">
          <div className="ps-title">Engagement Info</div>
          <ProfileField
            label="Status"
            value={
              <span style={{ color: STATUS_COLOR[client.status] ?? '#8c8c8c', fontWeight: 600 }}>
                {titleCase(client.status)}
              </span>
            }
          />
          <ProfileField label="Primary Contact" value={client.primaryContactName} />
          <ProfileField label="Email" value={client.primaryContactEmail} />
          <ProfileField label="Phone" value={client.primaryContactPhone} />
          <ProfileField label="Created" value={formatDate(client.createdAt)} />
        </div>
      </div>

      <div>
        <div className="profile-section">
          <div className="overview-right-title">
            <span>
              Capabilities
              {capabilities.length ? (
                <span style={{ fontWeight: 400, marginLeft: 4 }}>{capabilities.length} total</span>
              ) : null}
            </span>
            <button
              onClick={onViewAllCaps}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#1677ff',
                fontSize: 11,
              }}
            >
              View all
            </button>
          </div>

          {capsLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : capabilities.length ? (
            capabilities.slice(0, 3).map((cap) => (
              <CapabilityCard key={cap.id} cap={cap} onClick={() => onCapClick(cap)} />
            ))
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              No capabilities yet.
            </Typography.Text>
          )}

          <button className="she-add-btn" onClick={onAddCap} style={{ marginTop: 8 }}>
            <PlusOutlined /> Add capability
          </button>
        </div>
      </div>
    </div>
  );
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <div>
          <Typography.Text strong style={{ fontSize: 15 }}>
            Capabilities
          </Typography.Text>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
            Products, services, technologies, and programs — with full submission history per
            capability
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} size="small" onClick={onAddCap}>
          Add capability
        </Button>
      </div>

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <Typography.Text strong style={{ fontSize: 15 }}>
          People
        </Typography.Text>
        <Button type="primary" icon={<PlusOutlined />} size="small" onClick={onAddPerson}>
          Add person
        </Button>
      </div>

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
  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;

  if (!workflows.length) {
    return (
      <div className="cp-tab-empty">
        <Empty description="No workflows for this client yet." />
      </div>
    );
  }

  return (
    <>
      {workflows.map((wf) => (
        <div className="cp-workflow-row" key={wf.id}>
          <Tag color={WORKFLOW_STATUS_COLORS[wf.status] ?? 'default'}>{titleCase(wf.status)}</Tag>
          {wf.template ? (
            <Tag color="blue" style={{ fontSize: 10 }}>
              {wf.template.category}
            </Tag>
          ) : null}
          <span className="cp-workflow-title">{wf.title}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {formatDate(wf.createdAt)}
          </Typography.Text>
        </div>
      ))}
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
            <div>
              Drop files here or{' '}
              <span style={{ color: 'var(--cp-accent)', fontWeight: 600 }}>click to upload</span>
            </div>
            <div style={{ fontSize: 11, marginTop: 4, color: '#9aa4b2' }}>
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
  const TYPE_CSS: Record<string, string> = {
    product: 'cap-type-product',
    service: 'cap-type-service',
    platform: 'cap-type-platform',
    technology: 'cap-type-technology',
  };
  const typeClass = TYPE_CSS[cap.type] ?? 'cap-type-product';
  const tags = Array.isArray(cap.tags) ? (cap.tags as string[]) : [];

  return (
    <div className="cap-card" onClick={onClick}>
      <div className="cap-card-hd">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cap-name" style={large ? { fontSize: 14 } : undefined}>
            {cap.name}
          </div>
          <div className="cap-tags-row">
            <span className={`cap-type-tag ${typeClass}`} style={{ textTransform: 'capitalize' }}>
              {cap.type}
            </span>
            {cap.sector ? <span className="cap-sector-tag">{cap.sector}</span> : null}
            {tags.slice(0, 2).map((t) => (
              <span key={t} className="cap-sector-tag">
                {t}
              </span>
            ))}
          </div>
          {large && cap.description ? <div className="cap-desc">{cap.description}</div> : null}
          {cap.trl != null || cap.mrl != null ? (
            <div className="cap-trl">
              {[cap.trl != null ? `TRL ${cap.trl}` : null, cap.mrl != null ? `MRL ${cap.mrl}` : null]
                .filter(Boolean)
                .join(' · ')}
            </div>
          ) : null}
        </div>
        {cap.fundingAsk != null ? (
          <div className="cap-ask">
            ${(cap.fundingAsk / 1_000_000).toFixed(cap.fundingAsk >= 10_000_000 ? 0 : 1)}M
            {cap.fundingAskLabel ? (
              <div className="cap-ask-label">{cap.fundingAskLabel}</div>
            ) : null}
          </div>
        ) : null}
      </div>
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
        {person.role ? <span className="cp-person-role">{person.role}</span> : null}
        <Button size="small" type="text" icon={<DeleteOutlined />} danger onClick={onDelete} />
      </div>

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: '#595959' }}
      >
        {person.email ? (
          <a href={`mailto:${person.email}`} style={{ color: '#595959' }}>
            <MailOutlined style={{ marginRight: 5 }} />
            {person.email}
          </a>
        ) : null}
        {person.phone ? (
          <a href={`tel:${person.phone}`} style={{ color: '#595959' }}>
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
        <Form.Item name="sector" label="Sector">
          <Input placeholder="e.g. Maritime Autonomy" />
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
  const raw = (intake['portfolio'] ?? intake['tags']) as unknown;
  const tags = Array.isArray(raw)
    ? (raw as unknown[]).map((t) => String(t ?? '').trim()).filter(Boolean)
    : [];
  if (tags.length) return tags;
  return [
    readText(intake, ['sector']),
    readText(intake, ['requestType', 'request_type']),
  ].filter((t): t is string => Boolean(t));
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

/* ── Federal Intel Tab ────────────────────────────────────────────────────
 * Looks up this client in the federal lobbying intelligence dataset
 * (OpenLobby / Senate LDA) by name. Shows historical spend, trajectory,
 * top LDA issues, and surge data for those issues.
 * ──────────────────────────────────────────────────────────────────────── */

interface LobbyIntelSummary {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  totalSpending: number | null;
  filings: number | null;
  issues: string[];
  years: number[];
  trajectory: string | null;
  growthRate: number | null;
  yearlySpend: { year: number; amount: number }[];
}

interface LobbyIssue {
  code: string;
  name: string;
  totalSpending: number | null;
  surgeTrend: string | null;
  surgePct: number | null;
  latestQuarter: string | null;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function FederalIntelTab({ clientName }: { clientName: string }) {
  const api = useApi();

  const lookup = useQuery<LobbyIntelSummary | null>({
    queryKey: ['lobby-intel-lookup', clientName],
    queryFn: async () => {
      const resp = await api.get<LobbyIntelSummary | null>('/api/lobby-intel/lookup', {
        params: { name: clientName },
      });
      return resp.data;
    },
    staleTime: 60 * 1000,
  });

  const allIssues = useQuery<LobbyIssue[]>({
    queryKey: ['lobby-intel-issues'],
    queryFn: async () => (await api.get<LobbyIssue[]>('/api/lobby-intel/issues')).data,
    staleTime: 5 * 60 * 1000,
  });

  if (lookup.isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active />
      </div>
    );
  }

  if (lookup.isError) {
    return (
      <div style={{ padding: 24 }}>
        <Typography.Text type="danger">
          Could not load federal intel: {(lookup.error as Error).message}
        </Typography.Text>
      </div>
    );
  }

  const intel = lookup.data;

  if (!intel) {
    return (
      <div style={{ padding: '24px 8px' }}>
        <Empty
          description={
            <span>
              <strong>{clientName}</strong> was not found in the federal lobbying dataset.
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Either this client does not file under the Senate LDA, the name in Capiro does
                not match the filing name, or the OpenLobby sync has not been run yet.
              </Typography.Text>
            </span>
          }
        />
      </div>
    );
  }

  const issueMap = new Map((allIssues.data ?? []).map((i) => [i.code, i] as const));
  const clientIssues = intel.issues
    .map((code) => issueMap.get(code))
    .filter((i): i is LobbyIssue => Boolean(i))
    .sort((a, b) => (b.totalSpending ?? 0) - (a.totalSpending ?? 0));

  const surgingClientIssues = clientIssues.filter(
    (i) => i.surgeTrend === 'surging' || i.surgeTrend === 'growing',
  );
  const maxIssue = Math.max(1, ...clientIssues.map((i) => i.totalSpending ?? 0));

  return (
    <div style={{ padding: '4px 8px' }}>
      <div
        style={{
          padding: 12,
          background: 'rgba(37, 99, 235, 0.06)',
          border: '1px solid rgba(37, 99, 235, 0.2)',
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 12,
        }}
      >
        <Typography.Text type="secondary">Matched to OpenLobby filing entity: </Typography.Text>
        <Typography.Text strong>{intel.name}</Typography.Text>
        {intel.state ? (
          <Typography.Text type="secondary"> · {intel.state}</Typography.Text>
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="profile-section" style={{ marginBottom: 0 }}>
          <div className="ps-title">Total Federal Spend</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{fmtMoney(intel.totalSpending)}</div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            2018–2025 reported LDA income
          </Typography.Text>
        </div>
        <div className="profile-section" style={{ marginBottom: 0 }}>
          <div className="ps-title">Filings</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{intel.filings ?? '—'}</div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            Years active: {intel.years.length}
          </Typography.Text>
        </div>
        <div className="profile-section" style={{ marginBottom: 0 }}>
          <div className="ps-title">Trajectory</div>
          <div style={{ fontSize: 18, fontWeight: 600, textTransform: 'capitalize' }}>
            {intel.trajectory ?? 'steady'}
            {intel.growthRate != null && intel.growthRate !== 0 ? (
              <Typography.Text
                type={intel.growthRate > 0 ? 'success' : 'warning'}
                style={{ fontSize: 13, marginLeft: 8 }}
              >
                {intel.growthRate > 0 ? '+' : ''}
                {Math.round(intel.growthRate)}%
              </Typography.Text>
            ) : null}
          </div>
          <Sparkline data={intel.yearlySpend ?? []} width={180} height={36} />
        </div>
      </div>

      {intel.yearlySpend && intel.yearlySpend.length > 0 ? (
        <div className="profile-section">
          <div className="ps-title">Spend by Year</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...intel.yearlySpend]
              .sort((a, b) => a.year - b.year)
              .map((y) => {
                const max = Math.max(...intel.yearlySpend.map((d) => d.amount), 1);
                return (
                  <div
                    key={y.year}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '60px 1fr 100px',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Typography.Text type="secondary">{y.year}</Typography.Text>
                    <HBar value={y.amount} max={max} width={280} height={10} />
                    <Typography.Text style={{ textAlign: 'right' }}>
                      {fmtMoney(y.amount)}
                    </Typography.Text>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}

      {surgingClientIssues.length > 0 ? (
        <div className="profile-section">
          <div className="ps-title">🔥 Surging Issues for This Client</div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            Issues this client lobbies on that are surging across all filers right now.
          </Typography.Paragraph>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {surgingClientIssues.slice(0, 6).map((i) => (
              <div
                key={i.code}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 100px',
                  alignItems: 'center',
                  gap: 10,
                  padding: '4px 0',
                }}
              >
                <Tag color="default" style={{ margin: 0 }}>
                  {i.code}
                </Tag>
                <Typography.Text>{i.name}</Typography.Text>
                <Tag
                  color={i.surgeTrend === 'surging' ? 'red' : 'gold'}
                  style={{ margin: 0, textAlign: 'right' }}
                >
                  {i.surgePct != null ? `+${Math.round(i.surgePct)}%` : i.surgeTrend}
                </Tag>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {clientIssues.length > 0 ? (
        <div className="profile-section">
          <div className="ps-title">LDA Issue Mix ({intel.issues.length} codes)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {clientIssues.slice(0, 15).map((i) => (
              <div
                key={i.code}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 120px 90px',
                  alignItems: 'center',
                  gap: 10,
                  padding: '3px 0',
                }}
              >
                <Tag style={{ margin: 0 }}>{i.code}</Tag>
                <Typography.Text style={{ fontSize: 13 }}>{i.name}</Typography.Text>
                <HBar value={i.totalSpending ?? 0} max={maxIssue} width={120} />
                <Typography.Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                  {fmtMoney(i.totalSpending)}
                </Typography.Text>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="profile-section">
          <div className="ps-title">LDA Issue Codes</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {intel.issues.map((code) => (
              <Tag key={code} style={{ marginRight: 0 }}>
                {code}
              </Tag>
            ))}
          </div>
        </div>
      )}

      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 11, marginTop: 16, marginBottom: 0 }}
      >
        Source:{' '}
        <a href="https://www.openlobby.us/" target="_blank" rel="noreferrer">
          OpenLobby
        </a>{' '}
        / Senate{' '}
        <a href="https://lda.senate.gov/" target="_blank" rel="noreferrer">
          LDA filings
        </a>
        . Matched by name (fuzzy). If the match is wrong, update this client&apos;s name to match
        the filing entity name on OpenLobby.
      </Typography.Paragraph>
    </div>
  );
}
