import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Input,
  Skeleton,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { useApi } from '../../../lib/use-api.js';
import type { LdaRegistrant, PagedResult } from '../types.js';
import { formatNum } from '../utils.js';

const { Text } = Typography;

export function FirmsPanel({ onNavigate }: { onNavigate?: (tab: string, client?: string) => void }) {
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
                  <Tooltip title="View filings for this firm">
                    <Text
                      strong
                      style={{ fontSize: 13, cursor: 'pointer', color: '#2563eb' }}
                      onClick={() => onNavigate?.('filings', n)}
                    >
                      {n}
                    </Text>
                  </Tooltip>
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
