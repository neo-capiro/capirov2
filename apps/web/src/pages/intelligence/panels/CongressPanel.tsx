import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../../lib/use-api.js';
import type { CongressBill, PagedResult } from '../types.js';
import { BillDetailRow } from '../BillDetailRow.js';

const { Text } = Typography;

export function CongressPanel({ defaultSearch = '' }: { defaultSearch?: string }) {
  const api = useApi();
  const [search, setSearch] = useState(defaultSearch);
  const [query, setQuery] = useState(defaultSearch);
  const [policyArea, setPolicyArea] = useState('');
  const [congress, setCongress] = useState<number | undefined>();
  const [activeBillsOnly, setActiveBillsOnly] = useState(false);
  const [page, setPage] = useState(1);

  const activeSince = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);

  const bills = useQuery<PagedResult<CongressBill>>({
    queryKey: ['lda-bills', query, policyArea, congress, activeBillsOnly, page],
    queryFn: async () =>
      (await api.get<PagedResult<CongressBill>>('/api/lda-intel/congress/bills', {
        params: {
          q: query || undefined,
          policyArea: policyArea || undefined,
          congress,
          page,
          limit: 25,
          activeSince: activeBillsOnly ? activeSince : undefined,
        },
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
          <Col>
            <Button
              type={activeBillsOnly ? 'primary' : 'default'}
              size="middle"
              onClick={() => { setActiveBillsOnly((v) => !v); setPage(1); }}
            >
              {activeBillsOnly ? '✓ Active Bills' : 'Active Bills'}
            </Button>
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
          expandable={{
            expandedRowRender: (record) => <BillDetailRow billId={record.id} />,
            rowExpandable: () => true,
          }}
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
                ) : <Text type="secondary">-</Text>,
            },
            {
              title: 'Policy Area',
              dataIndex: 'policyArea',
              width: 140,
              render: (v: string | null) =>
                v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary">-</Text>,
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
                v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '-',
            },
          ]}
        />
      )}
    </div>
  );
}
