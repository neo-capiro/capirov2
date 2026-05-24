import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Drawer,
  Empty,
  List,
  Progress,
  Skeleton,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BulbOutlined,
  DollarOutlined,
  FileTextOutlined,
  GlobalOutlined,
  HeartOutlined,
  MinusOutlined,
  SafetyCertificateOutlined,
  TrophyOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type {
  BriefingWhatsComingItem,
  BriefingWhatsNewItem,
  ClientIntelProfile,
  CongressBill,
  EnhancedBriefing,
  FederalRegisterDoc,
  HealthScore,
  IntelligenceChange,
  IssueLeaderboard,
  LdaFiling,
  LeaderboardRegistrant,
  TrackedBill,
  TrackedBillsResult,
} from './types.js';
import {
  formatMoney,
  formatNum,
  issueTagColor,
  trajectoryTag,
  subjectSectorColor,
  MATCHED_TOPIC_COLOR,
} from './utils.jsx';
import {
  OUTCOME_COLORS,
  OUTCOME_LABELS,
  SECTOR_COLORS,
  SECTOR_LABELS,
  normalizeOutcome,
  normalizeSector,
} from '@capiro/shared';

const { Text, Paragraph } = Typography;

const SEVERITY_COLOR: Record<string, string> = {
  info: '#1890ff',
  notable: '#faad14',
  critical: '#ff4d4f',
};

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function deadlineTag(dateStr: string | null | undefined) {
  const days = daysUntil(dateStr);
  if (days == null) return <Text type="secondary">—</Text>;
  if (days < 0) return <Tag>Closed</Tag>;
  if (days < 7) return <Tag color="red">{days}d left</Tag>;
  if (days < 14) return <Tag color="orange">{days}d left</Tag>;
  return <Tag color="blue">{days}d left</Tag>;
}

function tabLabel(label: string, count: number) {
  return (
    <span>
      {label} <Badge count={count} overflowCount={99} style={{ backgroundColor: count > 0 ? '#1677ff' : '#d9d9d9' }} />
    </span>
  );
}

function trendIcon(trend: string) {
  if (trend === 'improving') return <ArrowUpOutlined style={{ color: '#52c41a', fontSize: 14 }} />;
  if (trend === 'declining') return <ArrowDownOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />;
  return <MinusOutlined style={{ color: '#faad14', fontSize: 14 }} />;
}

interface ClientIntelOverviewProps {
  clientId: string;
  clientName: string;
}

export function ClientIntelOverview({ clientId, clientName }: ClientIntelOverviewProps) {
  const api = useApi();
  const [activeTab, setActiveTab] = useState('lda');
  const [sourceDrawer, setSourceDrawer] = useState<{ title: string; data: unknown } | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [briefing, setBriefing] = useState<EnhancedBriefing | null>(null);

  const profileQuery = useQuery<ClientIntelProfile>({
    queryKey: ['client-intel-profile', clientId],
    queryFn: async () =>
      (await api.get<ClientIntelProfile>(`/api/intelligence/client-profile/${clientId!}`)).data,
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
  });

  const sinceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }, []);

  const changesQuery = useQuery<IntelligenceChange[]>({
    queryKey: ['intel-changes', clientId, sinceDate],
    queryFn: async () =>
      (
        await api.get<IntelligenceChange[]>('/api/intelligence/changes', {
          params: { clientId, since: sinceDate },
        })
      ).data,
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
  });

  const roiQuery = useQuery<{ lobbySpend: number; contractWins: number; roi: number } | null>({
    queryKey: ['client-lobbying-roi', clientId],
    queryFn: async () => {
      try {
        return (
          await api.get<{ lobbySpend: number; contractWins: number; roi: number }>(
            `/api/intelligence/clients/${clientId!}/lobbying-roi`,
          )
        ).data;
      } catch {
        return null;
      }
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const healthScoreQuery = useQuery<HealthScore | null>({
    queryKey: ['client-health-score', clientId],
    queryFn: async () => {
      try {
        return (await api.get<HealthScore>(`/api/intelligence/clients/${clientId!}/health-score`)).data;
      } catch {
        return null;
      }
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const trackedBillsQuery = useQuery<TrackedBillsResult | null>({
    queryKey: ['tracked-bills', clientId],
    queryFn: async () => {
      try {
        return (await api.get<TrackedBillsResult>(`/api/intelligence/clients/${clientId!}/tracked-bills`)).data;
      } catch {
        return null;
      }
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const profile = profileQuery.data;
  const changes = changesQuery.data ?? [];

  const avgConfidence = useMemo(() => {
    if (!profile) return null;
    const scores = [
      profile.lda.matched ? profile.lda.confidence : null,
    ].filter((v): v is number => v !== null);
    if (!scores.length) return null;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
  }, [profile]);

  async function handleGenerateBriefing() {
    if (!clientId) return;
    setGeneratingBriefing(true);
    try {
      const res = await api.get<EnhancedBriefing>(`/api/intelligence/briefing/${clientId}`);
      setBriefing(res.data);
    } finally {
      setGeneratingBriefing(false);
    }
  }

  if (profileQuery.isError) {
    return (
      <Alert
        type="error"
        message="Failed to load client intelligence profile"
        description={(profileQuery.error as Error)?.message}
      />
    );
  }

  const healthScore = healthScoreQuery.data;
  const trackedBillsCount = trackedBillsQuery.data?.total ?? 0;

  return (
    <div>
      {/* Match banner */}
      {profile && (
        <div style={{ marginBottom: 16 }}>
          <Space size={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>{clientName}</Text>
            <Tag color={profile.lda.matched ? 'green' : 'default'}>
              {profile.lda.matched ? 'LDA Matched' : 'Unmatched'}
            </Tag>
          </Space>
        </div>
      )}

      {profileQuery.isLoading && <Skeleton active paragraph={{ rows: 12 }} />}

      {profile && (
        <>
          {/* Hero stats row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <Card size="small">
              <Statistic
                title="Trajectory"
                valueRender={() =>
                  trajectoryTag(profile.lobbyIntel.trajectory) ?? (
                    <Text type="secondary">—</Text>
                  )
                }
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Total LDA Spend"
                value={profile.lda.totalSpending ?? 0}
                formatter={(v) => formatMoney(v as number)}
                valueStyle={{ fontSize: 20, color: '#2563eb' }}
                prefix={<DollarOutlined />}
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Federal Contracts"
                value={profile.contracting.totalContracts ?? 0}
                formatter={(v) => formatNum(v as number)}
                valueStyle={{ fontSize: 20 }}
                prefix={<GlobalOutlined />}
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Active Bills"
                value={profile.relevantBills.total}
                formatter={(v) => formatNum(v as number)}
                valueStyle={{ fontSize: 20 }}
                prefix={<FileTextOutlined />}
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Active Regulations"
                value={profile.activeRegulations.total}
                formatter={(v) => formatNum(v as number)}
                valueStyle={{ fontSize: 20 }}
                prefix={<SafetyCertificateOutlined />}
              />
            </Card>
            <Card size="small">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Mapping Confidence</Text>
                {avgConfidence !== null ? (
                  <Progress
                    type="circle"
                    percent={avgConfidence}
                    size={56}
                    strokeColor={avgConfidence >= 85 ? '#52c41a' : avgConfidence >= 50 ? '#faad14' : '#ff4d4f'}
                  />
                ) : (
                  <Text type="secondary">—</Text>
                )}
              </div>
            </Card>

            {/* Engagement Health Score */}
            <Card size="small">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <HeartOutlined style={{ marginRight: 4 }} />
                  Engagement Health
                </Text>
                {healthScoreQuery.isLoading ? (
                  <Skeleton.Button active size="small" style={{ width: 56, height: 56 }} />
                ) : healthScore ? (
                  <Tooltip
                    title={
                      <div style={{ fontSize: 12 }}>
                        <div>Meetings: {healthScore.breakdown.meetings}</div>
                        <div>Emails: {healthScore.breakdown.emails}</div>
                        <div>Tasks done: {healthScore.breakdown.tasksCompleted}</div>
                        <div>Debriefs: {healthScore.breakdown.debriefs}</div>
                        <div>Outreach: {healthScore.breakdown.outreachSent}</div>
                        <div style={{ color: '#aaa', marginTop: 4 }}>{healthScore.period} window</div>
                      </div>
                    }
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Progress
                        type="circle"
                        percent={healthScore.score}
                        size={56}
                        strokeColor={
                          healthScore.score >= 70 ? '#52c41a'
                            : healthScore.score >= 30 ? '#faad14'
                            : '#ff4d4f'
                        }
                      />
                      {trendIcon(healthScore.trend)}
                    </div>
                  </Tooltip>
                ) : (
                  <Text type="secondary">—</Text>
                )}
              </div>
            </Card>

            {roiQuery.data && (
              <Card size="small">
                <Statistic
                  title="Lobbying ROI"
                  value={roiQuery.data.roi}
                  suffix="x"
                  valueStyle={{ fontSize: 20, color: roiQuery.data.roi >= 1 ? '#52c41a' : '#ff4d4f' }}
                  prefix={<DollarOutlined />}
                />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {formatMoney(roiQuery.data.lobbySpend)} spent → {formatMoney(roiQuery.data.contractWins)} won
                </Text>
              </Card>
            )}
          </div>

          {/* What's new this week */}
          <Card
            size="small"
            title={
              <Space>
                <WarningOutlined style={{ color: '#f59e0b' }} />
                <span>What&apos;s New This Week</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            {changesQuery.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : changes.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {changes.slice(0, 5).map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      padding: '8px 12px',
                      borderLeft: `4px solid ${SEVERITY_COLOR[ch.severity] ?? '#d1d5db'}`,
                      background: 'rgba(0,0,0,0.02)',
                      borderRadius: '0 4px 4px 0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text strong style={{ fontSize: 13 }}>{ch.title}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(ch.detectedAt).toLocaleDateString()}
                      </Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>{ch.description}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No recent changes" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          {/* Tabbed detail sections */}
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'lda',
                label: tabLabel('LDA Filings', profile.lda.totalFilings),
                children: <LdaTab profile={profile} />,
              },
              {
                key: 'contracting',
                label: tabLabel('Federal Contracts', profile.contracting.totalContracts ?? 0),
                children: <ContractingTab profile={profile} />,
              },
              {
                key: 'bills',
                label: tabLabel('Related Bills', profile.relevantBills.total),
                children: <BillsTab profile={profile} onSourceClick={setSourceDrawer} />,
              },
              {
                key: 'tracked-bills',
                label: tabLabel('Tracked Bills', trackedBillsCount),
                children: <TrackedBillsTab clientId={clientId!} />,
              },
              {
                key: 'regulations',
                label: tabLabel('Regulations', profile.activeRegulations.total),
                children: <RegulationsTab profile={profile} />,
              },
              {
                key: 'competitors',
                label: tabLabel(
                  'Competitors',
                  profile.competitors.topBySpend.length + profile.competitors.newEntrants.length,
                ),
                children: <CompetitorsTab profile={profile} clientId={clientId!} />,
              },
              {
                key: 'briefing',
                label: 'AI Briefing',
                children: (
                  <AiBriefingTab
                    profile={profile}
                    briefing={briefing}
                    generating={generatingBriefing}
                    onGenerate={() => void handleGenerateBriefing()}
                  />
                ),
              },
              {
                key: 'district-nexus',
                label: 'District Nexus',
                children: <DistrictNexusTab clientId={clientId} />,
              },
              {
                key: 'lifecycle',
                label: 'Bill → Regulation',
                children: <LifecycleTab clientId={clientId} />,
              },
              {
                key: 'research',
                label: 'GAO / CRS',
                children: <ResearchTab clientId={clientId} />,
              },
            ]}
          />
        </>
      )}

      <Drawer
        title={sourceDrawer?.title ?? 'Source Record'}
        open={!!sourceDrawer}
        onClose={() => setSourceDrawer(null)}
        width={500}
      >
        {sourceDrawer && (
          <pre style={{ fontSize: 12, overflow: 'auto' }}>
            {JSON.stringify(sourceDrawer.data, null, 2)}
          </pre>
        )}
      </Drawer>
    </div>
  );
}

function LdaTab({ profile }: { profile: ClientIntelProfile }) {
  const { lda } = profile;
  if (!lda.matched) {
    return <Empty description="No LDA match found" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 32 }} />;
  }

  const columns = [
    { title: 'Year', dataIndex: 'filingYear', width: 70 },
    { title: 'Period', dataIndex: 'filingPeriod', width: 90 },
    { title: 'Type', dataIndex: 'filingType', width: 80 },
    { title: 'Registrant', dataIndex: 'registrantName', ellipsis: true },
    {
      title: 'Income',
      dataIndex: 'income',
      width: 100,
      render: (v: number | null) => <Text>{formatMoney(v)}</Text>,
    },
    {
      title: 'Issues',
      dataIndex: 'issueCodes',
      render: (codes: string[]) => (
        <Space size={[2, 2]} wrap>
          {codes.slice(0, 4).map((c) => (
            <Tag key={c} color={issueTagColor(c)} style={{ fontSize: 10 }}>{c}</Tag>
          ))}
          {codes.length > 4 && <Tag style={{ fontSize: 10 }}>+{codes.length - 4}</Tag>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <Statistic title="Total Filings" value={formatNum(lda.totalFilings)} />
        <Statistic title="Total Spend" value={formatMoney(lda.totalSpending)} />
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Issue Codes</Text>
          <div style={{ marginTop: 4 }}>
            <Space wrap size={[4, 4]}>
              {lda.issueCodes.map((c) => (
                <Tag key={c} color={issueTagColor(c)} style={{ fontSize: 11 }}>{c}</Tag>
              ))}
            </Space>
          </div>
        </div>
      </div>
      <Table<LdaFiling>
        rowKey="id"
        size="small"
        dataSource={lda.recentFilings}
        columns={columns}
        pagination={{ pageSize: 10, showSizeChanger: false }}
      />
    </div>
  );
}

function ContractingTab({ profile }: { profile: ClientIntelProfile }) {
  const { contracting } = profile;
  if (!contracting.matched) {
    return <Empty description="No contracting match found" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 32 }} />;
  }

  const agencyColumns = [
    { title: 'Agency', dataIndex: 'name', ellipsis: true },
    {
      title: 'Amount',
      dataIndex: 'amount',
      width: 130,
      render: (v: number) => <Text strong>{formatMoney(v)}</Text>,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <Statistic title="Total Contracts" value={formatNum(contracting.totalContracts)} />
        <Statistic title="Rank" value={contracting.rankByContracts ?? '—'} suffix={contracting.rankByContracts ? ' of contractors' : ''} />
        <Statistic title="No-Bid Total" value={formatMoney(contracting.noBidTotal)} />
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        Top Agencies by Award Amount
      </Text>
      <Table
        rowKey="name"
        size="small"
        dataSource={contracting.topAgencies}
        columns={agencyColumns}
        pagination={{ pageSize: 10, showSizeChanger: false }}
      />
    </div>
  );
}

function BillsTab({
  profile,
  onSourceClick,
}: {
  profile: ClientIntelProfile;
  onSourceClick: (src: { title: string; data: unknown }) => void;
}) {
  const columns = [
    {
      title: 'Bill',
      width: 100,
      render: (_: unknown, r: CongressBill) => (
        <Tooltip title={r.title}>
          <Text strong style={{ fontSize: 12 }}>
            {r.billType.toUpperCase()} {r.billNumber}
          </Text>
        </Tooltip>
      ),
    },
    { title: 'Title', dataIndex: 'title', ellipsis: true },
    {
      title: 'Sponsor',
      dataIndex: 'sponsorName',
      width: 140,
      render: (n: string | null, r: CongressBill) =>
        n ? (
          <Text style={{ fontSize: 11 }}>
            {n} ({r.sponsorParty ?? '?'}-{r.sponsorState ?? ''})
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Policy Area',
      dataIndex: 'policyArea',
      width: 120,
      render: (v: string | null) => {
        if (!v) return <Text type="secondary">—</Text>;
        const c = subjectSectorColor(v);
        return c ? (
          <Tag color={c} style={{ fontSize: 10 }}>{v}</Tag>
        ) : (
          <Tag style={{ fontSize: 10 }}>{v}</Tag>
        );
      },
    },
    {
      title: 'Latest Action',
      dataIndex: 'latestActionText',
      ellipsis: true,
      render: (t: string | null) => (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {t ?? '—'}
        </Text>
      ),
    },
    {
      title: '',
      width: 60,
      render: (_: unknown, r: CongressBill) => (
        <Button
          size="small"
          type="link"
          onClick={() => onSourceClick({ title: r.title, data: r })}
        >
          Detail
        </Button>
      ),
    },
  ];

  return (
    <Table<CongressBill>
      rowKey="id"
      size="small"
      dataSource={profile.relevantBills.bills}
      columns={columns}
      pagination={{ pageSize: 15, showSizeChanger: false }}
      locale={{ emptyText: <Empty description="No relevant bills" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
    />
  );
}

function TrackedBillsTab({ clientId }: { clientId: string }) {
  const api = useApi();

  const query = useQuery<TrackedBillsResult | null>({
    queryKey: ['tracked-bills', clientId],
    queryFn: async () => {
      try {
        return (await api.get<TrackedBillsResult>(`/api/intelligence/clients/${clientId}/tracked-bills`)).data;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const data = query.data;

  const columns = [
    {
      title: 'Identifier',
      dataIndex: 'identifier',
      width: 130,
      render: (id: string) => <Text strong style={{ fontSize: 12 }}>{id}</Text>,
    },
    { title: 'Title', dataIndex: 'title', ellipsis: true },
    {
      title: 'Latest Action',
      dataIndex: 'latestActionText',
      ellipsis: true,
      render: (t: string | null) => (
        <Text type="secondary" style={{ fontSize: 11 }}>{t ?? '—'}</Text>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'latestActionDate',
      width: 110,
      defaultSortOrder: 'descend' as const,
      sorter: (a: TrackedBill, b: TrackedBill) => {
        if (!a.latestActionDate) return 1;
        if (!b.latestActionDate) return -1;
        return new Date(a.latestActionDate).getTime() - new Date(b.latestActionDate).getTime();
      },
      render: (d: string | null) => d ? new Date(d).toLocaleDateString() : '—',
    },
    {
      title: 'Sponsor',
      dataIndex: 'sponsorName',
      width: 140,
      render: (n: string | null, r: TrackedBill) =>
        n ? (
          <Text style={{ fontSize: 11 }}>{n}{r.sponsorParty ? ` (${r.sponsorParty})` : ''}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Subjects',
      dataIndex: 'subjectNames',
      render: (subjects: string[]) => (
        <Space wrap size={[2, 2]}>
          {subjects.slice(0, 3).map((s) => {
            const c = subjectSectorColor(s);
            return c ? (
              <Tag key={s} color={c} style={{ fontSize: 10 }}>{s}</Tag>
            ) : (
              <Tag key={s} style={{ fontSize: 10 }}>{s}</Tag>
            );
          })}
          {subjects.length > 3 && <Tag style={{ fontSize: 10 }}>+{subjects.length - 3}</Tag>}
        </Space>
      ),
    },
  ];

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;

  if (!data || data.bills.length === 0) {
    return <Empty description="No tracked bills found" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 32 }} />;
  }

  return (
    <div>
      {data.issueCodes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Matched issue codes: </Text>
          <Space wrap size={[4, 4]}>
            {data.issueCodes.map((c) => (
              <Tag key={c} color={issueTagColor(c)} style={{ fontSize: 11 }}>{c}</Tag>
            ))}
          </Space>
        </div>
      )}
      <Table<TrackedBill>
        rowKey="identifier"
        size="small"
        dataSource={data.bills}
        columns={columns}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="No tracked bills" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </div>
  );
}

function RegulationsTab({ profile }: { profile: ClientIntelProfile }) {
  const columns = [
    {
      title: 'Doc #',
      dataIndex: 'documentNumber',
      width: 110,
      render: (num: string, r: FederalRegisterDoc) =>
        r.htmlUrl ? (
          <a href={r.htmlUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
            {num}
          </a>
        ) : (
          <Text style={{ fontSize: 11 }}>{num}</Text>
        ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      ellipsis: true,
      render: (t: string) => (
        <Tooltip title={t}>
          <Text style={{ fontSize: 12 }}>{t}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Agencies',
      dataIndex: 'agencyNames',
      width: 160,
      render: (names: string[]) => (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {names.slice(0, 2).join(', ')}
          {names.length > 2 ? ` +${names.length - 2}` : ''}
        </Text>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      width: 90,
      render: (t: string, r: FederalRegisterDoc) =>
        r.significantRule ? (
          <Tag color="red" style={{ fontSize: 10 }}>
            {t}
          </Tag>
        ) : (
          <Tag style={{ fontSize: 10 }}>{t}</Tag>
        ),
    },
    {
      title: 'Comment Deadline',
      dataIndex: 'commentEndDate',
      width: 130,
      render: (d: string | null) => deadlineTag(d),
    },
  ];

  return (
    <Table<FederalRegisterDoc>
      rowKey="id"
      size="small"
      dataSource={profile.activeRegulations.documents}
      columns={columns}
      pagination={{ pageSize: 15, showSizeChanger: false }}
      locale={{ emptyText: <Empty description="No active regulations" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
    />
  );
}

function IssueLeaderboardSection({
  issueCode,
  clientName,
}: {
  issueCode: string;
  clientName: string;
}) {
  const api = useApi();
  const navigate = useNavigate();

  const query = useQuery<IssueLeaderboard>({
    queryKey: ['issue-leaderboard', issueCode],
    queryFn: async () =>
      (await api.get<IssueLeaderboard>(`/api/intelligence/issues/${issueCode}/leaderboard`)).data,
    staleTime: 5 * 60 * 1000,
  });

  const data = query.data;

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (!data || data.registrants.length === 0) {
    return <Empty description="No registrant data" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const clientNameLower = clientName.toLowerCase();

  const columns = [
    {
      title: '',
      width: 50,
      render: (_: unknown, r: LeaderboardRegistrant) =>
        r.isNewEntrant ? <Tag color="red" style={{ fontSize: 10 }}>NEW</Tag> : null,
    },
    {
      title: 'Registrant',
      dataIndex: 'name',
      ellipsis: true,
      render: (name: string) => {
        const nameLower = name.toLowerCase();
        const isCurrent =
          nameLower.includes(clientNameLower.split(' ')[0] ?? '') ||
          clientNameLower.includes(nameLower.split(' ')[0] ?? '');
        return (
          <Text strong={isCurrent} style={{ fontSize: 12, color: isCurrent ? '#1677ff' : undefined }}>
            {name}{isCurrent ? ' ★' : ''}
          </Text>
        );
      },
    },
    {
      title: 'Filings',
      dataIndex: 'filingCount',
      width: 80,
      render: (v: number) => <Text strong>{formatNum(v)}</Text>,
    },
    {
      title: 'Income',
      dataIndex: 'totalIncome',
      width: 120,
      render: (v: number) => <Text>{formatMoney(v)}</Text>,
    },
    {
      title: 'Shared Lobbyists',
      dataIndex: 'sharedLobbyists',
      width: 130,
      render: (lobbyists: string[]) =>
        lobbyists.length > 0 ? (
          <Tooltip title={lobbyists.join(', ')}>
            <Tag color="orange" style={{ fontSize: 10 }}>{lobbyists.length} shared</Tag>
          </Tooltip>
        ) : null,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {data.totalFilings.toLocaleString()} total filings (2y) · {data.issueName}
        </Text>
        <Button
          size="small"
          type="link"
          icon={<TrophyOutlined />}
          onClick={() => navigate(`/intelligence/issues/${issueCode}`)}
        >
          View full leaderboard →
        </Button>
      </div>
      <Table<LeaderboardRegistrant>
        rowKey="name"
        size="small"
        dataSource={data.registrants.slice(0, 10)}
        columns={columns}
        pagination={false}
      />
    </div>
  );
}

function CompetitorsTab({
  profile,
  clientId,
}: {
  profile: ClientIntelProfile;
  clientId: string;
}) {
  const { competitors } = profile;
  const issueCodes = profile.lda.issueCodes;

  return (
    <div>
      {competitors.topBySpend.length > 0 && (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            Top Competitors by Spend
          </Text>
          <Table
            rowKey="name"
            size="small"
            dataSource={competitors.topBySpend}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              { title: 'Name', dataIndex: 'name', ellipsis: true },
              {
                title: 'Total Spend',
                dataIndex: 'totalSpending',
                width: 120,
                render: (v: number) => <Text strong>{formatMoney(v)}</Text>,
              },
              {
                title: 'Shared Issues',
                dataIndex: 'sharedIssues',
                render: (issues: string[]) => (
                  <Space wrap size={[2, 2]}>
                    {issues.slice(0, 5).map((iss) => (
                      <Tag key={iss} color={issueTagColor(iss)} style={{ fontSize: 10 }}>
                        {iss}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
            ]}
            style={{ marginBottom: 24 }}
          />
        </>
      )}

      {competitors.newEntrants.length > 0 && (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            New Entrants
          </Text>
          <Table
            rowKey="name"
            size="small"
            dataSource={competitors.newEntrants}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              {
                title: '',
                width: 60,
                render: () => <Tag color="cyan" style={{ fontSize: 10 }}>NEW</Tag>,
              },
              { title: 'Name', dataIndex: 'name', ellipsis: true },
              {
                title: 'First Filing',
                dataIndex: 'firstFilingDate',
                width: 110,
                render: (d: string) => new Date(d).toLocaleDateString(),
              },
              {
                title: 'Issues',
                dataIndex: 'issues',
                render: (issues: string[]) => (
                  <Space size={[2, 2]} wrap>
                    {issues.slice(0, 4).map((iss) => (
                      <Tag key={iss} color={issueTagColor(iss)} style={{ fontSize: 10 }}>
                        {iss}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
            ]}
            style={{ marginBottom: 24 }}
          />
        </>
      )}

      {/* Per-issue leaderboard sections */}
      {issueCodes.length > 0 && (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            Issue Code Leaderboards
          </Text>
          <Collapse
            items={issueCodes.slice(0, 8).map((code) => ({
              key: code,
              label: (
                <Space>
                  <Tag color={issueTagColor(code)} style={{ fontSize: 10 }}>{code}</Tag>
                  <Text style={{ fontSize: 12 }}>Competitor landscape</Text>
                </Space>
              ),
              children: (
                <IssueLeaderboardSection issueCode={code} clientName={profile.client.name} />
              ),
            }))}
          />
        </>
      )}

      {competitors.topBySpend.length === 0 && competitors.newEntrants.length === 0 && issueCodes.length === 0 && (
        <Empty description="No competitor data" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 32 }} />
      )}
    </div>
  );
}

function AiBriefingTab({
  profile,
  briefing,
  generating,
  onGenerate,
}: {
  profile: ClientIntelProfile;
  briefing: EnhancedBriefing | null;
  generating: boolean;
  onGenerate: () => void;
}) {
  return (
    <Card
      size="small"
      extra={
        <Button
          size="small"
          icon={<BulbOutlined />}
          onClick={onGenerate}
          loading={generating}
        >
          {briefing ? 'Regenerate' : 'Generate'} Briefing
        </Button>
      }
    >
      {generating ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin tip="Generating AI briefing…" />
        </div>
      ) : briefing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Hero summary */}
          <Paragraph strong style={{ fontSize: 14, margin: 0 }}>
            {briefing.heroSummary}
          </Paragraph>

          {/* What's New */}
          {briefing.whatsNew.length > 0 && (
            <div>
              <Text strong style={{ fontSize: 13 }}>What&apos;s New (24h)</Text>
              <Timeline
                style={{ marginTop: 12 }}
                items={briefing.whatsNew.map((item: BriefingWhatsNewItem, idx: number) => ({
                  key: idx,
                  color: 'blue',
                  children: (
                    <div>
                      <Space size={4} wrap>
                        <Text strong style={{ fontSize: 13 }}>{item.title}</Text>
                        <Tag style={{ fontSize: 10 }}>{item.source}</Tag>
                      </Space>
                      {item.detail && (
                        <Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 0 0' }}>
                          {item.detail}
                        </Paragraph>
                      )}
                      {item.citation && (
                        <Text type="secondary" style={{ fontSize: 11 }}>{item.citation}</Text>
                      )}
                    </div>
                  ),
                }))}
              />
            </div>
          )}

          {/* What's Coming */}
          {briefing.whatsComing.length > 0 && (
            <div>
              <Text strong style={{ fontSize: 13 }}>What&apos;s Coming (14d)</Text>
              <List
                size="small"
                style={{ marginTop: 8 }}
                dataSource={briefing.whatsComing}
                renderItem={(item: BriefingWhatsComingItem) => (
                  <List.Item
                    extra={<Tag color="blue">{item.date}</Tag>}
                  >
                    <Space>
                      <Tag color="purple" style={{ fontSize: 10 }}>{item.type}</Tag>
                      <div>
                        <Text style={{ fontSize: 12 }}>{item.title}</Text>
                        {item.action && (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                            {item.action}
                          </Text>
                        )}
                      </div>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          )}

          {/* Suggested Actions */}
          {briefing.suggestedActions.length > 0 && (
            <div>
              <Text strong style={{ fontSize: 13 }}>Suggested Actions</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {briefing.suggestedActions.map((action, idx) => (
                  <Alert
                    key={idx}
                    type={
                      action.urgency === 'high' ? 'error'
                        : action.urgency === 'medium' ? 'warning'
                        : 'info'
                    }
                    showIcon
                    message={
                      <Space>
                        <Tag
                          color={action.urgency === 'high' ? 'red' : action.urgency === 'medium' ? 'gold' : 'blue'}
                          style={{ fontSize: 10 }}
                        >
                          {action.urgency.toUpperCase()}
                        </Tag>
                        <Text strong style={{ fontSize: 13 }}>{action.action}</Text>
                      </Space>
                    }
                    description={action.rationale}
                  />
                ))}
              </div>
            </div>
          )}

          <Text type="secondary" style={{ fontSize: 10 }}>
            Generated: {new Date(briefing.generatedAt).toLocaleString()}
          </Text>
        </div>
      ) : profile.aiSummary ? (
        <Paragraph style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>
          {profile.aiSummary}
        </Paragraph>
      ) : (
        <Empty
          description="No AI briefing yet — click 'Generate Briefing' to create one"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </Card>
  );
}

// ─── Phase 2 cross-reference tabs ───────────────────────────────────────────

interface DistrictNexusResult {
  capabilities: Array<{
    capabilityId: string;
    capabilityName: string;
    capabilitySector: string | null;
    districtNexus: string | null;
    districts: Array<{
      id: string;
      congress: number;
      state: string;
      district: string;
      totalPopulation: number | null;
      medianHouseholdIncome: number | null;
      laborForceSize: number | null;
      unemploymentRate: number | null;
      percentVeteran: number | null;
      topIndustries: Array<{ name?: string; employment?: number; percent?: number }>;
      dataYear: number;
    }>;
  }>;
}

function DistrictNexusTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const query = useQuery<DistrictNexusResult>({
    queryKey: ['district-nexus', clientId],
    queryFn: async () =>
      (await api.get<DistrictNexusResult>(`/api/intelligence/clients/${clientId}/district-nexus`)).data,
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;
  const caps = query.data?.capabilities ?? [];
  const withDistricts = caps.filter((c) => c.districts.length > 0);
  if (!withDistricts.length) {
    return (
      <Empty
        description={
          caps.length
            ? 'No capabilities have parseable state-district codes in their district nexus text. Add codes like "CA-52" or "TX-3".'
            : 'This client has no capabilities yet.'
        }
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ marginTop: 32 }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {withDistricts.map((cap) => (
        <Card key={cap.capabilityId} size="small" title={
          <Space>
            <Text strong>{cap.capabilityName}</Text>
            {cap.capabilitySector && <Tag>{cap.capabilitySector}</Tag>}
            <Tag color="blue" style={{ fontSize: 10 }}>{cap.districts.length} district{cap.districts.length === 1 ? '' : 's'}</Tag>
          </Space>
        }>
          {cap.districtNexus && (
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              {cap.districtNexus}
            </Paragraph>
          )}
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={cap.districts}
            columns={[
              {
                title: 'District',
                width: 110,
                render: (_: unknown, d) => <Text strong>{d.state}-{d.district}</Text>,
              },
              { title: 'Congress', dataIndex: 'congress', width: 90 },
              {
                title: 'Population',
                dataIndex: 'totalPopulation',
                width: 110,
                render: (v: number | null) => v ? formatNum(v) : '—',
              },
              {
                title: 'Median Income',
                dataIndex: 'medianHouseholdIncome',
                width: 130,
                render: (v: number | null) => v ? formatMoney(v) : '—',
              },
              {
                title: 'Labor Force',
                dataIndex: 'laborForceSize',
                width: 110,
                render: (v: number | null) => v ? formatNum(v) : '—',
              },
              {
                title: 'Unemp.',
                dataIndex: 'unemploymentRate',
                width: 80,
                render: (v: number | null) => v != null ? `${v.toFixed(1)}%` : '—',
              },
              {
                title: 'Veteran %',
                dataIndex: 'percentVeteran',
                width: 90,
                render: (v: number | null) => v != null ? `${v.toFixed(1)}%` : '—',
              },
              {
                title: 'Top Industries',
                dataIndex: 'topIndustries',
                render: (inds: Array<{ name?: string }>) => (
                  <Space wrap size={[2, 2]}>
                    {inds.slice(0, 3).map((i, idx) => (
                      <Tag key={idx} style={{ fontSize: 10 }}>{i.name ?? '?'}</Tag>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      ))}
    </div>
  );
}

interface LifecycleLink {
  bill: { identifier: string; title: string; latestActionDate: string | null };
  regulations: Array<{
    documentNumber: string;
    type: string;
    title: string;
    agencyNames: string[];
    publicationDate: string;
    commentEndDate: string | null;
    significantRule: boolean;
    htmlUrl: string | null;
    matchedTopics: string[];
  }>;
}

interface LifecycleResult {
  links: LifecycleLink[];
  totalBills: number;
  totalRegulations: number;
}

function LifecycleTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const query = useQuery<LifecycleResult>({
    queryKey: ['bill-regulation-links', clientId],
    queryFn: async () =>
      (
        await api.get<LifecycleResult>(
          `/api/intelligence/clients/${clientId}/bill-regulation-links`,
        )
      ).data,
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;
  const data = query.data;
  if (!data || !data.links.length) {
    return (
      <Empty
        description="No regulatory documents match this client's tracked bills yet."
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ marginTop: 32 }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {data.links.length} of {data.totalBills} tracked bills have related Federal Register activity.
      </Text>
      {data.links.map((link) => (
        <Card
          key={link.bill.identifier}
          size="small"
          title={
            <Space>
              <Text strong style={{ fontSize: 12 }}>{link.bill.identifier.toUpperCase()}</Text>
              <Text style={{ fontSize: 12 }}>{link.bill.title}</Text>
              <Tag color="purple" style={{ fontSize: 10 }}>
                {link.regulations.length} reg{link.regulations.length === 1 ? '' : 's'}
              </Tag>
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="documentNumber"
            pagination={false}
            dataSource={link.regulations}
            columns={[
              {
                title: 'Doc #',
                dataIndex: 'documentNumber',
                width: 110,
                render: (num: string, r) =>
                  r.htmlUrl ? (
                    <a href={r.htmlUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
                      {num}
                    </a>
                  ) : <Text style={{ fontSize: 11 }}>{num}</Text>,
              },
              {
                title: 'Title',
                dataIndex: 'title',
                ellipsis: true,
                render: (t: string) => (
                  <Tooltip title={t}><Text style={{ fontSize: 12 }}>{t}</Text></Tooltip>
                ),
              },
              {
                title: 'Type',
                dataIndex: 'type',
                width: 90,
                render: (t: string, r) =>
                  r.significantRule ? (
                    <Tag color="red" style={{ fontSize: 10 }}>{t}</Tag>
                  ) : (
                    <Tag style={{ fontSize: 10 }}>{t}</Tag>
                  ),
              },
              {
                title: 'Agencies',
                dataIndex: 'agencyNames',
                width: 160,
                render: (names: string[]) => (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {names.slice(0, 2).join(', ')}
                    {names.length > 2 ? ` +${names.length - 2}` : ''}
                  </Text>
                ),
              },
              {
                title: 'Comment Deadline',
                dataIndex: 'commentEndDate',
                width: 130,
                render: (d: string | null) => deadlineTag(d),
              },
              {
                title: 'Matched',
                dataIndex: 'matchedTopics',
                render: (topics: string[]) => (
                  <Space wrap size={[2, 2]}>
                    {topics.slice(0, 2).map((t) => (
                      <Tag key={t} color={MATCHED_TOPIC_COLOR} style={{ fontSize: 10 }}>{t}</Tag>
                    ))}
                    {topics.length > 2 && <Tag style={{ fontSize: 10 }}>+{topics.length - 2}</Tag>}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      ))}
    </div>
  );
}

interface ResearchAttachment {
  bill: { identifier: string; title: string; latestActionDate: string | null };
  gao: Array<{
    id: string;
    title: string;
    publishDate: string | null;
    topics: string[];
    reportType: string | null;
    recommendations: number | null;
    url: string | null;
  }>;
  crs: Array<{
    id: string;
    title: string;
    date: string | null;
    topics: string[];
    authors: string[];
    htmlUrl: string | null;
  }>;
}

interface ResearchResult {
  attachments: ResearchAttachment[];
  totalBills: number;
  totalReports: number;
}

function ResearchTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const query = useQuery<ResearchResult>({
    queryKey: ['bill-research', clientId],
    queryFn: async () =>
      (await api.get<ResearchResult>(`/api/intelligence/clients/${clientId}/bill-research`)).data,
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;
  const data = query.data;
  if (!data || !data.attachments.length) {
    return (
      <Empty
        description="No GAO or CRS reports match this client's tracked bills yet."
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ marginTop: 32 }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {data.attachments.length} of {data.totalBills} tracked bills have research attachments
        ({data.totalReports} reports scanned).
      </Text>
      {data.attachments.map((att) => (
        <Card
          key={att.bill.identifier}
          size="small"
          title={
            <Space>
              <Text strong style={{ fontSize: 12 }}>{att.bill.identifier.toUpperCase()}</Text>
              <Text style={{ fontSize: 12 }}>{att.bill.title}</Text>
            </Space>
          }
        >
          {att.gao.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                GAO Reports
              </Text>
              <List
                size="small"
                dataSource={att.gao}
                renderItem={(r) => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                            {r.id}
                          </a>
                        ) : (
                          <Text style={{ fontSize: 12 }}>{r.id}</Text>
                        )}
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {r.publishDate ? new Date(r.publishDate).toLocaleDateString() : '—'}
                        </Text>
                      </div>
                      <Text style={{ fontSize: 12 }}>{r.title}</Text>
                      <div style={{ marginTop: 4 }}>
                        <Space wrap size={[2, 2]}>
                          {r.topics.slice(0, 3).map((t) => (
                            <Tag key={t} color={MATCHED_TOPIC_COLOR} style={{ fontSize: 10 }}>{t}</Tag>
                          ))}
                          {r.reportType && <Tag style={{ fontSize: 10 }}>{r.reportType}</Tag>}
                          {r.recommendations != null && r.recommendations > 0 && (
                            <Tag color="gold" style={{ fontSize: 10 }}>{r.recommendations} recs</Tag>
                          )}
                        </Space>
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}
          {att.crs.length > 0 && (
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                CRS Reports
              </Text>
              <List
                size="small"
                dataSource={att.crs}
                renderItem={(r) => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        {r.htmlUrl ? (
                          <a href={r.htmlUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                            {r.id}
                          </a>
                        ) : (
                          <Text style={{ fontSize: 12 }}>{r.id}</Text>
                        )}
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {r.date ? new Date(r.date).toLocaleDateString() : '—'}
                        </Text>
                      </div>
                      <Text style={{ fontSize: 12 }}>{r.title}</Text>
                      <div style={{ marginTop: 4 }}>
                        <Space wrap size={[2, 2]}>
                          {r.topics.slice(0, 3).map((t) => (
                            <Tag key={t} color={MATCHED_TOPIC_COLOR} style={{ fontSize: 10 }}>{t}</Tag>
                          ))}
                        </Space>
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

interface ReportCardActivity {
  meetings: number; uniqueOffices: string[]; outreachSent: number;
  outreachOpenRate: number; tasksCompleted: number; debriefsFiled: number; mailThreads: number;
}
interface ReportCardIntelligence {
  billsTracked: number; competitorCount: number; lobbySpend: number; contractWins: number;
}
interface ReportCardOutcome {
  title: string; fiscalYear: string; outcomeType: string; capability: string | null; notes: string | null;
}
interface ReportCardHealth { week: string; score: number; }
interface ReportCardParsed {
  client: { name: string; sectorTag: string | null };
  tenant: { name: string };
  period: { start: string; end: string; label: string };
  activity: ReportCardActivity;
  intelligence: ReportCardIntelligence;
  outcomes: ReportCardOutcome[];
  healthTrend: ReportCardHealth[];
  aiForwardLook: string;
  generatedAt: string;
}

export function ReportCardView({ data }: { data: Record<string, unknown> }) {
  const rc = data as unknown as ReportCardParsed;
  const { activity: a, intelligence: intel } = rc;
  const pctFmt = (n: number) => `${(n * 100).toFixed(0)}%`;

  const metricRows: Array<{ metric: string; value: string }> = [
    { metric: 'Meetings', value: String(a.meetings) },
    { metric: 'Unique Offices Met', value: String(a.uniqueOffices.length) },
    { metric: 'Outreach Sent', value: String(a.outreachSent) },
    { metric: 'Outreach Open Rate', value: pctFmt(a.outreachOpenRate) },
    { metric: 'Tasks Completed', value: String(a.tasksCompleted) },
    { metric: 'Debriefs Filed', value: String(a.debriefsFiled) },
    { metric: 'Mail Threads Active', value: String(a.mailThreads) },
    { metric: 'Bills Tracked', value: String(intel.billsTracked) },
    { metric: 'Competitors', value: String(intel.competitorCount) },
    { metric: 'Total LDA Spend', value: formatMoney(intel.lobbySpend) },
    { metric: 'Contract Wins', value: formatMoney(intel.contractWins) },
  ];

  const maxScore = Math.max(...rc.healthTrend.map((h) => h.score), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {rc.period.label} &nbsp;·&nbsp;{' '}
          {new Date(rc.period.start).toLocaleDateString()} – {new Date(rc.period.end).toLocaleDateString()}
        </Text>
      </div>

      <Space wrap>
        {rc.client.sectorTag && <Tag>{rc.client.sectorTag}</Tag>}
        <Tag color="blue">{rc.period.label}</Tag>
      </Space>

      {/* Activity summary table */}
      <Card size="small" title="Activity Summary">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.metric} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '6px 0', color: '#6b7280' }}>{row.metric}</td>
                <td style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Outcomes */}
      {rc.outcomes.length > 0 && (
        <Card size="small" title="Outcomes">
          {rc.outcomes.map((o, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 12, fontWeight: 500 }}>{o.title}</Text>
                <Space size={4}>
                  <Tag style={{ fontSize: 10 }}>FY{o.fiscalYear}</Tag>
                  {(() => {
                    const k = normalizeOutcome(o.outcomeType);
                    return (
                      <Tag color={OUTCOME_COLORS[k]} style={{ fontSize: 10 }}>
                        {OUTCOME_LABELS[k]}
                      </Tag>
                    );
                  })()}
                </Space>
              </div>
              {o.capability && (
                <Text type="secondary" style={{ fontSize: 11 }}>{o.capability}</Text>
              )}
              {o.notes && (
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{o.notes}</Text>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Health trend sparkline */}
      {rc.healthTrend.length > 0 && (
        <Card size="small" title="Engagement Health Trend">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60 }}>
            {rc.healthTrend.map((h) => (
              <Tooltip key={h.week} title={`${h.week}: ${h.score}`}>
                <div
                  style={{
                    flex: 1,
                    height: `${Math.max(4, (h.score / maxScore) * 52)}px`,
                    background: h.score >= 70 ? '#52c41a' : h.score >= 30 ? '#faad14' : '#ff4d4f',
                    borderRadius: '2px 2px 0 0',
                    minWidth: 8,
                  }}
                />
              </Tooltip>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {rc.healthTrend[0]?.week ?? ''}
            </Text>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {rc.healthTrend[rc.healthTrend.length - 1]?.week ?? ''}
            </Text>
          </div>
        </Card>
      )}

      {/* AI Forward Look */}
      {rc.aiForwardLook && (
        <Card size="small" title="AI Forward Look">
          <Text style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {rc.aiForwardLook}
          </Text>
        </Card>
      )}

      <Text type="secondary" style={{ fontSize: 11 }}>
        Generated: {new Date(rc.generatedAt).toLocaleString()} · Tenant: {rc.tenant.name}
      </Text>
    </div>
  );
}
