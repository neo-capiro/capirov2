import { Card, Empty, List, Skeleton, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { ProgramElementBill } from './types.js';

const { Text } = Typography;

export interface BillsTouchingPePanelProps {
  bills: ProgramElementBill[];
  loading?: boolean;
}

function truncate(value: string, max = 72): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

// Congress.gov bill-type codes → conventional citation form (e.g. HR → "H.R.").
const BILL_TYPE_LABELS: Record<string, string> = {
  HR: 'H.R.',
  S: 'S.',
  HJRES: 'H.J.Res.',
  SJRES: 'S.J.Res.',
  HCONRES: 'H.Con.Res.',
  SCONRES: 'S.Con.Res.',
  HRES: 'H.Res.',
  SRES: 'S.Res.',
};

function billLabel(bill: ProgramElementBill): string {
  const type = BILL_TYPE_LABELS[bill.billType?.toUpperCase()] ?? bill.billType ?? '';
  return `${type} ${bill.billNumber}`.trim() || bill.id;
}

function formatActionDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    <Card
      title="Bills touching this PE"
      extra={<Text type="secondary">{bills.length} linked</Text>}
    >
      <List
        dataSource={bills}
        renderItem={(bill) => {
          // Honest action chip: show passage probability only when the model
          // actually produced one; otherwise surface the policy area, which is
          // real metadata, instead of a misleading "N/A" score.
          const hasProbability = typeof bill.passageProbability === 'number';
          const actionDate = formatActionDate(bill.latestActionDate);
          const meta = [bill.sponsor ?? 'Sponsor N/A', bill.committee ?? 'Committee N/A'];
          if (actionDate) meta.push(`Last action ${actionDate}`);

          return (
            <List.Item
              key={bill.id}
              onClick={() => navigate(`/intelligence/bills/${encodeURIComponent(bill.id)}`)}
              style={{ cursor: 'pointer' }}
              actions={[
                hasProbability ? (
                  <Tag key="probability" color={probabilityColor(bill.passageProbability)}>
                    {probabilityLabel(bill.passageProbability)}
                  </Tag>
                ) : bill.policyArea ? (
                  <Tag key="policy" color="blue">
                    {bill.policyArea}
                  </Tag>
                ) : (
                  <Text key="congress" type="secondary">
                    {bill.congress}th
                  </Text>
                ),
              ]}
            >
              <List.Item.Meta
                title={
                  <Space direction="vertical" size={2}>
                    <Text strong>{billLabel(bill)}</Text>
                    <Text>{truncate(bill.title)}</Text>
                  </Space>
                }
                description={<Text type="secondary">{meta.join(' • ')}</Text>}
              />
            </List.Item>
          );
        }}
      />
    </Card>
  );
}

export function billProbabilityColor(probability: number | null | undefined): string {
  return probabilityColor(probability);
}
