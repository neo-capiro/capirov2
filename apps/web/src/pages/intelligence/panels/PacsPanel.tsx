import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Input,
  Skeleton,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../../lib/use-api.js';
import type { FecCommittee, PagedResult } from '../types.js';
import { formatMoney } from '../utils.js';

const { Text } = Typography;

export function PacsPanel() {
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
                v ? <Tag color={v === 'REP' ? 'red' : v === 'DEM' ? 'blue' : 'default'}>{v}</Tag> : <Text type="secondary">-</Text>,
            },
            {
              title: 'State',
              dataIndex: 'state',
              width: 70,
              render: (v: string | null) => v ?? '-',
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
