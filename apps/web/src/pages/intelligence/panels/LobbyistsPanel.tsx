import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  Collapse,
  Input,
  Skeleton,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { useApi } from '../../../lib/use-api.js';
import type { LdaLobbyist, PagedResult } from '../types.js';
import { formatNum, formatPosition } from '../utils.js';

const { Text, Paragraph } = Typography;

export function LobbyistsPanel() {
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
                  {(years ?? []).sort().join(', ') || '-'}
                </Text>
              ),
            },
            {
              title: 'Former Positions',
              dataIndex: 'coveredPositions',
              render: (positions: unknown[]) => {
                const arr = Array.isArray(positions) ? positions : [];
                if (arr.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>-</Text>;
                const first = formatPosition(arr[0]);
                return (
                  <Tooltip
                    title={arr.map((p, i) => formatPosition(p) || `Role ${i + 1}`).join(' | ')}
                  >
                    <Space direction="vertical" size={2}>
                      <Space size={4}>
                        <Badge color="gold" />
                        <Text style={{ fontSize: 12 }}>{first || 'Gov. role'}</Text>
                      </Space>
                      {arr.length > 1 && (
                        <Text type="secondary" style={{ fontSize: 11 }}>+{arr.length - 1} more</Text>
                      )}
                    </Space>
                  </Tooltip>
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
