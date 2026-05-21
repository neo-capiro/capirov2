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
import { BankOutlined, ShopOutlined } from '@ant-design/icons';
import { useApi } from '../../../lib/use-api.js';
import { HBar, Sparkline } from '../../../components/charts.js';
import type { FederalContractor, FederalSpendingOverview } from '../types.js';
import { CATEGORY_COLORS, formatMoney } from '../utils.js';

const { Text } = Typography;

export function ContractingPanel() {
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
          <Card size="small" title="Top No-Bid Recipients" extra={<Text type="secondary" style={{ fontSize: 12 }}>Sole-source awards</Text>}>
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
