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
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  FireOutlined,
  RiseOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import { Sparkline, HBar } from '../../components/charts.js';

const { Title, Text, Paragraph } = Typography;

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

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—';
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
    trend === 'declining' ? (
      <ArrowDownOutlined />
    ) : trend === 'stable' ? null : (
      <ArrowUpOutlined />
    );
  return (
    <Tag color={colors[trend] ?? 'default'}>
      {arrow} {pct != null ? `${pct > 0 ? '+' : ''}${Math.round(pct)}%` : trend}
    </Tag>
  );
}

export function IntelligenceCenterPage() {
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
  const isEmpty =
    !overview.isLoading && data && data.totalClients === 0;

  return (
    <div style={{ padding: '24px 32px', overflow: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <FireOutlined style={{ color: '#ef4444', marginRight: 8 }} />
          Federal Lobbying Intelligence
        </Title>
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
          Live market intel from Senate LDA filings — top spenders, surging issues, and trending
          topics across all 23,500+ registered federal lobbyists.{' '}
          {data?.lastSyncedAt ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Last synced: {new Date(data.lastSyncedAt).toLocaleString()}
            </Text>
          ) : null}
        </Paragraph>
      </div>

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
              The federal intelligence dataset has not been synced. Run{' '}
              <Text code>pnpm --filter @capiro/api sync:openlobby</Text> to populate.
            </span>
          }
          style={{ marginBottom: 24 }}
        />
      ) : null}

      {/* Headline stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 24,
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
            title="LDA Issue Codes"
            value={data?.hotIssues.length ?? 0}
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
      </div>

      {/* Search */}
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
        {/* LEFT column */}
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
            title="Top Federal Lobbying Spenders (all-time)"
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

          <Card
            size="small"
            title={
              <Space>
                <ThunderboltOutlined style={{ color: '#f59e0b' }} />
                <span>Exploding Clients (100%+ growth)</span>
              </Space>
            }
          >
            {overview.isLoading ? (
              <Skeleton active />
            ) : data && data.exploding.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 8,
                }}
              >
                {data.exploding.slice(0, 12).map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: 10,
                      border: '1px solid rgba(0,0,0,0.06)',
                      borderRadius: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <Tooltip title={c.name}>
                      <Text strong ellipsis style={{ fontSize: 13 }}>
                        {c.name}
                      </Text>
                    </Tooltip>
                    <Space size={6}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {c.state ?? '—'}
                      </Text>
                      <Text style={{ fontSize: 12 }}>{formatMoney(c.totalSpending)}</Text>
                      {c.growthRate != null && c.growthRate !== 0 ? (
                        <Tag color="red" style={{ margin: 0, fontSize: 11 }}>
                          <ArrowUpOutlined />{' '}
                          {Math.round(c.growthRate)}%
                        </Tag>
                      ) : null}
                    </Space>
                    <Sparkline data={c.yearlySpend ?? []} width={200} height={28} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </div>

        {/* RIGHT column */}
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
            <Paragraph style={{ fontSize: 12, marginBottom: 8 }} type="secondary">
              Source: <a href="https://www.openlobby.us/" target="_blank" rel="noreferrer">OpenLobby</a>,
              derived from public Senate{' '}
              <a href="https://lda.senate.gov/" target="_blank" rel="noreferrer">
                LDA filings
              </a>
              . Refreshed via{' '}
              <Text code style={{ fontSize: 11 }}>
                pnpm sync:openlobby
              </Text>
              .
            </Paragraph>
            <Paragraph style={{ fontSize: 12, margin: 0 }} type="secondary">
              All Capiro tenants share the same federal reference dataset. Trending terms and
              surging issues are auto-injected into AI doc-gen prompts.
            </Paragraph>
          </Card>
        </div>
      </div>
    </div>
  );
}
