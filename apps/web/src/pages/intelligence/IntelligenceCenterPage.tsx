import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Empty,
  Input,
  Skeleton,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  BankOutlined,
  DollarOutlined,
  FireOutlined,
  RiseOutlined,
  ShopOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import { Sparkline, HBar } from '../../components/charts.js';

const { Title, Text, Paragraph } = Typography;

/* ── Shared types ──────────────────────────────────────────────────────── */

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
  totalFilings: number | null;
  surgeTrend: string | null;
  surgePct: number | null;
  latestQuarter: string | null;
  latestIncome: number | null;
}

interface LobbyTrendingTopic {
  word: string;
  latestCount: number;
  avgPrior: number | null;
  growthPct: number | null;
  kind: string;
}

interface LobbyOverview {
  totalClients: number;
  totalIssues: number;
  topSpenders: LobbyIntelSummary[];
  exploding: LobbyIntelSummary[];
  hotIssues: LobbyIssue[];
  surgingIssues: LobbyIssue[];
  trendingTopics: LobbyTrendingTopic[];
  lastSyncedAt: string | null;
}

interface FederalContractor {
  id: string;
  name: string;
  slug: string | null;
  uei: string | null;
  totalContracts: number | null;
  pctOfAllContracts: number | null;
  costPerTaxpayer: number | null;
  category: string | null;
  subsidiaries: number | null;
  rankByContracts: number | null;
  yearlySpend: { year: number; amount: number }[];
  topAgencies: { slug?: string; name: string; amount: number }[];
  topAwards: { awardId: string; recipient: string; amount: number; agency: string; description?: string; startDate?: string }[];
  noBidAwards: { awardId: string; recipient: string; amount: number; agency: string; description?: string }[];
  noBidTotal: number | null;
}

interface FederalAgency {
  slug: string;
  name: string;
  abbreviation: string | null;
  displayName: string | null;
  budgetAuthority: number | null;
  obligated: number | null;
  outlays: number | null;
  pctOfTotal: number | null;
  pctContracts: number | null;
  costPerAmerican: number | null;
  rankBySpending: number | null;
  contractsTotal: number | null;
  grantsTotal: number | null;
  yearlyBudget: { year: number; amount: number }[];
  topContractors: { name: string; amount: number }[];
}

interface FederalIndustry {
  code: string;
  name: string;
  slug: string | null;
  totalSpending: number | null;
  rank: number | null;
  pctOfTotal: number | null;
}

interface FederalSpendingOverview {
  totalContractors: number;
  totalAgencies: number;
  totalIndustries: number;
  topContractors: FederalContractor[];
  topAgencies: FederalAgency[];
  topIndustries: FederalIndustry[];
  topNoBidContractors: { name: string; total: number; count: number }[];
  lastSyncedAt: string | null;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function trajectoryTag(t: string | null) {
  if (!t) return null;
  const styles: Record<string, { color: string; icon: React.ReactNode }> = {
    exploding: { color: 'red', icon: <RiseOutlined /> },
    new: { color: 'cyan', icon: <ExperimentOutlined /> },
    steady: { color: 'blue', icon: null },
    declining: { color: 'orange', icon: <ArrowDownOutlined /> },
  };
  const s = styles[t] ?? { color: 'default', icon: null };
  return (
    <Tag color={s.color} style={{ textTransform: 'capitalize' }}>
      {s.icon} {t}
    </Tag>
  );
}

function surgeBadge(trend: string | null, pct: number | null) {
  if (!trend) return null;
  const colors: Record<string, string> = {
    surging: 'red',
    growing: 'gold',
    stable: 'blue',
    declining: 'orange',
  };
  const arrow =
    trend === 'declining' ? <ArrowDownOutlined /> : trend === 'stable' ? null : <ArrowUpOutlined />;
  return (
    <Tag color={colors[trend] ?? 'default'}>
      {arrow} {pct != null ? `${pct > 0 ? '+' : ''}${Math.round(pct)}%` : trend}
    </Tag>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  Defense: 'red',
  Health: 'green',
  Tech: 'blue',
  Energy: 'orange',
  Construction: 'purple',
  Other: 'default',
};

/* ── Main page ─────────────────────────────────────────────────────────── */

export function IntelligenceCenterPage() {
  return (
    <div style={{ padding: '24px 32px', overflow: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <FireOutlined style={{ color: '#ef4444', marginRight: 8 }} />
          Federal Intelligence Center
        </Title>
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
          Live federal lobbying, contracting, and agency intelligence — pulled from Senate LDA
          filings and USASpending.gov.
        </Paragraph>
      </div>

      <Tabs
        defaultActiveKey="contracting"
        size="large"
        items={[
          {
            key: 'contracting',
            label: (
              <span>
                <DollarOutlined /> Federal Contracting
              </span>
            ),
            children: <ContractingPanel />,
          },
          {
            key: 'agencies',
            label: (
              <span>
                <BankOutlined /> Agencies
              </span>
            ),
            children: <AgenciesPanel />,
          },
          {
            key: 'lobbying',
            label: (
              <span>
                <FireOutlined /> Lobbying
              </span>
            ),
            children: <LobbyingPanel />,
          },
        ]}
      />
    </div>
  );
}

/* ── Federal Contracting panel ─────────────────────────────────────────── */

function ContractingPanel() {
  const api = useApi();
  const [search, setSearch] = useState('');

  const overview = useQuery<FederalSpendingOverview>({
    queryKey: ['federal-spending-overview'],
    queryFn: async () =>
      (await api.get<FederalSpendingOverview>('/api/federal-spending/overview')).data,
    staleTime: 5 * 60 * 1000,
  });

  const searchResults = useQuery<FederalContractor[]>({
    queryKey: ['federal-spending-contractor-search', search],
    queryFn: async () =>
      (
        await api.get<FederalContractor[]>('/api/federal-spending/contractors/search', {
          params: { q: search },
        })
      ).data,
    enabled: search.trim().length >= 2,
    staleTime: 30 * 1000,
  });

  const data = overview.data;
  const maxTopContract = useMemo(
    () => Math.max(1, ...(data?.topContractors.map((c) => c.totalContracts ?? 0) ?? [])),
    [data],
  );
  const maxIndustrySpend = useMemo(
    () => Math.max(1, ...(data?.topIndustries.map((c) => c.totalSpending ?? 0) ?? [])),
    [data],
  );

  const isEmpty = !overview.isLoading && data && data.totalContractors === 0;

  return (
    <div>
      {overview.isError ? (
        <Alert
          type="error"
          message="Could not load federal contracting data"
          description={(overview.error as Error)?.message ?? 'Unknown error'}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {isEmpty ? (
        <Alert
          type="info"
          showIcon
          message="No data yet"
          description={
            <span>
              The federal spending dataset has not been synced. Run{' '}
              <Text code>pnpm --filter @capiro/api sync:openspending</Text> to populate.
            </span>
          }
          style={{ marginBottom: 24 }}
        />
      ) : null}

      {/* Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Card size="small">
          <Statistic
            title="Tracked Contractors"
            value={data?.totalContractors ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22 }}
            prefix={<ShopOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="Federal Agencies"
            value={data?.totalAgencies ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22 }}
            prefix={<BankOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="NAICS Industries"
            value={data?.totalIndustries ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="No-Bid Concentrated"
            value={data?.topNoBidContractors.length ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22, color: '#ef4444' }}
            suffix=" contractors"
          />
        </Card>
      </div>

      {/* Search */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search federal contractors by name…"
          allowClear
          enterButton
          size="middle"
          onChange={(e) => setSearch(e.target.value)}
          value={search}
        />
        {search.trim().length >= 2 ? (
          <div style={{ marginTop: 12 }}>
            {searchResults.isLoading ? (
              <Spin />
            ) : searchResults.data && searchResults.data.length > 0 ? (
              <Table
                size="small"
                rowKey="id"
                dataSource={searchResults.data}
                pagination={false}
                columns={[
                  {
                    title: 'Contractor',
                    dataIndex: 'name',
                    render: (n: string, r: FederalContractor) => (
                      <Space>
                        <Text strong>{n}</Text>
                        {r.category ? (
                          <Tag color={CATEGORY_COLORS[r.category] ?? 'default'}>{r.category}</Tag>
                        ) : null}
                      </Space>
                    ),
                  },
                  {
                    title: 'Rank',
                    dataIndex: 'rankByContracts',
                    width: 70,
                    render: (v: number | null) => (v ? `#${v}` : '—'),
                  },
                  {
                    title: 'FY25 Contracts',
                    dataIndex: 'totalContracts',
                    width: 130,
                    align: 'right',
                    render: (v: number | null) => formatMoney(v),
                  },
                  {
                    title: 'Trend',
                    dataIndex: 'yearlySpend',
                    width: 170,
                    render: (ys: { year: number; amount: number }[]) => (
                      <Sparkline data={ys ?? []} width={150} height={28} />
                    ),
                  },
                  {
                    title: 'No-Bid Total',
                    dataIndex: 'noBidTotal',
                    width: 130,
                    align: 'right',
                    render: (v: number | null) =>
                      v ? <Text type="warning">{formatMoney(v)}</Text> : '—',
                  },
                ]}
              />
            ) : (
              <Empty description="No matches" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        ) : null}
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 1.5fr) minmax(280px, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* LEFT: top contractors */}
        <Card
          size="small"
          title="Top Federal Contractors (FY2025)"
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data?.lastSyncedAt
                ? `Synced ${new Date(data.lastSyncedAt).toLocaleDateString()}`
                : ''}
            </Text>
          }
        >
          {overview.isLoading ? (
            <Skeleton active />
          ) : data && data.topContractors.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.topContractors.slice(0, 15).map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1fr 70px 140px 110px 60px',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 4px',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {i + 1}
                  </Text>
                  <Tooltip title={c.name}>
                    <Text ellipsis style={{ maxWidth: 280, fontSize: 13 }}>
                      {c.name}
                    </Text>
                  </Tooltip>
                  {c.category ? (
                    <Tag color={CATEGORY_COLORS[c.category] ?? 'default'} style={{ margin: 0 }}>
                      {c.category}
                    </Tag>
                  ) : (
                    <span />
                  )}
                  <HBar value={c.totalContracts ?? 0} max={maxTopContract} width={140} />
                  <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                    {formatMoney(c.totalContracts)}
                  </Text>
                  <Sparkline data={c.yearlySpend ?? []} width={55} height={20} />
                </div>
              ))}
            </div>
          ) : (
            <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>

        {/* RIGHT: No-bid + industries */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            size="small"
            title={
              <Space>
                <Text>🚫 Top No-Bid Recipients</Text>
              </Space>
            }
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                Sole-source awards
              </Text>
            }
          >
            {overview.isLoading ? (
              <Skeleton active />
            ) : data && data.topNoBidContractors.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.topNoBidContractors.map((c) => {
                  const max = Math.max(...data.topNoBidContractors.map((x) => x.total), 1);
                  return (
                    <div
                      key={c.name}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 100px 90px',
                        alignItems: 'center',
                        gap: 10,
                        padding: '4px 0',
                      }}
                    >
                      <Tooltip title={c.name}>
                        <Text ellipsis style={{ fontSize: 12 }}>
                          {c.name}
                        </Text>
                      </Tooltip>
                      <HBar value={c.total} max={max} width={100} color="#ef4444" />
                      <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                        {formatMoney(c.total)}
                      </Text>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          <Card size="small" title="Top Industries by Federal Contract Spend (NAICS)">
            {overview.isLoading ? (
              <Skeleton active />
            ) : data && data.topIndustries.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.topIndustries.map((ind) => (
                  <div
                    key={ind.code}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '60px 1fr 90px 70px',
                      alignItems: 'center',
                      gap: 8,
                      padding: '3px 0',
                    }}
                  >
                    <Tag style={{ margin: 0, fontSize: 10 }}>{ind.code}</Tag>
                    <Tooltip title={ind.name}>
                      <Text ellipsis style={{ fontSize: 12 }}>
                        {ind.name}
                      </Text>
                    </Tooltip>
                    <HBar value={ind.totalSpending ?? 0} max={maxIndustrySpend} width={90} />
                    <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                      {formatMoney(ind.totalSpending)}
                    </Text>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── Federal Agencies panel ────────────────────────────────────────────── */

function AgenciesPanel() {
  const api = useApi();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const agencies = useQuery<FederalAgency[]>({
    queryKey: ['federal-agencies'],
    queryFn: async () => (await api.get<FederalAgency[]>('/api/federal-spending/agencies')).data,
    staleTime: 5 * 60 * 1000,
  });

  const data = agencies.data ?? [];
  const maxBudget = useMemo(
    () => Math.max(1, ...data.map((a) => a.budgetAuthority ?? 0)),
    [data],
  );
  const selected = data.find((a) => a.slug === selectedSlug) ?? null;

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(380px, 1.2fr) minmax(320px, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* LEFT: agency list */}
        <Card size="small" title={`97 Federal Agencies (by Budget Authority)`}>
          {agencies.isLoading ? (
            <Skeleton active />
          ) : data.length > 0 ? (
            <div style={{ maxHeight: 680, overflowY: 'auto' }}>
              {data.map((a, i) => (
                <div
                  key={a.slug}
                  onClick={() => setSelectedSlug(a.slug)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 60px 1fr 130px 110px',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 6px',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    cursor: 'pointer',
                    background: selectedSlug === a.slug ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                    borderRadius: 4,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {i + 1}
                  </Text>
                  <Tag style={{ margin: 0, fontSize: 11 }}>{a.abbreviation ?? '—'}</Tag>
                  <Tooltip title={a.name}>
                    <Text ellipsis style={{ fontSize: 13 }}>
                      {a.displayName ?? a.name}
                    </Text>
                  </Tooltip>
                  <HBar value={a.budgetAuthority ?? 0} max={maxBudget} width={130} />
                  <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                    {formatMoney(a.budgetAuthority)}
                  </Text>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>

        {/* RIGHT: agency detail */}
        <div style={{ position: 'sticky', top: 16 }}>
          {selected ? (
            <Card
              size="small"
              title={
                <Space>
                  <BankOutlined />
                  <span>{selected.displayName ?? selected.name}</span>
                </Space>
              }
              extra={
                selected.abbreviation ? <Tag>{selected.abbreviation}</Tag> : null
              }
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Statistic
                  title="Budget Authority"
                  value={formatMoney(selected.budgetAuthority)}
                  valueStyle={{ fontSize: 18 }}
                />
                <Statistic
                  title="Cost / American"
                  value={
                    selected.costPerAmerican != null
                      ? `$${Math.round(selected.costPerAmerican).toLocaleString()}`
                      : '—'
                  }
                  valueStyle={{ fontSize: 18 }}
                />
                <Statistic
                  title="Contracts"
                  value={formatMoney(selected.contractsTotal)}
                  valueStyle={{ fontSize: 16 }}
                />
                <Statistic
                  title="Grants"
                  value={formatMoney(selected.grantsTotal)}
                  valueStyle={{ fontSize: 16 }}
                />
              </div>

              {selected.yearlyBudget.length > 0 ? (
                <>
                  <Text strong style={{ fontSize: 12 }}>
                    Budget trend (FY2017–2025)
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    <Sparkline
                      data={selected.yearlyBudget}
                      width={320}
                      height={56}
                      color="#2563eb"
                      fillColor="rgba(37, 99, 235, 0.15)"
                    />
                  </div>
                </>
              ) : null}

              {selected.topContractors.length > 0 ? (
                <>
                  <Text strong style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
                    Top 10 contractors at this agency
                  </Text>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {selected.topContractors.slice(0, 10).map((c, i) => {
                      const max = Math.max(
                        ...selected.topContractors.map((x) => x.amount),
                        1,
                      );
                      return (
                        <div
                          key={c.name + i}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '24px 1fr 100px 90px',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {i + 1}
                          </Text>
                          <Tooltip title={c.name}>
                            <Text ellipsis style={{ fontSize: 12 }}>
                              {c.name}
                            </Text>
                          </Tooltip>
                          <HBar value={c.amount} max={max} width={100} />
                          <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                            {formatMoney(c.amount)}
                          </Text>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </Card>
          ) : (
            <Card size="small">
              <Empty description="Select an agency to see details" />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Lobbying panel (existing) ─────────────────────────────────────────── */

function LobbyingPanel() {
  const api = useApi();
  const [search, setSearch] = useState('');

  const overview = useQuery<LobbyOverview>({
    queryKey: ['lobby-intel-overview'],
    queryFn: async () => (await api.get<LobbyOverview>('/api/lobby-intel/overview')).data,
    staleTime: 5 * 60 * 1000,
  });

  const searchResults = useQuery<LobbyIntelSummary[]>({
    queryKey: ['lobby-intel-search', search],
    queryFn: async () =>
      (
        await api.get<LobbyIntelSummary[]>('/api/lobby-intel/search', {
          params: { q: search },
        })
      ).data,
    enabled: search.trim().length >= 2,
    staleTime: 30 * 1000,
  });

  const maxTopSpend = useMemo(
    () => Math.max(1, ...(overview.data?.topSpenders.map((s) => s.totalSpending ?? 0) ?? [])),
    [overview.data],
  );
  const maxIssueSpend = useMemo(
    () => Math.max(1, ...(overview.data?.hotIssues.map((s) => s.totalSpending ?? 0) ?? [])),
    [overview.data],
  );

  const data = overview.data;
  const isEmpty = !overview.isLoading && data && data.totalClients === 0;

  return (
    <div>
      {overview.isError ? (
        <Alert
          type="error"
          message="Could not load federal lobbying intelligence"
          description={(overview.error as Error)?.message ?? 'Unknown error'}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {isEmpty ? (
        <Alert
          type="info"
          showIcon
          message="No data yet"
          description={
            <span>
              The federal lobbying dataset has not been synced. Run{' '}
              <Text code>pnpm --filter @capiro/api sync:openlobby</Text> to populate.
            </span>
          }
          style={{ marginBottom: 24 }}
        />
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Card size="small">
          <Statistic
            title="Tracked Clients"
            value={data?.totalClients ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="Surging Issues"
            value={data?.surgingIssues.length ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22, color: '#ef4444' }}
            prefix={<RiseOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="Exploding Clients"
            value={data?.exploding.length ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22, color: '#f59e0b' }}
            prefix={<ThunderboltOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="Trending Terms"
            value={data?.trendingTopics.length ?? 0}
            loading={overview.isLoading}
            valueStyle={{ fontSize: 22 }}
          />
        </Card>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search 5,000+ federal lobbying clients by name…"
          allowClear
          enterButton
          size="middle"
          onChange={(e) => setSearch(e.target.value)}
          value={search}
        />
        {search.trim().length >= 2 ? (
          <div style={{ marginTop: 12 }}>
            {searchResults.isLoading ? (
              <Spin />
            ) : searchResults.data && searchResults.data.length > 0 ? (
              <Table
                size="small"
                rowKey="id"
                dataSource={searchResults.data}
                pagination={false}
                columns={[
                  {
                    title: 'Client',
                    dataIndex: 'name',
                    render: (n: string, r: LobbyIntelSummary) => (
                      <Space>
                        <Text strong>{n}</Text>
                        {trajectoryTag(r.trajectory)}
                      </Space>
                    ),
                  },
                  {
                    title: 'State',
                    dataIndex: 'state',
                    width: 70,
                    render: (s: string | null) => s ?? '—',
                  },
                  {
                    title: 'Total Spend',
                    dataIndex: 'totalSpending',
                    width: 130,
                    align: 'right',
                    render: (v: number | null) => formatMoney(v),
                  },
                  {
                    title: 'Trajectory',
                    dataIndex: 'yearlySpend',
                    width: 180,
                    render: (ys: { year: number; amount: number }[]) => (
                      <Sparkline data={ys ?? []} width={150} height={28} />
                    ),
                  },
                  {
                    title: 'Top LDA Issues',
                    dataIndex: 'issues',
                    render: (i: string[]) => (
                      <Space size={[2, 4]} wrap>
                        {(i ?? []).slice(0, 6).map((c) => (
                          <Tag key={c} style={{ marginRight: 0, fontSize: 11 }}>
                            {c}
                          </Tag>
                        ))}
                        {i && i.length > 6 ? (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            +{i.length - 6}
                          </Text>
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty description="No matches" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        ) : null}
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 1.4fr) minmax(280px, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            size="small"
            title={
              <Space>
                <FireOutlined style={{ color: '#ef4444' }} />
                <span>Surging LDA Issues (latest quarter)</span>
              </Space>
            }
            extra={
              data?.surgingIssues[0]?.latestQuarter ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  vs prior year • {data.surgingIssues[0].latestQuarter}
                </Text>
              ) : null
            }
          >
            {overview.isLoading ? (
              <Skeleton active />
            ) : data && data.surgingIssues.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.surgingIssues.map((iss) => (
                  <div
                    key={iss.code}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '60px 1fr 110px 90px',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 4px',
                      borderBottom: '1px solid rgba(0,0,0,0.04)',
                    }}
                  >
                    <Tag color="default" style={{ margin: 0 }}>
                      {iss.code}
                    </Tag>
                    <Text>{iss.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                      {formatMoney(iss.latestIncome)} /Q
                    </Text>
                    <div style={{ textAlign: 'right' }}>
                      {surgeBadge(iss.surgeTrend, iss.surgePct)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No surge data yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          <Card
            size="small"
            title="Top Federal Lobbying Spenders"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                2018–2025
              </Text>
            }
          >
            {overview.isLoading ? (
              <Skeleton active />
            ) : data && data.topSpenders.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.topSpenders.slice(0, 12).map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '24px 1fr 140px 110px 60px',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 4px',
                      borderBottom: '1px solid rgba(0,0,0,0.04)',
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {i + 1}
                    </Text>
                    <Tooltip title={c.name}>
                      <Text ellipsis style={{ maxWidth: 360 }}>
                        {c.name}
                      </Text>
                    </Tooltip>
                    <HBar value={c.totalSpending ?? 0} max={maxTopSpend} width={140} />
                    <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                      {formatMoney(c.totalSpending)}
                    </Text>
                    <Sparkline data={c.yearlySpend ?? []} width={55} height={20} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card size="small" title="Hottest LDA Issues (cumulative)">
            {overview.isLoading ? (
              <Skeleton active />
            ) : data && data.hotIssues.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.hotIssues.map((iss) => (
                  <div
                    key={iss.code}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '50px 1fr 80px 80px',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 0',
                    }}
                  >
                    <Tag style={{ margin: 0 }}>{iss.code}</Tag>
                    <Tooltip title={iss.name}>
                      <Text ellipsis style={{ fontSize: 12 }}>
                        {iss.name}
                      </Text>
                    </Tooltip>
                    <HBar value={iss.totalSpending ?? 0} max={maxIssueSpend} width={80} />
                    <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                      {formatMoney(iss.totalSpending)}
                    </Text>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          <Card
            size="small"
            title="Trending Terms in Filings"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                AI-injected into drafts
              </Text>
            }
          >
            {overview.isLoading ? (
              <Skeleton active />
            ) : data && data.trendingTopics.length > 0 ? (
              <Space size={[6, 8]} wrap>
                {data.trendingTopics.slice(0, 30).map((t) => {
                  const grow = t.growthPct ?? 0;
                  const intensity = Math.min(1, Math.log10(Math.max(grow, 1)) / 4);
                  return (
                    <Tooltip
                      key={t.word}
                      title={
                        t.growthPct != null
                          ? `${Math.round(t.growthPct)}% growth vs prior years`
                          : `${t.latestCount.toLocaleString()} mentions`
                      }
                    >
                      <Tag
                        color="red"
                        style={{
                          margin: 0,
                          fontSize: 12 + intensity * 4,
                          opacity: 0.6 + intensity * 0.4,
                        }}
                      >
                        {t.word}
                      </Tag>
                    </Tooltip>
                  );
                })}
              </Space>
            ) : (
              <Empty description="No trending data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          <Card size="small" title="About this data">
            <Paragraph style={{ fontSize: 12, marginBottom: 6 }} type="secondary">
              Lobbying:{' '}
              <a href="https://www.openlobby.us/" target="_blank" rel="noreferrer">
                OpenLobby
              </a>{' '}
              / Senate{' '}
              <a href="https://lda.senate.gov/" target="_blank" rel="noreferrer">
                LDA
              </a>
              .
            </Paragraph>
            <Paragraph style={{ fontSize: 12, margin: 0 }} type="secondary">
              Contracting:{' '}
              <a href="https://www.openspending.us/" target="_blank" rel="noreferrer">
                OpenSpending
              </a>{' '}
              /{' '}
              <a href="https://www.usaspending.gov/" target="_blank" rel="noreferrer">
                USASpending.gov
              </a>
              . Both share the same federal reference dataset across all Capiro tenants.
            </Paragraph>
          </Card>
        </div>
      </div>
    </div>
  );
}
