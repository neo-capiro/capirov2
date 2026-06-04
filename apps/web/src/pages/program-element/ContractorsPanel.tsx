import { Card, Empty, Skeleton, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ProgramElementContractor, ProgramElementContractorsResponse } from './types.js';

const { Text } = Typography;

export interface ContractorsPanelProps {
  contractors: ProgramElementContractorsResponse | null | undefined;
  loading?: boolean;
}

function dollarsCompact(amountMm: number): string {
  if (amountMm >= 1000) {
    return `$${(amountMm / 1000).toFixed(1)}B`;
  }
  return `$${amountMm.toFixed(1)}M`;
}

const columns: ColumnsType<ProgramElementContractor> = [
  {
    title: 'Contractor',
    dataIndex: 'contractorName',
    key: 'contractorName',
    render: (name: string, row) => (
      <span>
        {name} {row.contractorIsCrmClient ? <Tag color="blue">CRM Client</Tag> : null}
        {row.isNewEntrant ? <Tag color="warning">New</Tag> : null}
        {row.source === 'program' ? (
          <Tooltip title={row.attribution ?? 'Linked via DoD Acquisition Program (USAspending)'}>
            <Tag color="geekblue">via Acq Program</Tag>
          </Tooltip>
        ) : null}
      </span>
    ),
  },
  {
    title: '$ obligated (24 mo)',
    dataIndex: 'amount',
    key: 'amount',
    align: 'right',
    sorter: (a, b) => a.amount - b.amount,
    defaultSortOrder: 'descend',
    render: (value: number) => dollarsCompact(value),
  },
  {
    title: 'Awards',
    dataIndex: 'awards',
    key: 'awards',
    align: 'right',
    render: (value: number | null | undefined) =>
      typeof value === 'number' ? value.toLocaleString() : '—',
  },
];

export function ContractorsPanel({ contractors, loading = false }: ContractorsPanelProps) {
  if (loading) {
    return (
      <Card title="Top contractors touching this PE">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    );
  }

  const rows = contractors?.data ?? [];
  if (rows.length === 0) {
    return (
      <Card className="pe-contractors-card" title="Top contractors touching this PE">
        <Empty
          description={
            contractors?.todo ??
            'No contractors linked to this program element yet. Capiro links awards by DoD acquisition program; programs without a contract-level program code (services, support) will not appear here.'
          }
        />
      </Card>
    );
  }

  const top10 = rows.slice(0, 10);
  const hasProgramLinked = top10.some((r) => r.source === 'program');

  return (
    <Card className="pe-contractors-card" title="Top contractors touching this PE">
      {contractors?.todo ? (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {contractors.todo}
        </Text>
      ) : null}
      <Table<ProgramElementContractor>
        rowKey={(row) => row.contractorName}
        size="small"
        pagination={false}
        columns={columns}
        dataSource={top10}
        rowClassName={(row) => {
          if (row.isNewEntrant) return 'contractor-row-warning contractor-row-highlight';
          if (row.contractorIsCrmClient) return 'contractor-row-crm contractor-row-highlight';
          return '';
        }}
      />
      {hasProgramLinked ? (
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          Rows tagged “via Acq Program” are linked through the contract’s DoD
          acquisition program code (USAspending), not a direct program-element
          attribution.
        </Text>
      ) : null}
    </Card>
  );
}

export function formatContractorDollars(amountMm: number): string {
  return dollarsCompact(amountMm);
}
