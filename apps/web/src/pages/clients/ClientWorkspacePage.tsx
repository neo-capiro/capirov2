import { useMemo, useState } from 'react';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  SlidersOutlined,
} from '@ant-design/icons';
import { hasAtLeast } from '@capiro/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Avatar,
  Button,
  Empty,
  Input,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import { useMe } from '../../lib/me.js';
import { ClientFormModal } from './ClientFormModal.js';
import type { Client, ClientDocument, ClientPayload } from './clientTypes.js';

const PROFILE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts', disabled: true },
  { key: 'meetings', label: 'Meetings', disabled: true },
  { key: 'workflows', label: 'Workflows', disabled: true },
  { key: 'documents', label: 'Documents', disabled: true },
  { key: 'compliance', label: 'Compliance', disabled: true },
];

export function ClientWorkspacePage() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const canManageClients = Boolean(me.data && hasAtLeast(me.data.role, 'user_admin'));

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });

  const selectedClient = useQuery<Client>({
    queryKey: ['client', selectedId],
    queryFn: async () => (await api.get<Client>(`/api/clients/${selectedId}`)).data,
    enabled: Boolean(selectedId),
  });

  const visibleClients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (clients.data ?? [])
      .filter((client) => client.status !== 'archived')
      .filter((client) => {
        if (!needle) return true;
        const haystack = [
          client.name,
          client.website,
          client.primaryContactName,
          client.primaryContactEmail,
          client.description,
          readText(intakeRecord(client), ['sector', 'requestType', 'fundingAsk']),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      });
  }, [clients.data, search]);

  const createClient = useMutation({
    mutationFn: async (payload: ClientPayload) =>
      (await api.post<Client>('/api/clients', payload)).data,
    onSuccess: (created) => {
      message.success('Client added');
      setModalMode(null);
      setEditingClient(null);
      setSelectedId(created.id);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  const updateClient = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: ClientPayload }) =>
      (await api.put<Client>(`/api/clients/${id}`, payload)).data,
    onSuccess: (updated) => {
      message.success('Client updated');
      setModalMode(null);
      setEditingClient(null);
      setSelectedId(updated.id);
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client', updated.id] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  const archiveClient = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/clients/${id}`)).data,
    onSuccess: () => {
      message.success('Client removed');
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  const openCreate = () => {
    if (!canManageClients) return;
    setEditingClient(null);
    setModalMode('create');
  };

  const openEdit = (client: Client) => {
    if (!canManageClients) return;
    setEditingClient(client);
    setModalMode('edit');
  };

  const confirmRemove = (client: Client) => {
    if (!canManageClients) return;
    modal.confirm({
      title: `Remove ${client.name}?`,
      content:
        'This archives the client for this tenant. The record can still be recovered from the database.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: () => archiveClient.mutateAsync(client.id),
    });
  };

  return (
    <>
      {selectedId ? (
        <ClientProfileView
          client={selectedClient.data}
          loading={selectedClient.isLoading}
          canManageClients={canManageClients}
          onBack={() => setSelectedId(null)}
          onEdit={openEdit}
          onRemove={confirmRemove}
        />
      ) : (
        <section className="client-page">
          <div className="client-page-header">
            <Typography.Title level={3} style={{ margin: 0 }}>
              Clients
            </Typography.Title>
            <Space>
              <Button icon={<SlidersOutlined />} disabled>
                Filter / Sort
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canManageClients}
                onClick={openCreate}
              >
                New Client
              </Button>
            </Space>
          </div>

          <Input
            size="large"
            prefix={<SearchOutlined />}
            placeholder="Search clients..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            className="client-search"
          />

          {clients.isLoading ? (
            <div className="client-card-grid">
              {Array.from({ length: 3 }).map((_, index) => (
                <div className="client-card" key={index}>
                  <Skeleton active paragraph={{ rows: 5 }} />
                </div>
              ))}
            </div>
          ) : visibleClients.length ? (
            <div className="client-card-grid">
              {visibleClients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  onClick={() => setSelectedId(client.id)}
                />
              ))}
              <AddClientCard canManageClients={canManageClients} onClick={openCreate} />
            </div>
          ) : (
            <div className="client-empty-state">
              <Empty description={search ? 'No clients match that search.' : 'No clients yet.'} />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canManageClients}
                onClick={openCreate}
              >
                Add client
              </Button>
            </div>
          )}
        </section>
      )}

      <ClientFormModal
        open={Boolean(modalMode)}
        mode={modalMode ?? 'create'}
        client={editingClient}
        submitting={createClient.isPending || updateClient.isPending}
        onCancel={() => {
          setModalMode(null);
          setEditingClient(null);
        }}
        onSubmit={(payload) => {
          if (modalMode === 'edit' && editingClient) {
            updateClient.mutate({ id: editingClient.id, payload });
            return;
          }
          createClient.mutate(payload);
        }}
      />
    </>
  );
}

function ClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const intake = intakeRecord(client);
  const tags = portfolioTags(client).slice(0, 3);
  const workflows = readNumber(intake, ['workflowsCount', 'workflows']) ?? 0;

  return (
    <button className="client-card" type="button" onClick={onClick}>
      <div className="client-card-topline">
        <Avatar shape="square" size={52} className="client-avatar">
          {initials(client.name)}
        </Avatar>
        <div className="client-card-title">
          <Typography.Text strong>{client.name}</Typography.Text>
          <Typography.Text type="secondary">
            {client.website ?? 'No website recorded'}
          </Typography.Text>
        </div>
        <MoreOutlined className="client-card-menu" />
      </div>

      <div className="client-card-details">
        <DetailPair label="POC" value={client.primaryContactName} />
        <DetailPair label="Sector" value={readText(intake, ['sector'])} />
        <DetailPair label="Funding ask" value={readText(intake, ['fundingAsk', 'funding_ask'])} />
        <DetailPair
          label="Request type"
          value={readText(intake, ['requestType', 'request_type'])}
        />
      </div>

      <div className="client-tag-row">
        {tags.length ? tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Tag>Intake pending</Tag>}
      </div>

      <div className="client-card-footer">
        <span className="client-status-pill">
          <CheckOutlined />
          {client.status === 'active' ? 'Active' : titleCase(client.status)}
        </span>
        <Typography.Text type="secondary">{workflows} workflows</Typography.Text>
        <Typography.Text type="secondary">Updated {relativeTime(client.updatedAt)}</Typography.Text>
      </div>
    </button>
  );
}

function AddClientCard({
  canManageClients,
  onClick,
}: {
  canManageClients: boolean;
  onClick: () => void;
}) {
  const card = (
    <button
      className="client-add-card"
      type="button"
      disabled={!canManageClients}
      onClick={onClick}
      aria-label="Add new client"
    >
      <span className="client-add-icon">
        <PlusOutlined />
      </span>
      <Typography.Text strong>Add new client</Typography.Text>
    </button>
  );

  if (canManageClients) return card;
  return <Tooltip title="Only user admins and Capiro admins can add clients.">{card}</Tooltip>;
}

function ClientProfileView({
  client,
  loading,
  canManageClients,
  onBack,
  onEdit,
  onRemove,
}: {
  client?: Client;
  loading: boolean;
  canManageClients: boolean;
  onBack: () => void;
  onEdit: (client: Client) => void;
  onRemove: (client: Client) => void;
}) {
  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (!client) {
    return (
      <section className="client-page">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          Back to clients
        </Button>
        <Empty description="Client not found." />
      </section>
    );
  }

  const tags = portfolioTags(client);
  const intake = intakeRecord(client);

  return (
    <section className="client-profile">
      <div className="client-profile-hero">
        <Button
          aria-label="Back to clients"
          icon={<ArrowLeftOutlined />}
          type="text"
          onClick={onBack}
          className="client-back-button"
        />
        <Avatar shape="square" size={86} className="client-profile-avatar">
          {initials(client.name)}
        </Avatar>
        <div className="client-profile-title">
          <Typography.Title level={3}>{client.name}</Typography.Title>
          <Typography.Text type="secondary">
            {[
              client.website,
              client.primaryContactName ? `POC: ${client.primaryContactName}` : null,
              client.primaryContactEmail,
            ]
              .filter(Boolean)
              .join(' - ')}
          </Typography.Text>
          <div className="client-tag-row">
            {tags.length ? (
              tags.map((tag) => <Tag key={tag}>{tag}</Tag>)
            ) : (
              <Tag>Intake pending</Tag>
            )}
          </div>
        </div>
        <Space className="client-profile-actions">
          <Button disabled={!canManageClients} onClick={() => onEdit(client)}>
            Edit
          </Button>
          <Button disabled={!canManageClients} onClick={() => onRemove(client)}>
            Remove
          </Button>
          <Button type="primary" icon={<PlusOutlined />} disabled>
            New Workflow
          </Button>
        </Space>
      </div>

      <Tabs
        defaultActiveKey="overview"
        className="client-profile-tabs"
        items={PROFILE_TABS.map((tab) => ({
          ...tab,
          children:
            tab.key === 'overview' ? <ClientOverview client={client} intake={intake} /> : null,
        }))}
      />
    </section>
  );
}

function ClientOverview({ client, intake }: { client: Client; intake: Record<string, unknown> }) {
  const documents = readDocuments(intake);
  const governmentHistory = toRecord(
    readFirst(intake, ['governmentHistory', 'government_history']),
  );
  const additionalEntries = Object.entries(intake).filter(([key]) => !knownIntakeKeys.has(key));

  return (
    <div className="client-overview-grid">
      <div className="client-profile-panel">
        <Typography.Title level={5}>Profile</Typography.Title>
        <ProfileRows
          rows={[
            ['Sector', readText(intake, ['sector'])],
            ['TRL', readText(intake, ['trl'])],
            ['Funding ask', readText(intake, ['fundingAsk', 'funding_ask'])],
            ['Request type', readText(intake, ['requestType', 'request_type'])],
            ['PE number', readText(intake, ['peNumber', 'pe_number'])],
            ['Engagement', readText(intake, ['engagement'])],
            ['Product / service', client.productDescription],
            ['Description', client.description],
            ['Primary contact', client.primaryContactName],
            ['Email', client.primaryContactEmail],
            ['Phone', client.primaryContactPhone],
            ['Status', titleCase(client.status)],
            ['Created', formatDate(client.createdAt)],
          ]}
        />

        <Typography.Title level={5} style={{ marginTop: 18 }}>
          Portfolio
        </Typography.Title>
        <div className="client-tag-row">
          {portfolioTags(client).length ? (
            portfolioTags(client).map((tag) => <Tag key={tag}>{tag}</Tag>)
          ) : (
            <Typography.Text type="secondary">No portfolio tags recorded.</Typography.Text>
          )}
        </div>

        {additionalEntries.length ? (
          <>
            <Typography.Title level={5} style={{ marginTop: 18 }}>
              Additional Intake
            </Typography.Title>
            <ProfileRows
              rows={additionalEntries.map(([key, value]) => [labelize(key), valueToText(value)])}
            />
          </>
        ) : null}
      </div>

      <div className="client-profile-panel">
        <Typography.Title level={5}>Documents</Typography.Title>
        {documents.length ? (
          <div className="client-document-list">
            {documents.map((document) => (
              <div className="client-document-row" key={`${document.name}-${document.date ?? ''}`}>
                <span className="client-document-type">{document.type ?? 'DOC'}</span>
                <div>
                  <Typography.Text>{document.name}</Typography.Text>
                  {document.date ? (
                    <Typography.Text type="secondary">{document.date}</Typography.Text>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Typography.Text type="secondary">No documents recorded from intake yet.</Typography.Text>
        )}

        <Typography.Title level={5} style={{ marginTop: 18 }}>
          Government History
        </Typography.Title>
        <ProfileRows
          rows={[
            ['Prior contracts', readText(governmentHistory, ['priorContracts', 'prior_contracts'])],
            ['Grants', readText(governmentHistory, ['grants'])],
            [
              'Prior engagement',
              readText(governmentHistory, ['priorEngagement', 'prior_engagement']),
            ],
          ]}
        />
      </div>

      <div className="client-profile-panel client-profile-panel--muted">
        <Typography.Title level={5}>Engagement Timeline</Typography.Title>
        <div className="client-timeline">
          {timelineItems(client).map((item) => (
            <div className="client-timeline-item" key={`${item.title}-${item.date}`}>
              <ClockCircleOutlined />
              <div>
                <Typography.Text>{item.title}</Typography.Text>
                <Typography.Text type="secondary">{item.date}</Typography.Text>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProfileRows({ rows }: { rows: Array<[string, unknown]> }) {
  const visibleRows = rows.filter(([, value]) => Boolean(valueToText(value)));
  if (!visibleRows.length) {
    return <Typography.Text type="secondary">No details recorded.</Typography.Text>;
  }

  return (
    <div className="client-profile-rows">
      {visibleRows.map(([label, value]) => (
        <div className="client-profile-row" key={label}>
          <Typography.Text type="secondary">{label}</Typography.Text>
          <Typography.Text>{valueToText(value)}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

function DetailPair({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="client-detail-pair">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text>{value || '-'}</Typography.Text>
    </div>
  );
}

const knownIntakeKeys = new Set([
  'sector',
  'trl',
  'fundingAsk',
  'funding_ask',
  'requestType',
  'request_type',
  'peNumber',
  'pe_number',
  'engagement',
  'portfolio',
  'tags',
  'documents',
  'docs',
  'governmentHistory',
  'government_history',
]);

function intakeRecord(client: Client): Record<string, unknown> {
  return toRecord(client.intakeData);
}

function portfolioTags(client: Client): string[] {
  const intake = intakeRecord(client);
  const explicitTags = readList(intake, ['portfolio', 'tags']);
  if (explicitTags.length) return explicitTags;
  return [
    readText(intake, ['sector']),
    readText(intake, ['requestType', 'request_type']),
    readText(intake, ['fundingAsk', 'funding_ask']),
  ].filter((item): item is string => Boolean(item));
}

function readDocuments(intake: Record<string, unknown>): ClientDocument[] {
  const raw = readFirst(intake, ['documents', 'docs']);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ClientDocument | null => {
      if (typeof item === 'string') return { name: item, type: documentType(item) };
      const record = toRecord(item);
      const name = readText(record, ['name', 'title', 'filename']);
      if (!name) return null;
      return {
        name,
        type: readText(record, ['type']) ?? documentType(name),
        date: readText(record, ['date']),
      };
    })
    .filter((item): item is ClientDocument => Boolean(item));
}

function timelineItems(client: Client) {
  return [
    { title: 'Meeting', date: 'Coming soon' },
    { title: 'White paper draft', date: 'Coming soon' },
    { title: 'Intake complete', date: formatDate(client.updatedAt) },
    { title: 'Conflict check passed', date: 'Coming soon' },
    { title: 'Client created', date: formatDate(client.createdAt) },
  ];
}

function readList(record: Record<string, unknown>, keys: string[]): string[] {
  const raw = readFirst(record, keys);
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
      .filter(Boolean);
  }
  const text = readText(record, keys);
  return text
    ? text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function readText(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = readFirst(record, keys);
  if (value == null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readFirst(record, keys);
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
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

function documentType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'DOC';
  return ext.slice(0, 3).toUpperCase();
}

function valueToText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(', ');
  return Object.entries(toRecord(value))
    .map(([key, entry]) => `${labelize(key)}: ${valueToText(entry)}`)
    .filter(Boolean)
    .join(', ');
}

function labelize(value: string): string {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function titleCase(value: string): string {
  return labelize(value || 'unknown');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(value);
}
