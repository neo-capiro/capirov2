import { useQuery } from '@tanstack/react-query';
import {
  Col,
  Row,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { CongressBillDetail } from './types.js';

const { Text } = Typography;

export function BillDetailRow({ billId }: { billId: string }) {
  const api = useApi();
  const detail = useQuery<CongressBillDetail>({
    queryKey: ['congress-bill-detail', billId],
    queryFn: async () =>
      (await api.get<CongressBillDetail>(`/api/lda-intel/congress/bills/${billId}`)).data,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (detail.isLoading) return <div style={{ padding: 16 }}><Spin size="small" /></div>;
  if (detail.isError || !detail.data) return (
    <div style={{ padding: '8px 24px' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>Details not available</Text>
    </div>
  );

  const d = detail.data;
  return (
    <div style={{ padding: '8px 32px 16px', background: 'rgba(0,0,0,0.02)' }}>
      <Row gutter={24}>
        <Col span={10}>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Actions Timeline</Text>
          {d.actions?.length > 0 ? (
            <Timeline
              items={(d.actions ?? []).slice(0, 8).map((a) => ({
                key: a.id,
                children: (
                  <div>
                    <Text style={{ fontSize: 11 }}>{a.text}</Text>
                    <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                      {new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      {a.chamber ? ` · ${a.chamber}` : ''}
                    </Text>
                  </div>
                ),
              }))}
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>No actions recorded</Text>
          )}
        </Col>
        <Col span={7}>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Committee Referrals</Text>
          {d.committees?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(d.committees ?? []).map((c) => (
                <div key={c.id}>
                  <Text style={{ fontSize: 12 }}>{c.committeeName}</Text>
                  {c.chamber && <Tag style={{ marginLeft: 4, fontSize: 10 }}>{c.chamber}</Tag>}
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>No committee referrals</Text>
          )}
        </Col>
        <Col span={7}>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Subjects</Text>
          {d.subjects?.length > 0 ? (
            <Space size={[4, 6]} wrap>
              {(d.subjects ?? []).map((s) => (
                <Tag key={s.id} style={{ fontSize: 11 }}>{s.name}</Tag>
              ))}
            </Space>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>No subjects recorded</Text>
          )}
        </Col>
      </Row>
    </div>
  );
}
