import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Progress,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';

const { Text } = Typography;

interface ClientIntelMapping {
  id: string;
  clientId: string;
  clientName: string;
  source: string;
  externalId: string;
  externalName: string;
  confidence: number;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ResolutionSummary {
  totalClients: number;
  mappingsCreated: number;
  autoConfirmed: number;
  needsReview: number;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return '#52c41a';
  if (confidence >= 0.5) return '#faad14';
  return '#ff4d4f';
}

export function IntelligenceMappingsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { notification } = AntApp.useApp();
  const [searchParams] = useSearchParams();
  const [clientSearch, setClientSearch] = useState('');
  // Seed the source filter from the URL (?source=fec_employer) so deep links
  // from the intel profile panels (e.g. the FEC "Map an FEC employer →" CTA)
  // land the user directly on the rows they need to confirm.
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(
    searchParams.get('source') ?? undefined,
  );
  const [confirmedFilter, setConfirmedFilter] = useState<'all' | 'confirmed' | 'unconfirmed'>('all');
  const [manualOpen, setManualOpen] = useState(false);

  const mappingsQuery = useQuery<ClientIntelMapping[]>({
    queryKey: ['intelligence-mappings'],
    queryFn: async () =>
      (await api.get<ClientIntelMapping[]>('/api/intelligence/mappings')).data,
    staleTime: 30_000,
  });

  const resolveAllMutation = useMutation({
    mutationFn: async () =>
      (await api.post<ResolutionSummary>('/api/intelligence/resolve-all')).data,
    onSuccess: (summary) => {
      notification.success({
        message: 'Resolution complete',
        description: `${summary.mappingsCreated} mappings · ${summary.autoConfirmed} auto-confirmed · ${summary.needsReview} need review · ${summary.totalClients} clients processed`,
        duration: 6,
      });
      void qc.invalidateQueries({ queryKey: ['intelligence-mappings'] });
    },
    onError: (err) => {
      const detail = apiErrorMessage(err);
      notification.error({ message: 'Resolution failed', description: detail });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ id, confirmed }: { id: string; confirmed: boolean }) =>
      api.patch(`/api/intelligence/mappings/${id}`, { confirmed }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intelligence-mappings'] });
    },
    onError: (err) => {
      notification.error({ message: 'Update failed', description: apiErrorMessage(err) });
    },
  });

  const mappings = mappingsQuery.data ?? [];

  const distinctSources = useMemo(
    () => [...new Set(mappings.map((m) => m.source))].sort(),
    [mappings],
  );

  const filtered = useMemo(() => {
    let data = mappings;
    if (clientSearch.trim()) {
      const q = clientSearch.trim().toLowerCase();
      data = data.filter(
        (m) =>
          m.clientName.toLowerCase().includes(q) ||
          m.externalName.toLowerCase().includes(q),
      );
    }
    if (sourceFilter) data = data.filter((m) => m.source === sourceFilter);
    if (confirmedFilter === 'confirmed') data = data.filter((m) => m.confirmed);
    if (confirmedFilter === 'unconfirmed') data = data.filter((m) => !m.confirmed);
    return data;
  }, [mappings, clientSearch, sourceFilter, confirmedFilter]);

  async function handleConfirmAll() {
    const toConfirm = filtered.filter((m) => m.confidence >= 0.60 && !m.confirmed);
    for (const m of toConfirm) {
      await confirmMutation.mutateAsync({ id: m.id, confirmed: true });
    }
    notification.success({ message: `Confirmed ${toConfirm.length} mapping(s) with ≥60% confidence` });
  }

  async function handleRejectAll() {
    const toReject = filtered.filter((m) => m.confidence < 0.5 && !m.confirmed);
    for (const m of toReject) {
      await confirmMutation.mutateAsync({ id: m.id, confirmed: false });
    }
    notification.success({ message: `Rejected ${toReject.length} low-confidence mapping(s)` });
  }

  const columns: ColumnsType<ClientIntelMapping> = [
    {
      title: 'Client',
      dataIndex: 'clientName',
      ellipsis: true,
      render: (name: string) => <Text strong style={{ fontSize: 13 }}>{name}</Text>,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      width: 120,
      render: (src: string) => <Tag style={{ textTransform: 'capitalize' }}>{src}</Tag>,
    },
    {
      title: 'External Name',
      dataIndex: 'externalName',
      ellipsis: true,
      render: (name: string) => <Text style={{ fontSize: 13 }}>{name}</Text>,
    },
    {
      title: 'Confidence',
      dataIndex: 'confidence',
      width: 140,
      render: (conf: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress
            percent={Math.round(conf * 100)}
            size="small"
            showInfo={false}
            strokeColor={confidenceColor(conf)}
            style={{ flex: 1, margin: 0 }}
          />
          <Text style={{ fontSize: 12, color: confidenceColor(conf), minWidth: 36 }}>
            {Math.round(conf * 100)}%
          </Text>
        </div>
      ),
      sorter: (a, b) => a.confidence - b.confidence,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Confirmed',
      dataIndex: 'confirmed',
      width: 90,
      render: (confirmed: boolean, record) => (
        <Switch
          size="small"
          checked={confirmed}
          loading={confirmMutation.isPending && confirmMutation.variables?.id === record.id}
          onChange={(checked) => confirmMutation.mutate({ id: record.id, confirmed: checked })}
        />
      ),
    },
    {
      title: 'Updated',
      dataIndex: 'updatedAt',
      width: 100,
      render: (d: string) => (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {new Date(d).toLocaleDateString()}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          Intelligence Mappings
        </Typography.Title>
        <span style={{ flex: 1 }} />
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setManualOpen(true)}>
            Add LDA mapping manually
          </Button>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            loading={resolveAllMutation.isPending}
            onClick={() => resolveAllMutation.mutate()}
          >
            Resolve All Clients
          </Button>
        </Space>
      </div>

      {/* Filters + bulk actions */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input.Search
            placeholder="Search client or external name…"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Select
            allowClear
            placeholder="Source"
            style={{ width: 140 }}
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v ?? undefined)}
            options={distinctSources.map((s) => ({ label: s, value: s }))}
          />
          <Select
            style={{ width: 160 }}
            value={confirmedFilter}
            onChange={(v) => setConfirmedFilter(v)}
            options={[
              { label: 'All statuses', value: 'all' },
              { label: 'Confirmed', value: 'confirmed' },
              { label: 'Unconfirmed', value: 'unconfirmed' },
            ]}
          />
          <span style={{ flex: 1 }} />
          <Space>
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => void handleConfirmAll()}
              disabled={!filtered.some((m) => m.confidence >= 0.60 && !m.confirmed)}
            >
              Confirm All ≥ 60%
            </Button>
            <Button
              size="small"
              danger
              onClick={() => void handleRejectAll()}
              disabled={!filtered.some((m) => m.confidence < 0.5 && !m.confirmed)}
            >
              Reject All &lt; 50%
            </Button>
          </Space>
        </div>
      </Card>

      {mappingsQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Table<ClientIntelMapping>
          rowKey="id"
          size="small"
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: 25, showSizeChanger: true }}
          locale={{
            emptyText: (
              <Empty
                description="No mappings found, click 'Resolve All Clients' to run entity resolution"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {filtered.length} mapping{filtered.length !== 1 ? 's' : ''} shown ·{' '}
                  {filtered.filter((m) => m.confirmed).length} confirmed ·{' '}
                  {filtered.filter((m) => m.confidence >= 0.85).length} auto-confirm eligible
                </Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      )}

      <ManualMapModal open={manualOpen} onClose={() => setManualOpen(false)} />
    </div>
  );
}

interface ClientLite {
  id: string;
  name: string;
}

interface LdaSearchResult {
  id: string;
  name: string;
  state: string | null;
  totalFilings: number;
  latestFilingYear: number | null;
  totalSpending: number | null;
  issueCodes: string[];
  similarity: number;
}

function formatSpend(v: number | null): string {
  if (v == null || v <= 0) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

/**
 * Attach an LDA registrant to a client by EXACT lda_client.id. Fuzzy auto-resolve
 * keys off the client's name, so a renamed/legacy variant (e.g. "RAYTHEON
 * TECHNOLOGIES" under a client named "RTX") never surfaces. Here the user searches
 * freely (by name OR id) and pins the right record by its stable id + filing
 * footprint — creating a confirmed mapping the matching/union logic reads at once.
 */
function ManualMapModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { notification } = AntApp.useApp();
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  const clientsQuery = useQuery<ClientLite[]>({
    queryKey: ['clients-lite-for-mapping'],
    queryFn: async () => (await api.get<ClientLite[]>('/api/clients')).data,
    enabled: open,
    staleTime: 60_000,
  });

  const searchQuery = useQuery<LdaSearchResult[]>({
    queryKey: ['lda-client-search', query],
    queryFn: async () =>
      (
        await api.get<LdaSearchResult[]>(
          `/api/intelligence/lda-clients/search?q=${encodeURIComponent(query)}`,
        )
      ).data,
    enabled: open && query.trim().length > 0,
  });

  const attachMutation = useMutation({
    mutationFn: async (r: LdaSearchResult) =>
      api.post(`/api/intelligence/mappings/${clientId}/manual`, {
        source: 'lda',
        externalId: r.id,
        externalName: r.name,
      }),
    onSuccess: (_d, r) => {
      notification.success({
        message: 'Mapping attached',
        description: `"${r.name}" (LDA id ${r.id}) is now a confirmed mapping. Its issue codes feed this client's matching immediately.`,
      });
      void qc.invalidateQueries({ queryKey: ['intelligence-mappings'] });
    },
    onError: (err) => notification.error({ message: 'Attach failed', description: apiErrorMessage(err) }),
  });

  const results = searchQuery.data ?? [];

  const resultColumns: ColumnsType<LdaSearchResult> = [
    { title: 'LDA id', dataIndex: 'id', width: 80, render: (v: string) => <Text code>{v}</Text> },
    {
      title: 'Registrant name',
      dataIndex: 'name',
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 13 }}>{v}</Text>,
    },
    { title: 'State', dataIndex: 'state', width: 64, render: (v: string | null) => v ?? '—' },
    { title: 'Filings', dataIndex: 'totalFilings', width: 72 },
    {
      title: 'Latest',
      dataIndex: 'latestFilingYear',
      width: 72,
      render: (v: number | null) => v ?? '—',
    },
    {
      title: 'Spend',
      dataIndex: 'totalSpending',
      width: 80,
      render: (v: number | null) => formatSpend(v),
    },
    {
      title: 'Issue codes',
      dataIndex: 'issueCodes',
      width: 150,
      render: (codes: string[]) =>
        codes.length ? (
          <span>
            {codes.slice(0, 4).map((c) => (
              <Tag key={c} style={{ marginInlineEnd: 2 }}>
                {c}
              </Tag>
            ))}
            {codes.length > 4 ? <Text type="secondary">+{codes.length - 4}</Text> : null}
          </span>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '',
      key: 'attach',
      width: 90,
      render: (_v, record) => (
        <Button
          size="small"
          type="primary"
          disabled={!clientId}
          loading={attachMutation.isPending && attachMutation.variables?.id === record.id}
          onClick={() => attachMutation.mutate(record)}
        >
          Attach
        </Button>
      ),
    },
  ];

  return (
    <Modal
      title="Attach an LDA registrant manually"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
      width={860}
      afterClose={() => {
        setClientId(undefined);
        setSearchInput('');
        setQuery('');
      }}
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        Use this for registrant variants the automatic matcher can&apos;t find — e.g. a
        renamed or legacy entity (&quot;RAYTHEON TECHNOLOGIES&quot; under a client named
        &quot;RTX&quot;). Pick the client, search the federal LDA registry by name or id, and
        pin the exact record. It&apos;s saved as a confirmed mapping and folded into that
        client&apos;s issue-code footprint right away.
      </Text>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Select
          showSearch
          placeholder="1 · Select the client to attach to"
          style={{ width: '100%' }}
          value={clientId}
          loading={clientsQuery.isLoading}
          onChange={(v) => setClientId(v)}
          optionFilterProp="label"
          options={(clientsQuery.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
        />

        <Input.Search
          placeholder="2 · Search LDA registry by name or id (e.g. raytheon, or 4321)"
          enterButton="Search"
          allowClear
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={(v) => setQuery(v)}
          loading={searchQuery.isFetching}
        />

        {query.trim().length > 0 && (
          <Table<LdaSearchResult>
            rowKey="id"
            size="small"
            loading={searchQuery.isFetching}
            dataSource={results}
            columns={resultColumns}
            pagination={false}
            scroll={{ y: 320 }}
            locale={{
              emptyText: (
                <Empty
                  description="No LDA registrants matched. Try a shorter name or the numeric id."
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />
        )}
      </Space>
    </Modal>
  );
}

function apiErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
