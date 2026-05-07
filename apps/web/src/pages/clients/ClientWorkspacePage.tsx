import { useMemo, useState } from 'react';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FilterOutlined,
  LinkOutlined,
  MailOutlined,
  MoreOutlined,
  PhoneOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { hasAtLeast } from '@capiro/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Avatar,
  Button,
  Empty,
  Popover,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import { useMe } from '../../lib/me.js';
import { ClientFormModal } from './ClientFormModal.js';
import type { Client, ClientAttachment, ClientDocument, ClientFormSubmit } from './clientTypes.js';

const PROFILE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts', disabled: true },
  { key: 'workflows', label: 'Workflows', disabled: true },
  { key: 'documents', label: 'Documents' },
  { key: 'compliance', label: 'Compliance', disabled: true },
];

interface ClientFilterState {
  sectors: string[];
  requestTypes: string[];
}

export function ClientWorkspacePage() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [filters, setFilters] = useState<ClientFilterState>({ sectors: [], requestTypes: [] });

  const canCreateClients = Boolean(me.data && hasAtLeast(me.data.role, 'standard_user'));
  const canManageClients = Boolean(me.data && hasAtLeast(me.data.role, 'user_admin'));
  const canRemoveClients = Boolean(me.data && hasAtLeast(me.data.role, 'standard_user'));

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });

  const selectedClient = useQuery<Client>({
    queryKey: ['client', selectedId],
    queryFn: async () => (await api.get<Client>(`/api/clients/${selectedId}`)).data,
    enabled: Boolean(selectedId),
  });

  const activeClients = useMemo(
    () => (clients.data ?? []).filter((client) => client.status !== 'archived'),
    [clients.data],
  );

  const filterOptions = useMemo(
    () => ({
      sectors: uniqueOptions(
        activeClients.map((client) => readText(intakeRecord(client), ['sector'])),
      ),
      requestTypes: uniqueOptions(
        activeClients.map((client) =>
          readText(intakeRecord(client), ['requestType', 'request_type']),
        ),
      ),
    }),
    [activeClients],
  );

  const activeFilterCount = filters.sectors.length + filters.requestTypes.length;
  const hasFilterValues = Boolean(
    filterOptions.sectors.length || filterOptions.requestTypes.length,
  );

  const visibleClients = useMemo(() => {
    return activeClients
      .filter((client) => {
        const intake = intakeRecord(client);
        const sector = readText(intake, ['sector']);
        const requestType = readText(intake, ['requestType', 'request_type']);
        return (
          (!filters.sectors.length || (sector ? filters.sectors.includes(sector) : false)) &&
          (!filters.requestTypes.length ||
            (requestType ? filters.requestTypes.includes(requestType) : false))
        );
      })
      .sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      );
  }, [activeClients, filters]);

  const uploadClientLogo = async (clientId: string, file: File) => {
    const presigned = (
      await api.post<{ url: string; fields: Record<string, string>; s3Key: string }>(
        `/api/clients/${clientId}/logo/upload-url`,
        { contentType: file.type, contentLength: file.size },
      )
    ).data;
    await uploadToS3(presigned, file);
    await api.post(`/api/clients/${clientId}/logo/confirm`, {
      s3Key: presigned.s3Key,
      contentType: file.type,
    });
  };

  const uploadClientDocuments = async (clientId: string, files: File[]) => {
    for (const file of files) {
      const presigned = (
        await api.post<{ url: string; fields: Record<string, string>; s3Key: string }>(
          '/api/engagement/attachments/upload-url',
          {
            clientId,
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            contentLength: file.size,
          },
        )
      ).data;
      await uploadToS3(presigned, file);
      await api.post('/api/engagement/attachments/confirm', {
        clientId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        s3Key: presigned.s3Key,
      });
    }
  };

  const createClient = useMutation({
    mutationFn: async (submission: ClientFormSubmit) => {
      const created = (await api.post<Client>('/api/clients', submission.payload)).data;
      if (submission.logo) await uploadClientLogo(created.id, submission.logo);
      if (submission.documents.length)
        await uploadClientDocuments(created.id, submission.documents);
      return (await api.get<Client>(`/api/clients/${created.id}`)).data;
    },
    onSuccess: (created) => {
      message.success('Client added');
      setModalMode(null);
      setEditingClient(null);
      setSelectedId(created.id);
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client-documents', created.id] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  const updateClient = useMutation({
    mutationFn: async ({ id, submission }: { id: string; submission: ClientFormSubmit }) => {
      const updated = (await api.put<Client>(`/api/clients/${id}`, submission.payload)).data;
      if (submission.logo) await uploadClientLogo(updated.id, submission.logo);
      if (submission.documents.length)
        await uploadClientDocuments(updated.id, submission.documents);
      return (await api.get<Client>(`/api/clients/${updated.id}`)).data;
    },
    onSuccess: (updated) => {
      message.success('Client updated');
      setModalMode(null);
      setEditingClient(null);
      setSelectedId(updated.id);
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client', updated.id] });
      qc.invalidateQueries({ queryKey: ['client-documents', updated.id] });
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
    if (!canCreateClients) return;
    setEditingClient(null);
    setModalMode('create');
  };

  const openEdit = (client: Client) => {
    if (!canManageClients) return;
    setEditingClient(client);
    setModalMode('edit');
  };

  const confirmRemove = (client: Client) => {
    if (!canRemoveClients) return;
    modal.confirm({
      title: `Remove ${client.name}?`,
      content:
        'This archives the client for this tenant. The record can still be recovered from the database.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: () => archiveClient.mutateAsync(client.id),
    });
  };

  const clearFilters = () => setFilters({ sectors: [], requestTypes: [] });

  const filterContent = (
    <div className="client-filter-popover-content">
      <div className="client-filter-popover-head">
        <Typography.Text strong>Filter Clients</Typography.Text>
        {activeFilterCount ? (
          <Button type="link" size="small" onClick={clearFilters}>
            Clear All
          </Button>
        ) : null}
      </div>
      {hasFilterValues ? (
        <>
          <div className="client-filter-field">
            <Typography.Text>Sector</Typography.Text>
            <Select
              mode="multiple"
              allowClear
              placeholder="Any sector"
              maxTagCount="responsive"
              value={filters.sectors}
              options={filterOptions.sectors}
              onChange={(sectors) => setFilters((current) => ({ ...current, sectors }))}
            />
          </div>
          <div className="client-filter-field">
            <Typography.Text>Request Type</Typography.Text>
            <Select
              mode="multiple"
              allowClear
              placeholder="Any request type"
              maxTagCount="responsive"
              value={filters.requestTypes}
              options={filterOptions.requestTypes}
              onChange={(requestTypes) => setFilters((current) => ({ ...current, requestTypes }))}
            />
          </div>
        </>
      ) : (
        <Typography.Text type="secondary">
          No client fields available to filter yet.
        </Typography.Text>
      )}
    </div>
  );

  return (
    <>
      {selectedId ? (
        <ClientProfileView
          client={selectedClient.data}
          loading={selectedClient.isLoading}
          canManageClients={canManageClients}
          canRemoveClients={canRemoveClients}
          onBack={() => setSelectedId(null)}
          onEdit={openEdit}
          onRemove={confirmRemove}
          onUploadLogo={async (client, file) => {
            try {
              await uploadClientLogo(client.id, file);
              message.success('Client logo uploaded');
              qc.invalidateQueries({ queryKey: ['clients'] });
              qc.invalidateQueries({ queryKey: ['client', client.id] });
            } catch (err) {
              message.error(errorMessage(err));
            }
          }}
        />
      ) : (
        <section className="client-page">
          <div className="client-action-bar">
            <Popover arrow={false} content={filterContent} placement="bottomRight" trigger="click">
              <Button
                icon={<FilterOutlined />}
                disabled={clients.isLoading || !activeClients.length}
              >
                {activeFilterCount ? `Filter (${activeFilterCount})` : 'Filter'}
              </Button>
            </Popover>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canCreateClients}
              onClick={openCreate}
            >
              New Client
            </Button>
          </div>

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
              <AddClientCard canCreateClients={canCreateClients} onClick={openCreate} />
            </div>
          ) : (
            <div className="client-empty-state">
              <Empty
                description={
                  activeFilterCount ? 'No clients match these filters.' : 'No clients yet.'
                }
              />
              {activeFilterCount ? (
                <Button onClick={clearFilters}>Clear Filters</Button>
              ) : (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!canCreateClients}
                  onClick={openCreate}
                >
                  Add Client
                </Button>
              )}
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
        onSubmit={(submission) => {
          if (modalMode === 'edit' && editingClient) {
            updateClient.mutate({ id: editingClient.id, submission });
            return;
          }
          createClient.mutate(submission);
        }}
      />
    </>
  );
}

function ClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const intake = intakeRecord(client);
  const tags = portfolioTags(client).slice(0, 3);

  return (
    <article
      className="client-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
    >
      <div className="client-card-topline">
        <Avatar
          shape="square"
          size={52}
          src={client.logoUrl || undefined}
          className="client-avatar"
        >
          {initials(client.name)}
        </Avatar>
        <div className="client-card-title">
          <Typography.Text strong>{client.name}</Typography.Text>
          {client.website ? (
            <a
              href={externalUrl(client.website)}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              <LinkOutlined /> {client.website}
            </a>
          ) : (
            <Typography.Text type="secondary">No website recorded</Typography.Text>
          )}
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
        <Typography.Text type="secondary">Updated {relativeTime(client.updatedAt)}</Typography.Text>
      </div>
    </article>
  );
}

function AddClientCard({
  canCreateClients,
  onClick,
}: {
  canCreateClients: boolean;
  onClick: () => void;
}) {
  const card = (
    <button
      className="client-add-card"
      type="button"
      disabled={!canCreateClients}
      onClick={onClick}
      aria-label="Add new client"
    >
      <span className="client-add-icon">
        <PlusOutlined />
      </span>
      <Typography.Text strong>Add new client</Typography.Text>
    </button>
  );

  if (canCreateClients) return card;
  return <Tooltip title="Only signed-in tenant members can add clients.">{card}</Tooltip>;
}

function ClientProfileView({
  client,
  loading,
  canManageClients,
  canRemoveClients,
  onBack,
  onEdit,
  onRemove,
  onUploadLogo,
}: {
  client?: Client;
  loading: boolean;
  canManageClients: boolean;
  canRemoveClients: boolean;
  onBack: () => void;
  onEdit: (client: Client) => void;
  onRemove: (client: Client) => void;
  onUploadLogo: (client: Client, file: File) => Promise<void>;
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
        <Avatar
          shape="square"
          size={86}
          src={client.logoUrl || undefined}
          className="client-profile-avatar"
        >
          {initials(client.name)}
        </Avatar>
        <div className="client-profile-title">
          <Typography.Title level={3}>{client.name}</Typography.Title>
          <div className="client-profile-contact-strip">
            {client.website ? (
              <a href={externalUrl(client.website)} target="_blank" rel="noreferrer">
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
          <div className="client-tag-row">
            {tags.length ? (
              tags.map((tag) => <Tag key={tag}>{tag}</Tag>)
            ) : (
              <Tag>Intake pending</Tag>
            )}
          </div>
        </div>
        <Space className="client-profile-actions">
          <Upload
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              void onUploadLogo(client, file as File);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>Logo</Button>
          </Upload>
          <Button disabled={!canManageClients} onClick={() => onEdit(client)}>
            Edit
          </Button>
          <Button disabled={!canRemoveClients} onClick={() => onRemove(client)}>
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
            tab.key === 'overview' ? (
              <ClientOverview client={client} intake={intake} />
            ) : tab.key === 'documents' ? (
              <ClientDocumentsTab clientId={client.id} />
            ) : null,
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
    </div>
  );
}

function ClientDocumentsTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const documents = useQuery<ClientAttachment[]>({
    queryKey: ['client-documents', clientId],
    queryFn: async () =>
      (
        await api.get<ClientAttachment[]>('/api/engagement/attachments', {
          params: { clientId },
        })
      ).data,
  });

  const uploadDocument = useMutation({
    mutationFn: async (file: File) => {
      const presigned = (
        await api.post<{ url: string; fields: Record<string, string>; s3Key: string }>(
          '/api/engagement/attachments/upload-url',
          {
            clientId,
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            contentLength: file.size,
          },
        )
      ).data;
      await uploadToS3(presigned, file);
      return (
        await api.post('/api/engagement/attachments/confirm', {
          clientId,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          s3Key: presigned.s3Key,
        })
      ).data;
    },
    onSuccess: () => {
      message.success('Document uploaded');
      qc.invalidateQueries({ queryKey: ['client-documents', clientId] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const deleteDocument = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/engagement/attachments/${id}`)).data,
    onSuccess: () => {
      message.success('Document removed');
      qc.invalidateQueries({ queryKey: ['client-documents', clientId] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  return (
    <div className="client-profile-panel client-tab-panel">
      <div className="client-tab-toolbar">
        <Typography.Title level={5}>Documents</Typography.Title>
        <Upload
          showUploadList={false}
          beforeUpload={(file) => {
            uploadDocument.mutate(file as File);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploadDocument.isPending}>
            Upload
          </Button>
        </Upload>
      </div>
      {documents.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : documents.data?.length ? (
        <div className="client-document-list client-document-list--full">
          {documents.data.map((document) => (
            <div className="client-document-row" key={document.id}>
              <span className="client-document-type">{documentType(document.fileName)}</span>
              <div>
                <Typography.Text>{document.fileName}</Typography.Text>
                <Typography.Text type="secondary">
                  {[formatBytes(document.byteSize), formatDate(document.createdAt)]
                    .filter(Boolean)
                    .join(' | ')}
                </Typography.Text>
              </div>
              <Space>
                <Button
                  aria-label="Download document"
                  icon={<DownloadOutlined />}
                  disabled={!document.downloadUrl}
                  href={document.downloadUrl ?? undefined}
                  target="_blank"
                />
                <Button
                  aria-label="Remove document"
                  icon={<DeleteOutlined />}
                  danger
                  loading={deleteDocument.isPending}
                  onClick={() => deleteDocument.mutate(document.id)}
                />
              </Space>
            </div>
          ))}
        </div>
      ) : (
        <Empty description="No documents uploaded for this client." />
      )}
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

function uniqueOptions(values: Array<string | undefined>): Array<{ label: string; value: string }> {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]))
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ label: value, value }));
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

function externalUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function formatBytes(value: number | null): string {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadToS3(presigned: { url: string; fields: Record<string, string> }, file: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries(presigned.fields)) form.append(key, value);
  form.append('file', file);
  const response = await fetch(presigned.url, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
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
