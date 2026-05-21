import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Empty,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { BankOutlined } from '@ant-design/icons';
import { useApi } from '../../../lib/use-api.js';
import { HBar, Sparkline } from '../../../components/charts.js';
import type { FederalAgency } from '../types.js';
import { formatMoney } from '../utils.js';

const { Text } = Typography;

export function AgenciesPanel() {
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
