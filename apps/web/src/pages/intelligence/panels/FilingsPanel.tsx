import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../../lib/use-api.js';
import type { LdaFiling, PagedResult } from '../types.js';
import { formatMoney, formatNum, issueTagColor } from '../utils.js';

const { Text } = Typography;

export function FilingsPanel({ defaultClient = '' }: { defaultClient?: string }) {
  const api = useApi();
  const [page, setPage] = useState(1);
  const [client, setClient] = useState(defaultClient);
  const [registrant, setRegistrant] = useState('');
  const [year, setYear] = useState<number | undefined>();
  const [issue, setIssue] = useState('');
  const [search, setSearch] = useState({ client: defaultClient, registrant: '', year: undefined as number | undefined, issue: '' });

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
              styles={{ body: { padding: '10px 14px' } }}
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
              <Button.Group>
                <Button
                  size="small"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← Prev
                </Button>
                <Button size="small" disabled style={{ cursor: 'default', opacity: 1 }}>
                  Page {page}
                </Button>
                <Button
                  size="small"
                  disabled={!filings.data || page * 25 >= filings.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next →
                </Button>
              </Button.Group>
          </div>
        </div>
      )}
    </div>
  );
}
