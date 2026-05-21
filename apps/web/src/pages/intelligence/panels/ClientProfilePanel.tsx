import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Empty,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  BulbOutlined,
  FileTextOutlined,
  RiseOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  TrophyOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useApi } from '../../../lib/use-api.js';
import { HBar, Sparkline } from '../../../components/charts.js';
import type {
  ClientIntelProfile,
  CongressBill,
  CrmClient,
  FederalRegisterDoc,
  IntelligenceChange,
} from '../types.js';
import {
  formatMoney,
  formatNum,
  issueTagColor,
  trajectoryTag,
} from '../utils.js';

const { Text, Paragraph } = Typography;

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  notable: '#f59e0b',
  info: '#3b82f6',
};

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function deadlineTag(dateStr: string | null | undefined): React.ReactNode {
  const days = daysUntil(dateStr);
  if (days == null) return <Text type="secondary">—</Text>;
  if (days < 0) return <Tag>Closed</Tag>;
  if (days < 7) return <Tag color="red">{days}d left</Tag>;
  if (days < 14) return <Tag color="orange">{days}d left</Tag>;
  return <Tag color="blue">{days}d left</Tag>;
}

export function ClientProfilePanel() {
  const api = useApi();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  /* ── Fetch CRM clients for dropdown ─────────────────────────────────── */
  const clientsQuery = useQuery<CrmClient[]>({
    queryKey: ['crm-clients'],
    queryFn: async () => (await api.get<CrmClient[]>('/api/clients')).data,
    staleTime: 5 * 60 * 1000,
  });

  /* ── Fetch client intelligence profile ──────────────────────────────── */
  const profileQuery = useQuery<ClientIntelProfile>({
    queryKey: ['client-intel-profile', selectedClientId],
    queryFn: async () =>
      (await api.get<ClientIntelProfile>(`/api/intelligence/client-profile/${selectedClientId}`)).data,
    enabled: !!selectedClientId,
    staleTime: 2 * 60 * 1000,
  });

  /* ── Fetch recent changes ───────────────────────────────────────────── */
  const sinceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }, []);

  const changesQuery = useQuery<IntelligenceChange[]>({
    queryKey: ['intel-changes', selectedClientId, sinceDate],
    queryFn: async () =>
      (await api.get<IntelligenceChange[]>('/api/intelligence/changes', {
        params: { clientId: selectedClientId, since: sinceDate },
      })).data,
    enabled: !!selectedClientId,
    staleTime: 2 * 60 * 1000,
  });

  const profile = profileQuery.data;
  const changes = changesQuery.data ?? [];

  const maxCompetitorSpend = useMemo(
    () => Math.max(1, ...(profile?.competitors.topBySpend.map((c) => c.totalSpending) ?? [])),
    [profile],
  );

  const maxAgencySpend = useMemo(
    () => Math.max(1, ...(profile?.contracting.topAgencies.map((a) => a.amount) ?? [])),
    [profile],
  );

  /* ── Client selector options ────────────────────────────────────────── */
  const clientOptions = useMemo(
    () =>
      (clientsQuery.data ?? []).map((c) => ({
        label: c.name,
        value: c.id,
      })),
    [clientsQuery.data],
  );

  /* ── Compute total spend across sources ─────────────────────────────── */
  const totalSpend = profile
    ? (profile.lda.totalSpending ?? 0) + (profile.lobbyIntel.totalSpending ?? 0)
    : null;

  return (
    <div>
      {/* ── Client Selector ──────────────────────────────────────────────── */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space align="center" size={12}>
          <TeamOutlined style={{ fontSize: 18, color: '#2563eb' }} />
          <Text strong style={{ fontSize: 15 }}>Select a Client</Text>
          <Select
            value={selectedClientId ?? undefined}
            placeholder="Choose a CRM client…"
            allowClear
            style={{ width: 320 }}
            options={clientOptions}
            onChange={(v) => setSelectedClientId(v ?? null)}
            loading={clientsQuery.isLoading}
            showSearch
            filterOption={(input, opt) =>
              (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Space>
      </Card>

      {!selectedClientId && (
        <Empty
          description="Select a client above to view their intelligence profile"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ marginTop: 64 }}
        />
      )}

      {profileQuery.isError && (
        <Alert
          type="error"
          message="Failed to load client profile"
          description={(profileQuery.error as Error)?.message}
          style={{ marginBottom: 16 }}
        />
      )}

      {profileQuery.isLoading && selectedClientId && <Skeleton active paragraph={{ rows: 12 }} />}

      {profile && (
        <>
          {/* ── Hero Stats Row ────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Card size="small">
              <Statistic
                title="Trajectory"
                valueRender={() => trajectoryTag(profile.lobbyIntel.trajectory) ?? <Text type="secondary">—</Text>}
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Total Lobby Spend"
                value={totalSpend ?? undefined}
                formatter={(v) => formatMoney(v as number)}
                valueStyle={{ fontSize: 22, color: '#2563eb' }}
                prefix={<RiseOutlined />}
                loading={profileQuery.isLoading}
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Filing Rank"
                value={profile.contracting.rankByContracts ?? undefined}
                valueStyle={{ fontSize: 22 }}
                prefix={<TrophyOutlined />}
                suffix={profile.contracting.rankByContracts ? <Text type="secondary" style={{ fontSize: 12 }}>of contractors</Text> : undefined}
                loading={profileQuery.isLoading}
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Active Issues"
                value={profile.lda.issueCodes.length}
                valueStyle={{ fontSize: 22 }}
                prefix={<FileTextOutlined />}
                loading={profileQuery.isLoading}
              />
            </Card>
          </div>

          {/* ── What's New ────────────────────────────────────────────────── */}
          <Card
            size="small"
            title={<Space><WarningOutlined style={{ color: '#f59e0b' }} /><span>What&apos;s New (last 7 days)</span></Space>}
            style={{ marginBottom: 16 }}
          >
            {changesQuery.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : changes.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {changes.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      padding: '8px 12px',
                      borderLeft: `4px solid ${SEVERITY_COLORS[ch.severity] ?? '#d1d5db'}`,
                      background: 'rgba(0,0,0,0.02)',
                      borderRadius: '0 4px 4px 0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong style={{ fontSize: 13 }}>{ch.title}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(ch.detectedAt).toLocaleDateString()}
                      </Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>{ch.description}</Text>
                    {ch.relatedIssues.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {ch.relatedIssues.slice(0, 5).map((iss) => (
                          <Tag key={iss} color={issueTagColor(iss)} style={{ fontSize: 10, marginRight: 4 }}>{iss}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No recent changes" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          {/* ── Lobbying Landscape + Legislation ──────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 16, marginBottom: 16 }}>
            {/* Left: Lobbying Landscape */}
            <Card
              size="small"
              title={<Space><SafetyCertificateOutlined style={{ color: '#8b5cf6' }} /><span>Lobbying Landscape</span></Space>}
              extra={profile.lda.matched ? <Tag color="green">LDA Matched</Tag> : <Tag>Unmatched</Tag>}
            >
              {profile.lda.issueCodes.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Issue Codes</Text>
                  <Space size={[4, 6]} wrap>
                    {profile.lda.issueCodes.map((code) => (
                      <Tag key={code} color={issueTagColor(code)} style={{ fontSize: 11, marginRight: 0 }}>{code}</Tag>
                    ))}
                  </Space>
                </div>
              )}

              {profile.lda.yearlySpend.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Yearly Lobbying Spend</Text>
                  <Sparkline data={profile.lda.yearlySpend} width={280} height={48} />
                </div>
              )}

              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Stats</Text>
                <Space size={16}>
                  <Statistic title="Total Filings" value={formatNum(profile.lda.totalFilings)} valueStyle={{ fontSize: 16 }} />
                  <Statistic title="Total Spend" value={formatMoney(profile.lda.totalSpending)} valueStyle={{ fontSize: 16 }} />
                </Space>
              </div>

              {profile.contracting.topAgencies.length > 0 && (
                <div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Top Agencies (Contracting)</Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {profile.contracting.topAgencies.slice(0, 5).map((a) => (
                      <div key={a.name} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px', alignItems: 'center', gap: 8 }}>
                        <Tooltip title={a.name}><Text ellipsis style={{ fontSize: 12 }}>{a.name}</Text></Tooltip>
                        <HBar value={a.amount} max={maxAgencySpend} width={100} />
                        <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>{formatMoney(a.amount)}</Text>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Right: Relevant Legislation */}
            <Card
              size="small"
              title={<Space><FileTextOutlined style={{ color: '#2563eb' }} /><span>Relevant Legislation</span></Space>}
              extra={<Tag>{profile.relevantBills.total} total</Tag>}
            >
              {profile.relevantBills.bills.length > 0 ? (
                <Table<CongressBill>
                  size="small"
                  rowKey="id"
                  dataSource={profile.relevantBills.bills.slice(0, 10)}
                  pagination={false}
                  columns={[
                    {
                      title: 'Bill',
                      dataIndex: 'billNumber',
                      width: 90,
                      render: (num: string, r: CongressBill) => (
                        <Tooltip title={r.title}>
                          <Text strong style={{ fontSize: 12 }}>{r.billType.toUpperCase()} {num}</Text>
                        </Tooltip>
                      ),
                    },
                    {
                      title: 'Title',
                      dataIndex: 'title',
                      ellipsis: true,
                      render: (t: string) => <Text style={{ fontSize: 12 }}>{t}</Text>,
                    },
                    {
                      title: 'Sponsor',
                      dataIndex: 'sponsorName',
                      width: 120,
                      render: (n: string | null, r: CongressBill) =>
                        n ? <Text style={{ fontSize: 11 }}>{n} ({r.sponsorParty ?? '?'}-{r.sponsorState ?? ''})</Text> : <Text type="secondary">—</Text>,
                    },
                    {
                      title: 'Latest Action',
                      dataIndex: 'latestActionText',
                      width: 160,
                      ellipsis: true,
                      render: (t: string | null) => <Text type="secondary" style={{ fontSize: 11 }}>{t ?? '—'}</Text>,
                    },
                  ]}
                />
              ) : (
                <Empty description="No relevant bills found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </div>

          {/* ── Regulatory Exposure + Competitive Landscape ───────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 16, marginBottom: 16 }}>
            {/* Left: Regulatory Exposure */}
            <Card
              size="small"
              title={<Space><WarningOutlined style={{ color: '#ef4444' }} /><span>Regulatory Exposure</span></Space>}
              extra={<Tag>{profile.activeRegulations.total} active</Tag>}
            >
              {profile.activeRegulations.documents.length > 0 ? (
                <Table<FederalRegisterDoc>
                  size="small"
                  rowKey="id"
                  dataSource={profile.activeRegulations.documents.slice(0, 10)}
                  pagination={false}
                  columns={[
                    {
                      title: 'Rule',
                      dataIndex: 'documentNumber',
                      width: 100,
                      render: (num: string, r: FederalRegisterDoc) =>
                        r.htmlUrl ? (
                          <a href={r.htmlUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>{num}</a>
                        ) : (
                          <Text style={{ fontSize: 11 }}>{num}</Text>
                        ),
                    },
                    {
                      title: 'Title',
                      dataIndex: 'title',
                      ellipsis: true,
                      render: (t: string) => <Tooltip title={t}><Text style={{ fontSize: 12 }}>{t}</Text></Tooltip>,
                    },
                    {
                      title: 'Comment Deadline',
                      dataIndex: 'commentEndDate',
                      width: 120,
                      render: (d: string | null) => deadlineTag(d),
                    },
                    {
                      title: 'Type',
                      dataIndex: 'type',
                      width: 80,
                      render: (t: string, r: FederalRegisterDoc) =>
                        r.significantRule ? <Tag color="red" style={{ fontSize: 10 }}>{t}</Tag> : <Tag style={{ fontSize: 10 }}>{t}</Tag>,
                    },
                  ]}
                />
              ) : (
                <Empty description="No active regulations" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>

            {/* Right: Competitive Landscape */}
            <Card
              size="small"
              title={<Space><TeamOutlined style={{ color: '#059669' }} /><span>Competitive Landscape</span></Space>}
            >
              {profile.competitors.topBySpend.length > 0 ? (
                <>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>Top Competitors by Spend (shared issues)</Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                    {profile.competitors.topBySpend.slice(0, 8).map((c, i) => (
                      <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '20px 1fr 100px 80px', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>
                        <Tooltip title={`Shared: ${c.sharedIssues.join(', ')}`}>
                          <Text ellipsis style={{ fontSize: 12 }}>{c.name}</Text>
                        </Tooltip>
                        <HBar value={c.totalSpending} max={maxCompetitorSpend} width={100} />
                        <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>{formatMoney(c.totalSpending)}</Text>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Empty description="No competitor data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}

              {profile.competitors.newEntrants.length > 0 && (
                <>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>New Entrants</Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {profile.competitors.newEntrants.slice(0, 5).map((e) => (
                      <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                        <Tag color="cyan" style={{ fontSize: 10, marginRight: 0 }}>NEW</Tag>
                        <Text style={{ fontSize: 12 }}>{e.name}</Text>
                        <Text type="secondary" style={{ fontSize: 10 }}>since {new Date(e.firstFilingDate).toLocaleDateString()}</Text>
                        <Space size={2}>
                          {e.issues.slice(0, 3).map((iss) => (
                            <Tag key={iss} color={issueTagColor(iss)} style={{ fontSize: 9, marginRight: 0 }}>{iss}</Tag>
                          ))}
                        </Space>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── AI Summary ────────────────────────────────────────────────── */}
          {profile.aiSummary && (
            <Card
              size="small"
              title={<Space><BulbOutlined style={{ color: '#f59e0b' }} /><span>AI Intelligence Summary</span></Space>}
              style={{ marginBottom: 16 }}
            >
              <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-wrap' }}>{profile.aiSummary}</Paragraph>
            </Card>
          )}

          {/* ── Last Updated ──────────────────────────────────────────────── */}
          <Text type="secondary" style={{ fontSize: 11 }}>
            Last updated: {new Date(profile.lastUpdated).toLocaleString()}
          </Text>
        </>
      )}
    </div>
  );
}
