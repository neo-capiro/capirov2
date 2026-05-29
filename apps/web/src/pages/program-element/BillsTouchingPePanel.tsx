import { Card, Empty, List, Skeleton, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { ProgramElementBill } from './types.js';

const { Text } = Typography;

export interface BillsTouchingPePanelProps {
  bills: ProgramElementBill[];
  loading?: boolean;
}

function truncate(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function probabilityColor(probability: number | null | undefined): string {
  const p = typeof probability === 'number' ? probability : 0;
  if (p > 0.7) return 'green';
  if (p >= 0.4) return 'gold';
  return 'red';
}

function probabilityLabel(probability: number | null | undefined): string {
  if (typeof probability !== 'number') return 'N/A';
  return `${Math.round(probability * 100)}%`;
}

export function BillsTouchingPePanel({ bills, loading = false }: BillsTouchingPePanelProps) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <Card title="Bills touching this PE">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    );
  }

  if (bills.length === 0) {
    return (
      <Card title="Bills touching this PE">
        <Empty description="No linked bills yet" />
      </Card>
    );
  }

  return (
    <Card title="Bills touching this PE">
      <List
        dataSource={bills}
        renderItem={(bill) => (
          <List.Item
            key={bill.id}
            onClick={() => navigate(`/bills/${encodeURIComponent(bill.id)}`)}
            style={{ cursor: 'pointer' }}
            actions={[
              <Tag key="probability" color={probabilityColor(bill.passageProbability)}>
                {probabilityLabel(bill.passageProbability)}
              </Tag>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space direction="vertical" size={2}>
                  <Text strong>{bill.id}</Text>
                  <Text>{truncate(bill.title, 60)}</Text>
                </Space>
              }
              description={
                <Text type="secondary">
                  {(bill.sponsor ?? 'Sponsor N/A') + ' • ' + (bill.committee ?? 'Committee N/A')}
                </Text>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
}

export function billProbabilityColor(probability: number | null | undefined): string {
  return probabilityColor(probability);
}
