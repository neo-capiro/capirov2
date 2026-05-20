import { useMemo, useState } from 'react';
import {
  FilterOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
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
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import { useMe } from '../../lib/me.js';
import { ClientFormModal } from './ClientFormModal.js';
import { ClientProfilePage } from './ClientProfilePage.js';
import type { Client, ClientFormSubmit } from './clientTypes.js';

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
    },
    onError: (err) => message.error(errorMessage(err)),
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
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const archiveClient = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/clients/${id}`)).data,
    onSuccess: () => {
      message.success('Client removed');
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error(errorMessage(err)),
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

  /* ── Profile view ── */
  if (selectedId) {
    if (selectedClient.isLoading) {
      return (
        <section className="client-page">
          <Skeleton active paragraph={{ rows: 10 }} />
        </section>
      );
    }
    if (!selectedClient.data) {
      return (
        <section className="client-page">
          <Button onClick={() => setSelectedId(null)}>Back to clients</Button>
          <Empty description="Client not found." />
        </section>
      );
    }
    return (
      <>
        <ClientProfilePage
          client={selectedClient.data}
          canManageClients={canManageClients}
          canRemoveClients={canRemoveClients}
          onBack={() => setSelectedId(null)}
          onEdit={openEdit}
          onRemove={confirmRemove}
          onUploadLogo={async (client, file) => {
            await uploadClientLogo(client.id, file);
            qc.invalidateQueries({ queryKey: ['client', client.id] });
            qc.invalidateQueries({ queryKey: ['clients'] });
          }}
          onClientUpdated={() => {
            qc.invalidateQueries({ queryKey: ['client', selectedId] });
            qc.invalidateQueries({ queryKey: ['clients'] });
          }}
        />
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

  /* ── List view ── */
  return (
    <>
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
          size={64}
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
        <DetailPair label="Primary POC" value={formatPoc(intake, client.primaryContactName)} />
        <DetailPair label="Sector" value={readText(intake, ['sector'])} />
        <DetailPair label="Engagement" value={formatEngagement(intake, client.createdAt)} />
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

/** "Sarah Kim, VP Gov't Affairs" — falls back to whichever piece we have. */
function formatPoc(intake: Record<string, unknown>, fallbackName: string | null): string | undefined {
  const name = readText(intake, ['pocName']) ?? fallbackName ?? undefined;
  const title = readText(intake, ['pocTitle']);
  if (name && title) return `${name}, ${title}`;
  return name ?? title;
}

/** "Active · Since Jan 2026" — status comes from intake, "since" from client.createdAt. */
function formatEngagement(intake: Record<string, unknown>, createdAt: string): string | undefined {
  const statusRaw = readText(intake, ['engagement']);
  const status = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1) : undefined;
  const since = (() => {
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  })();
  if (status && since) return `${status} · Since ${since}`;
  return status ?? (since ? `Since ${since}` : undefined);
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

function DetailPair({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="client-detail-pair">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text>{value || '-'}</Typography.Text>
    </div>
  );
}

/* ──────────────────────────────────────────
   Shared helpers (used by list view)
────────────────────────────────────────── */
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

function externalUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
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

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  const d = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}
