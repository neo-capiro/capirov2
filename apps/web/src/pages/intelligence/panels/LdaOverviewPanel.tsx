import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Divider,
  Empty,
  Skeleton,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  AuditOutlined,
  FileTextOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useApi } from '../../../lib/use-api.js';
import { HBar, TrendAreaChart } from '../../../components/charts.js';
import type { LdaDashboard, LdaTrend, LdaIssueCode, LdaIssueDetail, LdaEntity } from '../types.js';
import { formatMoney, formatNum, issueTagColor } from '../utils.js';

const { Text } = Typography;

export function LdaOverviewPanel({
  clientFilter = '',
  onNavigate,
}: {
  clientFilter?: string;
  onNavigate?: (tab: string, client?: string) => void;
}) {
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
  const topClients = (dash?.topClients ?? []).filter(
    (c) => !clientFilter || c.name.toLowerCase().includes(clientFilter.toLowerCase()),
  );
  const maxClientSpend = Math.max(1, ...topClients.map((c) => c.totalSpending ?? 0));

  const sortedTrends = useMemo(
    () =>
      [...(trends.data ?? [])].sort((a, b) =>
        a.year !== b.year ? a.year - b.year : a.period.localeCompare(b.period),
      ),
    [trends.data],
  );
  const latestTrend = sortedTrends[sortedTrends.length - 1];
  const priorTrend = sortedTrends[sortedTrends.length - 2];
  const qoqFilingChange =
    latestTrend && priorTrend && priorTrend.filingCount > 0
      ? ((latestTrend.filingCount - priorTrend.filingCount) / priorTrend.filingCount) * 100
      : null;
  const qoqIncomeChange =
    latestTrend && priorTrend && (priorTrend.totalIncome ?? 0) > 0
      ? (((latestTrend.totalIncome ?? 0) - (priorTrend.totalIncome ?? 0)) /
          (priorTrend.totalIncome ?? 1)) *
        100
      : null;
  const topSurgingIssue = topIssues[0] ?? null;

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

      {/* QoQ Comparison cards */}
      {!trends.isLoading && sortedTrends.length >= 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
          <Card size="small" style={{ borderTop: '3px solid #10b981' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              Filings QoQ, {latestTrend?.year} {latestTrend?.period}
            </Text>
            {qoqFilingChange != null ? (
              <Space align="center">
                <Text strong style={{ fontSize: 22, color: qoqFilingChange >= 0 ? '#10b981' : '#ef4444' }}>
                  {qoqFilingChange >= 0 ? '+' : ''}{Math.round(qoqFilingChange)}%
                </Text>
                {qoqFilingChange >= 0 ? (
                  <ArrowUpOutlined style={{ color: '#10b981' }} />
                ) : (
                  <ArrowDownOutlined style={{ color: '#ef4444' }} />
                )}
              </Space>
            ) : (
              <Text type="secondary">-</Text>
            )}
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              {formatNum(latestTrend?.filingCount)} vs {formatNum(priorTrend?.filingCount)} prior
            </Text>
          </Card>
          <Card size="small" style={{ borderTop: '3px solid #8b5cf6' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              Income QoQ, {latestTrend?.year} {latestTrend?.period}
            </Text>
            {qoqIncomeChange != null ? (
              <Space align="center">
                <Text strong style={{ fontSize: 22, color: qoqIncomeChange >= 0 ? '#8b5cf6' : '#ef4444' }}>
                  {qoqIncomeChange >= 0 ? '+' : ''}{Math.round(qoqIncomeChange)}%
                </Text>
                {qoqIncomeChange >= 0 ? (
                  <ArrowUpOutlined style={{ color: '#8b5cf6' }} />
                ) : (
                  <ArrowDownOutlined style={{ color: '#ef4444' }} />
                )}
              </Space>
            ) : (
              <Text type="secondary">-</Text>
            )}
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              {formatMoney(latestTrend?.totalIncome)} vs {formatMoney(priorTrend?.totalIncome)}
            </Text>
          </Card>
          <Card size="small" style={{ borderTop: '3px solid #f59e0b' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              Top Issue Area (5yr spend)
            </Text>
            {topSurgingIssue ? (
              <>
                <Text strong style={{ fontSize: 22, color: '#f59e0b' }}>{topSurgingIssue.code}</Text>
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                  {topSurgingIssue.name}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {formatMoney(topSurgingIssue.totalSpending5y)}
                </Text>
              </>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Card>
        </div>
      )}

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
              <Text strong style={{ fontSize: 12 }}>Top clients, {selectedIssue}</Text>
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
                  <Tooltip title={`View filings for ${c.name}`}>
                    <Text
                      ellipsis
                      style={{ fontSize: 13, cursor: 'pointer', color: '#2563eb' }}
                      onClick={() => onNavigate?.('filings', c.name)}
                    >
                      {c.name}
                    </Text>
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
