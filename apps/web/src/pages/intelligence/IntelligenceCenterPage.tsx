import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Card,
  Col,
  Collapse,
  Divider,
  Empty,
  Input,
  Row,
  Select,
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
  ArrowDownOutlined,
  ArrowUpOutlined,
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  DollarOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FireOutlined,
  GlobalOutlined,
  RiseOutlined,
  ShopOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import { HBar, Sparkline, TrendAreaChart } from '../../components/charts.js';

const { Title, Text, Paragraph } = Typography;

/* ── LDA types ─────────────────────────────────────────────────────────── */

interface LdaDashboard {
  totalFilings: number;
  totalClients: number;
  totalRegistrants: number;
  totalLobbyists: number;
  totalIssueCodes: number;
  topIssueCodes: { code: string; name: string; totalFilings5y: number; totalSpending5y: number | null }[];
  topClients: { id: number; name: string; totalFilings: number; totalSpending: number | null }[];
  topRegistrants: { id: number; name: string; totalFilings: number; totalClients: number }[];
  recentFilings: { filingUuid: string; filingYear: number; clientName: string; registrantName: string; income: number | null; issueCodes: string[] }[];
}

interface LdaTrend {
  year: number;
  period: string;
  totalIncome: number | null;
  totalExpenses: number | null;
  filingCount: number;
}

interface LdaIssueCode {
  code: string;
  name: string;
  totalFilings5y: number;
  totalSpending5y: number | null;
}

interface LdaIssueDetail extends LdaIssueCode {
  topClients: { id: number; name: string; state: string | null; totalFilings: number; totalSpending: number | null }[];
}

interface LdaClient {
  id: number;
  name: string;
  state: string | null;
  totalFilings: number;
  totalSpending: number | null;
  issueCodes: string[];
  latestFilingYear: number | null;
}

interface LdaFiling {
  id: string;
  filingUuid: string;
  filingType: string;
  filingYear: number;
  filingPeriod: string | null;
  income: number | null;
  expenses: number | null;
  dtPosted: string | null;
  registrantName: string;
  clientName: string;
  clientState: string | null;
  issueCodes: string[];
}

interface LdaRegistrant {
  id: number;
  name: string;
  state: string | null;
  city: string | null;
  totalFilings: number;
  totalClients: number;
}

interface LdaLobbyist {
  id: number;
  firstName: string;
  lastName: string;
  coveredPositions: unknown[];
  registrantIds: number[];
  activeYears: number[];
}

interface LdaEntity {
  id: number;
  name: string;
  totalFilings5y: number;
}

interface CongressBill {
  id: string;
  congress: number;
  billType: string;
  billNumber: string;
  title: string;
  introducedDate: string | null;
  sponsorName: string | null;
  sponsorState: string | null;
  sponsorParty: string | null;
  latestActionText: string | null;
  latestActionDate: string | null;
  policyArea: string | null;
  cosponsorsCount: number;
  originChamber: string | null;
  url: string | null;
}

interface FecCommittee {
  id: string;
  name: string;
  committeeType: string | null;
  designation: string | null;
  party: string | null;
  state: string | null;
  totalReceipts: number | null;
  totalDisbursements: number | null;
  cashOnHand: number | null;
}

interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/* ── Existing lobby-intel / federal-spending types ──────────────────────── */

interface LobbyIntelSummary {
  id: string; slug: string; name: string; state: string | null;
  totalSpending: number | null; filings: number | null; issues: string[];
  years: number[]; trajectory: string | null; growthRate: number | null;
  yearlySpend: { year: number; amount: number }[];
}
interface LobbyIssue {
  code: string; name: string; totalSpending: number | null;
  totalFilings: number | null; surgeTrend: string | null;
  surgePct: number | null; latestQuarter: string | null; latestIncome: number | null;
}
interface LobbyTrendingTopic { word: string; latestCount: number; avgPrior: number | null; growthPct: number | null; kind: string; }
interface LobbyOverview {
  totalClients: number; totalIssues: number;
  topSpenders: LobbyIntelSummary[]; exploding: LobbyIntelSummary[];
  hotIssues: LobbyIssue[]; surgingIssues: LobbyIssue[];
  trendingTopics: LobbyTrendingTopic[]; lastSyncedAt: string | null;
}
interface FederalContractor {
  id: string; name: string; slug: string | null; uei: string | null;
  totalContracts: number | null; pctOfAllContracts: number | null;
  costPerTaxpayer: number | null; category: string | null; subsidiaries: number | null;
  rankByContracts: number | null;
  yearlySpend: { year: number; amount: number }[];
  topAgencies: { slug?: string; name: string; amount: number }[];
  topAwards: { awardId: string; recipient: string; amount: number; agency: string; description?: string; startDate?: string }[];
  noBidAwards: { awardId: string; recipient: string; amount: number; agency: string; description?: string }[];
  noBidTotal: number | null;
}
interface FederalAgency {
  slug: string; name: string; abbreviation: string | null; displayName: string | null;
  budgetAuthority: number | null; obligated: number | null; outlays: number | null;
  pctOfTotal: number | null; pctContracts: number | null; costPerAmerican: number | null;
  rankBySpending: number | null; contractsTotal: number | null; grantsTotal: number | null;
  yearlyBudget: { year: number; amount: number }[];
  topContractors: { name: string; amount: number }[];
}
interface FederalIndustry {
  code: string; name: string; slug: string | null;
  totalSpending: number | null; rank: number | null; pctOfTotal: number | null;
}
interface FederalSpendingOverview {
  totalContractors: number; totalAgencies: number; totalIndustries: number;
  topContractors: FederalContractor[]; topAgencies: FederalAgency[];
  topIndustries: FederalIndustry[];
  topNoBidContractors: { name: string; total: number; count: number }[];
  lastSyncedAt: string | null;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

const ISSUE_PALETTE = [
  'blue', 'cyan', 'geekblue', 'purple', 'volcano', 'gold',
  'lime', 'orange', 'magenta', 'green', 'red', 'default',
];

function issueTagColor(code: string): string {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return ISSUE_PALETTE[h % ISSUE_PALETTE.length] ?? 'default';
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
  const colors: Record<string, string> = { surging: 'red', growing: 'gold', stable: 'blue', declining: 'orange' };
  const arrow = trend === 'declining' ? <ArrowDownOutlined /> : trend === 'stable' ? null : <ArrowUpOutlined />;
  return (
    <Tag color={colors[trend] ?? 'default'}>
      {arrow} {pct != null ? `${pct > 0 ? '+' : ''}${Math.round(pct)}%` : trend}
    </Tag>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  Defense: 'red', Health: 'green', Tech: 'blue', Energy: 'orange', Construction: 'purple', Other: 'default',
};

/* ── Main page ──────────────────────────────────────────────────────────── */

export function IntelligenceCenterPage() {
  return (
    <div style={{ padding: '24px 32px', overflow: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          <FireOutlined style={{ color: '#ef4444', marginRight: 8 }} />
          Federal Intelligence Center
        </Title>
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
          Senate LDA lobbying data, federal contracts, agency budgets, Congressional bills, and PAC finance — unified.
        </Paragraph>
      </div>

      <Tabs
        defaultActiveKey="lda"
        size="large"
        items={[
          {
            key: 'lda',
            label: <span><AuditOutlined /> LDA Overview</span>,
            children: <LdaOverviewPanel />,
          },
          {
            key: 'filings',
            label: <span><FileTextOutlined /> Filings</span>,
            children: <FilingsPanel />,
          },
          {
            key: 'firms',
            label: <span><ShopOutlined /> Firms</span>,
            children: <FirmsPanel />,
          },
          {
            key: 'lobbyists',
            label: <span><UserOutlined /> Lobbyists</span>,
            children: <LobbyistsPanel />,
          },
          {
            key: 'congress',
            label: <span><BookOutlined /> Congress</span>,
            children: <CongressPanel />,
          },
          {
            key: 'pacs',
            label: <span><DollarOutlined /> PACs</span>,
            children: <PacsPanel />,
          },
          {
            key: 'contracting',
            label: <span><GlobalOutlined /> Contracting</span>,
            children: <ContractingPanel />,
          },
          {
            key: 'agencies',
            label: <span><BankOutlined /> Agencies</span>,
            children: <AgenciesPanel />,
          },
          {
            key: 'lobbying',
            label: <span><FireOutlined /> Lobby Intel</span>,
            children: <LobbyingPanel />,
          },
        ]}
      />
    </div>
  );
}

/* ── LDA Overview Panel ─────────────────────────────────────────────────── */

function LdaOverviewPanel() {
  const api = useApi();
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);

  const dashboard = useQuery<LdaDashboard>({
    queryKey: ['lda-dashboard'],
    queryFn: async () => (await api.get<LdaDashboard>('/api/lda-intel/dashboard')).data,
    staleTime: 5 * 60 * 1000,
  });

  const trends = useQuery<LdaTrend[]>({
    queryKey: ['lda-trends'],
    queryFn: async () => (await api.get<LdaTrend[]>('/api/lda-intel/trends')).data,
    staleTime: 5 * 60 * 1000,
  });

  const issues = useQuery<LdaIssueCode[]>({
    queryKey: ['lda-issues'],
    queryFn: async () => (await api.get<LdaIssueCode[]>('/api/lda-intel/issues')).data,
    staleTime: 5 * 60 * 1000,
  });

  const entities = useQuery<LdaEntity[]>({
    queryKey: ['lda-entities'],
    queryFn: async () => (await api.get<LdaEntity[]>('/api/lda-intel/entities')).data,
    staleTime: 5 * 60 * 1000,
  });

  const issueDetail = useQuery<LdaIssueDetail>({
    queryKey: ['lda-issue-detail', selectedIssue],
    queryFn: async () => (await api.get<LdaIssueDetail>(`/api/lda-intel/issues/${selectedIssue}`)).data,
    enabled: !!selectedIssue,
    staleTime: 60 * 1000,
  });

  const isEmpty = !dashboard.isLoading && dashboard.data && dashboard.data.totalFilings === 0;

  const trendPoints = useMemo(() => {
    if (!trends.data) return [];
    return trends.data.map((r) => ({
      label: `${r.year} ${r.period}`,
      value1: r.filingCount,
      value2: (r.totalIncome ?? 0) / 1e6,
    }));
  }, [trends.data]);

  const dash = dashboard.data;
  const topIssues = issues.data?.slice(0, 15) ?? [];
  const maxIssueSpend = Math.max(1, ...topIssues.map((i) => i.totalSpending5y ?? 0));
  const topEntities = entities.data?.slice(0, 15) ?? [];
  const maxEntityFilings = Math.max(1, ...topEntities.map((e) => e.totalFilings5y));
  const topClients = dash?.topClients ?? [];
  const maxClientSpend = Math.max(1, ...topClients.map((c) => c.totalSpending ?? 0));

  return (
    <div>
      {dashboard.isError && (
        <Alert type="error" message="Could not load LDA dashboard"
          description={(dashboard.error as Error)?.message} style={{ marginBottom: 16 }} />
      )}
      {isEmpty && (
        <Alert type="info" showIcon message="No LDA data yet"
          description={<span>Run <Text code>pnpm --filter @capiro/api sync:lda</Text> to populate.</span>}
          style={{ marginBottom: 24 }} />
      )}

      {/* Hero Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { title: 'Total Filings', value: dash?.totalFilings, icon: <FileTextOutlined />, color: '#2563eb' },
          { title: 'Total Clients', value: dash?.totalClients, icon: <TeamOutlined />, color: '#10b981' },
          { title: 'Lobbying Firms', value: dash?.totalRegistrants, icon: <ShopOutlined />, color: '#8b5cf6' },
          { title: 'Registered Lobbyists', value: dash?.totalLobbyists, icon: <UserOutlined />, color: '#f59e0b' },
          { title: 'Issue Areas', value: dash?.totalIssueCodes ?? 79, icon: <AuditOutlined />, color: '#ef4444' },
        ].map(({ title, value, icon, color }) => (
          <Card
            key={title}
            size="small"
            style={{ borderTop: `3px solid ${color}` }}
          >
            <Statistic
              title={<span style={{ fontSize: 12 }}>{title}</span>}
              value={value ?? 0}
              loading={dashboard.isLoading}
              valueStyle={{ fontSize: 22, color }}
              prefix={<span style={{ color }}>{icon}</span>}
            />
          </Card>
        ))}
      </div>

      {/* Spending Trends */}
      <Card
        size="small"
        title="Quarterly Lobbying Trends (2021–present)"
        style={{ marginBottom: 24 }}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>Filings count + total income ($M)</Text>}
      >
        {trends.isLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : trendPoints.length > 0 ? (
          <TrendAreaChart
            data={trendPoints}
            height={160}
            color1="#2563eb"
            color2="#10b981"
            label1="Filings"
            label2="Income ($M)"
            formatValue1={(v) => formatNum(Math.round(v))}
            formatValue2={(v) => `$${v.toFixed(0)}M`}
          />
        ) : (
          <Empty description="No trend data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>

      {/* Three-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left: Top Issue Areas */}
        <Card size="small" title="Top Issue Areas (5yr spending)">
          {issues.isLoading ? (
            <Skeleton active />
          ) : topIssues.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {topIssues.map((iss) => (
                <div
                  key={iss.code}
                  onClick={() => setSelectedIssue(iss.code === selectedIssue ? null : iss.code)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '52px 1fr 70px',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 6px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: selectedIssue === iss.code ? 'rgba(37,99,235,0.07)' : 'transparent',
                  }}
                >
                  <Tag color={issueTagColor(iss.code)} style={{ margin: 0, fontSize: 10, textAlign: 'center' }}>
                    {iss.code}
                  </Tag>
                  <Tooltip title={iss.name}>
                    <div>
                      <Text ellipsis style={{ fontSize: 12, display: 'block' }}>{iss.name}</Text>
                      <HBar value={iss.totalSpending5y ?? 0} max={maxIssueSpend} width={100} height={4} />
                    </div>
                  </Tooltip>
                  <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                    {formatMoney(iss.totalSpending5y)}
                  </Text>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}

          {selectedIssue && (
            <>
              <Divider style={{ margin: '10px 0' }} />
              <Text strong style={{ fontSize: 12 }}>Top clients — {selectedIssue}</Text>
              {issueDetail.isLoading ? (
                <Spin size="small" style={{ marginTop: 6, display: 'block' }} />
              ) : issueDetail.data ? (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {issueDetail.data.topClients.slice(0, 8).map((c) => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <Tooltip title={c.name}><Text ellipsis style={{ maxWidth: 140 }}>{c.name}</Text></Tooltip>
                      <Text type="secondary">{formatMoney(c.totalSpending)}</Text>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Card>

        {/* Center: Top Spenders */}
        <Card
          size="small"
          title="Top Lobbying Clients (by filings)"
          extra={<Text type="secondary" style={{ fontSize: 12 }}>Senate LDA 5yr</Text>}
        >
          {dashboard.isLoading ? (
            <Skeleton active />
          ) : topClients.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {topClients.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '22px 1fr 110px 90px',
                    alignItems: 'center',
                    gap: 10,
                    padding: '5px 4px',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>
                  <Tooltip title={c.name}>
                    <Text ellipsis style={{ fontSize: 13 }}>{c.name}</Text>
                  </Tooltip>
                  <HBar value={c.totalSpending ?? 0} max={maxClientSpend} width={110} />
                  <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                    {formatMoney(c.totalSpending)}
                  </Text>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}

          {dash?.recentFilings && dash.recentFilings.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0 8px' }} />
              <Text strong style={{ fontSize: 12 }}>Recent Filings</Text>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dash.recentFilings.slice(0, 5).map((f) => (
                  <div
                    key={f.filingUuid}
                    style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.02)', borderRadius: 4, fontSize: 12 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text strong style={{ fontSize: 12 }}>{f.clientName}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{f.filingYear}</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{f.registrantName}</Text>
                      <Text style={{ fontSize: 12 }}>{formatMoney(f.income)}</Text>
                    </div>
                    <Space size={[3, 3]} wrap style={{ marginTop: 3 }}>
                      {(f.issueCodes ?? []).slice(0, 4).map((code) => (
                        <Tag key={code} color={issueTagColor(code)} style={{ margin: 0, fontSize: 10 }}>{code}</Tag>
                      ))}
                    </Space>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Right: Government Targets */}
        <Card size="small" title="Government Targets (5yr filings)">
          {entities.isLoading ? (
            <Skeleton active />
          ) : topEntities.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {topEntities.map((e, i) => (
                <div
                  key={e.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '22px 1fr 70px',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 4px',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>
                  <div>
                    <Tooltip title={e.name}>
                      <Text ellipsis style={{ fontSize: 12, display: 'block' }}>{e.name}</Text>
                    </Tooltip>
                    <HBar value={e.totalFilings5y} max={maxEntityFilings} width={90} height={4} color="#8b5cf6" />
                  </div>
                  <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
                    {formatNum(e.totalFilings5y)}
                  </Text>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
      </div>

      {/* Top Registrants */}
      {dash?.topRegistrants && dash.topRegistrants.length > 0 && (
        <Card size="small" title="Top Lobbying Firms" style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 8,
            }}
          >
            {dash.topRegistrants.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 8px',
                  border: '1px solid rgba(0,0,0,0.06)',
                  borderRadius: 6,
                }}
              >
                <Text type="secondary" style={{ fontSize: 11, width: 20 }}>{i + 1}</Text>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Tooltip title={r.name}>
                    <Text ellipsis style={{ fontSize: 13, display: 'block' }}>{r.name}</Text>
                  </Tooltip>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatNum(r.totalClients)} clients · {formatNum(r.totalFilings)} filings
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Filings Panel ──────────────────────────────────────────────────────── */

function FilingsPanel() {
  const api = useApi();
  const [page, setPage] = useState(1);
  const [client, setClient] = useState('');
  const [registrant, setRegistrant] = useState('');
  const [year, setYear] = useState<number | undefined>();
  const [issue, setIssue] = useState('');
  const [search, setSearch] = useState({ client: '', registrant: '', year: undefined as number | undefined, issue: '' });

  const filings = useQuery<PagedResult<LdaFiling>>({
    queryKey: ['lda-filings', page, search],
    queryFn: async () =>
      (await api.get<PagedResult<LdaFiling>>('/api/lda-intel/filings', {
        params: { page, limit: 25, client: search.client || undefined, registrant: search.registrant || undefined, year: search.year, issue: search.issue || undefined },
      })).data,
    staleTime: 60 * 1000,
  });

  function applySearch() {
    setSearch({ client, registrant, year, issue });
    setPage(1);
  }

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col flex="1">
            <Input placeholder="Client name…" value={client} onChange={(e) => setClient(e.target.value)} onPressEnter={applySearch} />
          </Col>
          <Col flex="1">
            <Input placeholder="Firm / registrant…" value={registrant} onChange={(e) => setRegistrant(e.target.value)} onPressEnter={applySearch} />
          </Col>
          <Col style={{ width: 100 }}>
            <Input placeholder="Year" type="number" value={year ?? ''} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)} onPressEnter={applySearch} />
          </Col>
          <Col style={{ width: 80 }}>
            <Input placeholder="Issue" value={issue} onChange={(e) => setIssue(e.target.value.toUpperCase())} onPressEnter={applySearch} maxLength={10} />
          </Col>
          <Col>
            <Input.Search enterButton="Search" onSearch={applySearch} style={{ width: 100 }} />
          </Col>
        </Row>
      </Card>

      {filings.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : filings.isError ? (
        <Alert type="error" message="Failed to load filings" />
      ) : filings.data && filings.data.total === 0 ? (
        <Empty description="No filings found" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(filings.data?.data ?? []).map((f) => (
            <Card
              key={f.filingUuid}
              size="small"
              bodyStyle={{ padding: '10px 14px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <Space size={6}>
                  <Text strong style={{ fontSize: 13 }}>{f.clientName}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>→ {f.registrantName}</Text>
                </Space>
                <Space size={6}>
                  {f.income != null && (
                    <Text style={{ fontWeight: 600, color: '#2563eb' }}>{formatMoney(f.income)}</Text>
                  )}
                  <Tag style={{ margin: 0 }}>{f.filingYear} {f.filingPeriod ?? ''}</Tag>
                  <Tag color="default" style={{ margin: 0, fontSize: 10 }}>{f.filingType}</Tag>
                </Space>
              </div>
              <Space size={[4, 4]} wrap>
                {(f.issueCodes ?? []).map((code) => (
                  <Tag key={code} color={issueTagColor(code)} style={{ margin: 0, fontSize: 10 }}>{code}</Tag>
                ))}
                {f.clientState && <Tag style={{ margin: 0, fontSize: 10 }}>{f.clientState}</Tag>}
              </Space>
            </Card>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatNum(filings.data?.total)} total filings
            </Text>
            <Space>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                style={{ padding: '4px 12px', cursor: page > 1 ? 'pointer' : 'not-allowed', opacity: page > 1 ? 1 : 0.4 }}
              >
                ← Prev
              </button>
              <Text type="secondary">Page {page}</Text>
              <button
                disabled={!filings.data || page * 25 >= filings.data.total}
                onClick={() => setPage((p) => p + 1)}
                style={{ padding: '4px 12px', cursor: (filings.data && page * 25 < filings.data.total) ? 'pointer' : 'not-allowed', opacity: (filings.data && page * 25 < filings.data.total) ? 1 : 0.4 }}
              >
                Next →
              </button>
            </Space>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Firms Panel ────────────────────────────────────────────────────────── */

function FirmsPanel() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const registrants = useQuery<PagedResult<LdaRegistrant>>({
    queryKey: ['lda-registrants', query, page],
    queryFn: async () =>
      (await api.get<PagedResult<LdaRegistrant>>('/api/lda-intel/registrants', {
        params: { q: query || undefined, page, limit: 25 },
      })).data,
    staleTime: 60 * 1000,
  });

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search lobbying firms by name…"
          allowClear
          enterButton
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => { setQuery(v); setPage(1); }}
        />
      </Card>

      {registrants.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table<LdaRegistrant>
          size="small"
          rowKey="id"
          dataSource={registrants.data?.data ?? []}
          loading={registrants.isFetching}
          pagination={{
            current: page,
            pageSize: 25,
            total: registrants.data?.total ?? 0,
            onChange: (p) => setPage(p),
            showTotal: (t) => `${t.toLocaleString()} firms`,
          }}
          columns={[
            {
              title: '#',
              width: 50,
              render: (_: unknown, __: LdaRegistrant, i: number) => (page - 1) * 25 + i + 1,
            },
            {
              title: 'Firm',
              dataIndex: 'name',
              render: (n: string, r: LdaRegistrant) => (
                <div>
                  <Text strong style={{ fontSize: 13 }}>{n}</Text>
                  {(r.city || r.state) && (
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      {[r.city, r.state].filter(Boolean).join(', ')}
                    </Text>
                  )}
                </div>
              ),
            },
            {
              title: 'Clients',
              dataIndex: 'totalClients',
              width: 90,
              align: 'right',
              render: (v: number) => formatNum(v),
            },
            {
              title: 'Filings',
              dataIndex: 'totalFilings',
              width: 90,
              align: 'right',
              render: (v: number) => formatNum(v),
            },
          ]}
        />
      )}
    </div>
  );
}

/* ── Lobbyists Panel ────────────────────────────────────────────────────── */

function LobbyistsPanel() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const lobbyists = useQuery<PagedResult<LdaLobbyist>>({
    queryKey: ['lda-lobbyists', query, page],
    queryFn: async () =>
      (await api.get<PagedResult<LdaLobbyist>>('/api/lda-intel/lobbyists', {
        params: { q: query || undefined, page, limit: 25 },
      })).data,
    staleTime: 60 * 1000,
  });

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search lobbyists by last name…"
          allowClear
          enterButton
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => { setQuery(v); setPage(1); }}
        />
      </Card>

      <Collapse
        ghost
        items={[
          {
            key: 'hint',
            label: <Text type="secondary" style={{ fontSize: 12 }}>About covered positions</Text>,
            children: (
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                Covered positions are prior government roles that qualify a lobbyist as a "covered official"
                under the Lobbying Disclosure Act. They appear on LD-1 and LD-2 filings.
              </Paragraph>
            ),
          },
        ]}
        style={{ marginBottom: 12 }}
      />

      {lobbyists.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table<LdaLobbyist>
          size="small"
          rowKey="id"
          dataSource={lobbyists.data?.data ?? []}
          loading={lobbyists.isFetching}
          pagination={{
            current: page,
            pageSize: 25,
            total: lobbyists.data?.total ?? 0,
            onChange: (p) => setPage(p),
            showTotal: (t) => `${t.toLocaleString()} lobbyists`,
          }}
          columns={[
            {
              title: 'Name',
              render: (_: unknown, r: LdaLobbyist) => (
                <Text strong style={{ fontSize: 13 }}>{r.firstName} {r.lastName}</Text>
              ),
            },
            {
              title: 'Active Years',
              dataIndex: 'activeYears',
              width: 180,
              render: (years: number[]) => (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {(years ?? []).sort().join(', ') || '—'}
                </Text>
              ),
            },
            {
              title: 'Covered Positions',
              dataIndex: 'coveredPositions',
              render: (positions: unknown[]) => {
                const count = Array.isArray(positions) ? positions.length : 0;
                return count > 0 ? (
                  <Badge count={count} color="#8b5cf6">
                    <Tag>Gov. roles</Tag>
                  </Badge>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>None</Text>
                );
              },
            },
            {
              title: 'Firms',
              dataIndex: 'registrantIds',
              width: 80,
              align: 'right',
              render: (ids: number[]) => formatNum((ids ?? []).length),
            },
          ]}
        />
      )}
    </div>
  );
}

/* ── Congress Panel ─────────────────────────────────────────────────────── */

function CongressPanel() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [policyArea, setPolicyArea] = useState('');
  const [congress, setCongress] = useState<number | undefined>();
  const [page, setPage] = useState(1);

  const bills = useQuery<PagedResult<CongressBill>>({
    queryKey: ['lda-bills', query, policyArea, congress, page],
    queryFn: async () =>
      (await api.get<PagedResult<CongressBill>>('/api/lda-intel/congress/bills', {
        params: { q: query || undefined, policyArea: policyArea || undefined, congress, page, limit: 25 },
      })).data,
    staleTime: 60 * 1000,
  });

  function applySearch() {
    setQuery(search);
    setPage(1);
  }

  const partyColor: Record<string, string> = { R: 'red', D: 'blue', I: 'green' };

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col flex="1">
            <Input
              placeholder="Search bills by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={applySearch}
            />
          </Col>
          <Col style={{ width: 200 }}>
            <Input
              placeholder="Policy area…"
              value={policyArea}
              onChange={(e) => setPolicyArea(e.target.value)}
              onPressEnter={applySearch}
            />
          </Col>
          <Col style={{ width: 140 }}>
            <Select
              style={{ width: '100%' }}
              placeholder="Congress"
              allowClear
              value={congress}
              onChange={(v) => { setCongress(v); setPage(1); }}
              options={[
                { label: '119th Congress', value: 119 },
                { label: '118th Congress', value: 118 },
              ]}
            />
          </Col>
          <Col>
            <Input.Search enterButton="Search" onSearch={applySearch} style={{ width: 100 }} />
          </Col>
        </Row>
      </Card>

      {bills.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Table<CongressBill>
          size="small"
          rowKey="id"
          dataSource={bills.data?.data ?? []}
          loading={bills.isFetching}
          pagination={{
            current: page,
            pageSize: 25,
            total: bills.data?.total ?? 0,
            onChange: (p) => setPage(p),
            showTotal: (t) => `${t.toLocaleString()} bills`,
          }}
          columns={[
            {
              title: 'Bill',
              width: 100,
              render: (_: unknown, r: CongressBill) => (
                <Text style={{ fontSize: 12, fontWeight: 600 }}>
                  {r.billType.toUpperCase()}-{r.billNumber}
                </Text>
              ),
            },
            {
              title: 'Title',
              dataIndex: 'title',
              render: (t: string, r: CongressBill) => (
                <div>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{t}</a>
                  ) : (
                    <Text style={{ fontSize: 12 }}>{t}</Text>
                  )}
                  {r.latestActionText && (
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                      {r.latestActionText}
                    </Text>
                  )}
                </div>
              ),
            },
            {
              title: 'Sponsor',
              width: 160,
              render: (_: unknown, r: CongressBill) =>
                r.sponsorName ? (
                  <Space size={4}>
                    <Text style={{ fontSize: 12 }}>{r.sponsorName}</Text>
                    {r.sponsorParty && (
                      <Tag color={partyColor[r.sponsorParty] ?? 'default'} style={{ margin: 0, fontSize: 10 }}>
                        {r.sponsorParty}
                      </Tag>
                    )}
                    {r.sponsorState && <Text type="secondary" style={{ fontSize: 11 }}>{r.sponsorState}</Text>}
                  </Space>
                ) : <Text type="secondary">—</Text>,
            },
            {
              title: 'Policy Area',
              dataIndex: 'policyArea',
              width: 140,
              render: (v: string | null) =>
                v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary">—</Text>,
            },
            {
              title: 'Congress',
              dataIndex: 'congress',
              width: 90,
              align: 'center',
              render: (v: number) => <Tag>{v}th</Tag>,
            },
            {
              title: 'Introduced',
              dataIndex: 'introducedDate',
              width: 100,
              render: (v: string | null) =>
                v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—',
            },
          ]}
        />
      )}
    </div>
  );
}

/* ── PACs Panel ─────────────────────────────────────────────────────────── */

function PacsPanel() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const committees = useQuery<PagedResult<FecCommittee>>({
    queryKey: ['fec-committees', query, page],
    queryFn: async () =>
      (await api.get<PagedResult<FecCommittee>>('/api/lda-intel/fec/committees', {
        params: { q: query || undefined, page, limit: 25 },
      })).data,
    staleTime: 60 * 1000,
  });

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search PAC committees by name…"
          allowClear
          enterButton
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => { setQuery(v); setPage(1); }}
        />
      </Card>

      {committees.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table<FecCommittee>
          size="small"
          rowKey="id"
          dataSource={committees.data?.data ?? []}
          loading={committees.isFetching}
          pagination={{
            current: page,
            pageSize: 25,
            total: committees.data?.total ?? 0,
            onChange: (p) => setPage(p),
            showTotal: (t) => `${t.toLocaleString()} committees`,
          }}
          columns={[
            {
              title: 'Committee',
              render: (_: unknown, r: FecCommittee) => (
                <div>
                  <Text strong style={{ fontSize: 13 }}>{r.name}</Text>
                  <div style={{ marginTop: 2 }}>
                    {r.committeeType && <Tag style={{ fontSize: 10, margin: '0 4px 0 0' }}>{r.committeeType}</Tag>}
                    {r.designation && <Tag color="geekblue" style={{ fontSize: 10, margin: 0 }}>{r.designation}</Tag>}
                  </div>
                </div>
              ),
            },
            {
              title: 'Party',
              dataIndex: 'party',
              width: 80,
              render: (v: string | null) =>
                v ? <Tag color={v === 'REP' ? 'red' : v === 'DEM' ? 'blue' : 'default'}>{v}</Tag> : <Text type="secondary">—</Text>,
            },
            {
              title: 'State',
              dataIndex: 'state',
              width: 70,
              render: (v: string | null) => v ?? '—',
            },
            {
              title: 'Total Receipts',
              dataIndex: 'totalReceipts',
              width: 130,
              align: 'right',
              render: (v: number | null) => <Text style={{ fontWeight: 600 }}>{formatMoney(v)}</Text>,
            },
            {
              title: 'Disbursements',
              dataIndex: 'totalDisbursements',
              width: 130,
              align: 'right',
              render: (v: number | null) => formatMoney(v),
            },
            {
              title: 'Cash on Hand',
              dataIndex: 'cashOnHand',
              width: 120,
              align: 'right',
              render: (v: number | null) => (
                <Text type={v != null && v > 0 ? 'success' : 'secondary'}>{formatMoney(v)}</Text>
              ),
            },
          ]}
        />
      )}
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
      (await api.get<FederalContractor[]>('/api/federal-spending/contractors/search', { params: { q: search } })).data,
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
        <Alert type="error" message="Could not load federal contracting data"
          description={(overview.error as Error)?.message} style={{ marginBottom: 16 }} />
      ) : null}
      {isEmpty ? (
        <Alert type="info" showIcon message="No data yet"
          description={<span>Run <Text code>pnpm --filter @capiro/api sync:openspending</Text> to populate.</span>}
          style={{ marginBottom: 24 }} />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Card size="small"><Statistic title="Tracked Contractors" value={data?.totalContractors ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22 }} prefix={<ShopOutlined />} /></Card>
        <Card size="small"><Statistic title="Federal Agencies" value={data?.totalAgencies ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22 }} prefix={<BankOutlined />} /></Card>
        <Card size="small"><Statistic title="NAICS Industries" value={data?.totalIndustries ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22 }} /></Card>
        <Card size="small"><Statistic title="No-Bid Concentrated" value={data?.topNoBidContractors.length ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22, color: '#ef4444' }} suffix=" contractors" /></Card>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search placeholder="Search federal contractors by name…" allowClear enterButton size="middle" onChange={(e) => setSearch(e.target.value)} value={search} />
        {search.trim().length >= 2 ? (
          <div style={{ marginTop: 12 }}>
            {searchResults.isLoading ? <Spin /> : searchResults.data && searchResults.data.length > 0 ? (
              <Table size="small" rowKey="id" dataSource={searchResults.data} pagination={false}
                columns={[
                  { title: 'Contractor', dataIndex: 'name', render: (n: string, r: FederalContractor) => <Space><Text strong>{n}</Text>{r.category ? <Tag color={CATEGORY_COLORS[r.category] ?? 'default'}>{r.category}</Tag> : null}</Space> },
                  { title: 'Rank', dataIndex: 'rankByContracts', width: 70, render: (v: number | null) => v ? `#${v}` : '—' },
                  { title: 'FY25 Contracts', dataIndex: 'totalContracts', width: 130, align: 'right', render: (v: number | null) => formatMoney(v) },
                  { title: 'Trend', dataIndex: 'yearlySpend', width: 170, render: (ys: { year: number; amount: number }[]) => <Sparkline data={ys ?? []} width={150} height={28} /> },
                  { title: 'No-Bid Total', dataIndex: 'noBidTotal', width: 130, align: 'right', render: (v: number | null) => v ? <Text type="warning">{formatMoney(v)}</Text> : '—' },
                ]}
              />
            ) : <Empty description="No matches" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        ) : null}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.5fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card size="small" title="Top Federal Contractors (FY2025)"
          extra={<Text type="secondary" style={{ fontSize: 12 }}>{data?.lastSyncedAt ? `Synced ${new Date(data.lastSyncedAt).toLocaleDateString()}` : ''}</Text>}
        >
          {overview.isLoading ? <Skeleton active /> : data && data.topContractors.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.topContractors.slice(0, 15).map((c, i) => (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 70px 140px 110px 60px', alignItems: 'center', gap: 10, padding: '6px 4px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>
                  <Tooltip title={c.name}><Text ellipsis style={{ maxWidth: 280, fontSize: 13 }}>{c.name}</Text></Tooltip>
                  {c.category ? <Tag color={CATEGORY_COLORS[c.category] ?? 'default'} style={{ margin: 0 }}>{c.category}</Tag> : <span />}
                  <HBar value={c.totalContracts ?? 0} max={maxTopContract} width={140} />
                  <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>{formatMoney(c.totalContracts)}</Text>
                  <Sparkline data={c.yearlySpend ?? []} width={55} height={20} />
                </div>
              ))}
            </div>
          ) : <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card size="small" title="🚫 Top No-Bid Recipients" extra={<Text type="secondary" style={{ fontSize: 12 }}>Sole-source awards</Text>}>
            {overview.isLoading ? <Skeleton active /> : data && data.topNoBidContractors.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.topNoBidContractors.map((c) => {
                  const max = Math.max(...data.topNoBidContractors.map((x) => x.total), 1);
                  return (
                    <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 90px', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                      <Tooltip title={c.name}><Text ellipsis style={{ fontSize: 12 }}>{c.name}</Text></Tooltip>
                      <HBar value={c.total} max={max} width={100} color="#ef4444" />
                      <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>{formatMoney(c.total)}</Text>
                    </div>
                  );
                })}
              </div>
            ) : <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

          <Card size="small" title="Top Industries by Federal Contract Spend (NAICS)">
            {overview.isLoading ? <Skeleton active /> : data && data.topIndustries.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.topIndustries.map((ind) => (
                  <div key={ind.code} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px 70px', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                    <Tag style={{ margin: 0, fontSize: 10 }}>{ind.code}</Tag>
                    <Tooltip title={ind.name}><Text ellipsis style={{ fontSize: 12 }}>{ind.name}</Text></Tooltip>
                    <HBar value={ind.totalSpending ?? 0} max={maxIndustrySpend} width={90} />
                    <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>{formatMoney(ind.totalSpending)}</Text>
                  </div>
                ))}
              </div>
            ) : <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
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
  const maxBudget = useMemo(() => Math.max(1, ...data.map((a) => a.budgetAuthority ?? 0)), [data]);
  const selected = data.find((a) => a.slug === selectedSlug) ?? null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 1.2fr) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card size="small" title="97 Federal Agencies (by Budget Authority)">
          {agencies.isLoading ? <Skeleton active /> : data.length > 0 ? (
            <div style={{ maxHeight: 680, overflowY: 'auto' }}>
              {data.map((a, i) => (
                <div key={a.slug} onClick={() => setSelectedSlug(a.slug)} style={{ display: 'grid', gridTemplateColumns: '24px 60px 1fr 130px 110px', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer', background: selectedSlug === a.slug ? 'rgba(37, 99, 235, 0.08)' : 'transparent', borderRadius: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>
                  <Tag style={{ margin: 0, fontSize: 11 }}>{a.abbreviation ?? '—'}</Tag>
                  <Tooltip title={a.name}><Text ellipsis style={{ fontSize: 13 }}>{a.displayName ?? a.name}</Text></Tooltip>
                  <HBar value={a.budgetAuthority ?? 0} max={maxBudget} width={130} />
                  <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>{formatMoney(a.budgetAuthority)}</Text>
                </div>
              ))}
            </div>
          ) : <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>

        <div style={{ position: 'sticky', top: 16 }}>
          {selected ? (
            <Card size="small" title={<Space><BankOutlined /><span>{selected.displayName ?? selected.name}</span></Space>} extra={selected.abbreviation ? <Tag>{selected.abbreviation}</Tag> : null}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <Statistic title="Budget Authority" value={formatMoney(selected.budgetAuthority)} valueStyle={{ fontSize: 18 }} />
                <Statistic title="Cost / American" value={selected.costPerAmerican != null ? `$${Math.round(selected.costPerAmerican).toLocaleString()}` : '—'} valueStyle={{ fontSize: 18 }} />
                <Statistic title="Contracts" value={formatMoney(selected.contractsTotal)} valueStyle={{ fontSize: 16 }} />
                <Statistic title="Grants" value={formatMoney(selected.grantsTotal)} valueStyle={{ fontSize: 16 }} />
              </div>
              {selected.yearlyBudget.length > 0 && (
                <>
                  <Text strong style={{ fontSize: 12 }}>Budget trend (FY2017–2025)</Text>
                  <div style={{ marginTop: 4 }}>
                    <Sparkline data={selected.yearlyBudget} width={320} height={56} color="#2563eb" fillColor="rgba(37, 99, 235, 0.15)" />
                  </div>
                </>
              )}
              {selected.topContractors.length > 0 && (
                <>
                  <Text strong style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Top 10 contractors at this agency</Text>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {selected.topContractors.slice(0, 10).map((c, i) => {
                      const max = Math.max(...selected.topContractors.map((x) => x.amount), 1);
                      return (
                        <div key={c.name + i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 100px 90px', alignItems: 'center', gap: 8 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>
                          <Tooltip title={c.name}><Text ellipsis style={{ fontSize: 12 }}>{c.name}</Text></Tooltip>
                          <HBar value={c.amount} max={max} width={100} />
                          <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>{formatMoney(c.amount)}</Text>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </Card>
          ) : (
            <Card size="small"><Empty description="Select an agency to see details" /></Card>
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
      (await api.get<LobbyIntelSummary[]>('/api/lobby-intel/search', { params: { q: search } })).data,
    enabled: search.trim().length >= 2,
    staleTime: 30 * 1000,
  });

  const maxTopSpend = useMemo(() => Math.max(1, ...(overview.data?.topSpenders.map((s) => s.totalSpending ?? 0) ?? [])), [overview.data]);
  const maxIssueSpend = useMemo(() => Math.max(1, ...(overview.data?.hotIssues.map((s) => s.totalSpending ?? 0) ?? [])), [overview.data]);
  const data = overview.data;
  const isEmpty = !overview.isLoading && data && data.totalClients === 0;

  return (
    <div>
      {overview.isError ? <Alert type="error" message="Could not load federal lobbying intelligence" description={(overview.error as Error)?.message} style={{ marginBottom: 16 }} /> : null}
      {isEmpty ? <Alert type="info" showIcon message="No data yet" description={<span>Run <Text code>pnpm --filter @capiro/api sync:openlobby</Text> to populate.</span>} style={{ marginBottom: 24 }} /> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Card size="small"><Statistic title="Tracked Clients" value={data?.totalClients ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22 }} /></Card>
        <Card size="small"><Statistic title="Surging Issues" value={data?.surgingIssues.length ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22, color: '#ef4444' }} prefix={<RiseOutlined />} /></Card>
        <Card size="small"><Statistic title="Exploding Clients" value={data?.exploding.length ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22, color: '#f59e0b' }} prefix={<ThunderboltOutlined />} /></Card>
        <Card size="small"><Statistic title="Trending Terms" value={data?.trendingTopics.length ?? 0} loading={overview.isLoading} valueStyle={{ fontSize: 22 }} /></Card>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search placeholder="Search 5,000+ federal lobbying clients by name…" allowClear enterButton size="middle" onChange={(e) => setSearch(e.target.value)} value={search} />
        {search.trim().length >= 2 ? (
          <div style={{ marginTop: 12 }}>
            {searchResults.isLoading ? <Spin /> : searchResults.data && searchResults.data.length > 0 ? (
              <Table size="small" rowKey="id" dataSource={searchResults.data} pagination={false}
                columns={[
                  { title: 'Client', dataIndex: 'name', render: (n: string, r: LobbyIntelSummary) => <Space><Text strong>{n}</Text>{trajectoryTag(r.trajectory)}</Space> },
                  { title: 'State', dataIndex: 'state', width: 70, render: (s: string | null) => s ?? '—' },
                  { title: 'Total Spend', dataIndex: 'totalSpending', width: 130, align: 'right', render: (v: number | null) => formatMoney(v) },
                  { title: 'Trajectory', dataIndex: 'yearlySpend', width: 180, render: (ys: { year: number; amount: number }[]) => <Sparkline data={ys ?? []} width={150} height={28} /> },
                  { title: 'Top LDA Issues', dataIndex: 'issues', render: (i: string[]) => <Space size={[2, 4]} wrap>{(i ?? []).slice(0, 6).map((c) => <Tag key={c} style={{ marginRight: 0, fontSize: 11 }}>{c}</Tag>)}{i && i.length > 6 ? <Text type="secondary" style={{ fontSize: 11 }}>+{i.length - 6}</Text> : null}</Space> },
                ]}
              />
            ) : <Empty description="No matches" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        ) : null}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card size="small" title={<Space><FireOutlined style={{ color: '#ef4444' }} /><span>Surging LDA Issues (latest quarter)</span></Space>} extra={data?.surgingIssues[0]?.latestQuarter ? <Text type="secondary" style={{ fontSize: 12 }}>vs prior year • {data.surgingIssues[0].latestQuarter}</Text> : null}>
            {overview.isLoading ? <Skeleton active /> : data && data.surgingIssues.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.surgingIssues.map((iss) => (
                  <div key={iss.code} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 110px 90px', alignItems: 'center', gap: 12, padding: '8px 4px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <Tag color="default" style={{ margin: 0 }}>{iss.code}</Tag>
                    <Text>{iss.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>{formatMoney(iss.latestIncome)} /Q</Text>
                    <div style={{ textAlign: 'right' }}>{surgeBadge(iss.surgeTrend, iss.surgePct)}</div>
                  </div>
                ))}
              </div>
            ) : <Empty description="No surge data yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

          <Card size="small" title="Top Federal Lobbying Spenders" extra={<Text type="secondary" style={{ fontSize: 12 }}>2018–2025</Text>}>
            {overview.isLoading ? <Skeleton active /> : data && data.topSpenders.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.topSpenders.slice(0, 12).map((c, i) => (
                  <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 140px 110px 60px', alignItems: 'center', gap: 10, padding: '6px 4px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>
                    <Tooltip title={c.name}><Text ellipsis style={{ maxWidth: 360 }}>{c.name}</Text></Tooltip>
                    <HBar value={c.totalSpending ?? 0} max={maxTopSpend} width={140} />
                    <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>{formatMoney(c.totalSpending)}</Text>
                    <Sparkline data={c.yearlySpend ?? []} width={55} height={20} />
                  </div>
                ))}
              </div>
            ) : <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card size="small" title="Hottest LDA Issues (cumulative)">
            {overview.isLoading ? <Skeleton active /> : data && data.hotIssues.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.hotIssues.map((iss) => (
                  <div key={iss.code} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 80px 80px', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <Tag style={{ margin: 0 }}>{iss.code}</Tag>
                    <Tooltip title={iss.name}><Text ellipsis style={{ fontSize: 12 }}>{iss.name}</Text></Tooltip>
                    <HBar value={iss.totalSpending ?? 0} max={maxIssueSpend} width={80} />
                    <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>{formatMoney(iss.totalSpending)}</Text>
                  </div>
                ))}
              </div>
            ) : <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

          <Card size="small" title="Trending Terms in Filings" extra={<Text type="secondary" style={{ fontSize: 12 }}>AI-injected into drafts</Text>}>
            {overview.isLoading ? <Skeleton active /> : data && data.trendingTopics.length > 0 ? (
              <Space size={[6, 8]} wrap>
                {data.trendingTopics.slice(0, 30).map((t) => {
                  const grow = t.growthPct ?? 0;
                  const intensity = Math.min(1, Math.log10(Math.max(grow, 1)) / 4);
                  return (
                    <Tooltip key={t.word} title={t.growthPct != null ? `${Math.round(t.growthPct)}% growth vs prior years` : `${t.latestCount.toLocaleString()} mentions`}>
                      <Tag color="red" style={{ margin: 0, fontSize: 12 + intensity * 4, opacity: 0.6 + intensity * 0.4 }}>{t.word}</Tag>
                    </Tooltip>
                  );
                })}
              </Space>
            ) : <Empty description="No trending data" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

          <Card size="small" title="About this data">
            <Paragraph style={{ fontSize: 12, marginBottom: 6 }} type="secondary">
              Lobbying: <a href="https://www.openlobby.us/" target="_blank" rel="noreferrer">OpenLobby</a> / Senate <a href="https://lda.senate.gov/" target="_blank" rel="noreferrer">LDA</a>.
            </Paragraph>
            <Paragraph style={{ fontSize: 12, margin: 0 }} type="secondary">
              Contracting: <a href="https://www.openspending.us/" target="_blank" rel="noreferrer">OpenSpending</a> / <a href="https://www.usaspending.gov/" target="_blank" rel="noreferrer">USASpending.gov</a>.
            </Paragraph>
          </Card>
        </div>
      </div>
    </div>
  );
}
