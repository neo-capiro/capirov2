import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ArrowLeftOutlined, TrophyOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type { IssueLeaderboard, LeaderboardRegistrant } from './types.js';
import { formatMoney, formatNum } from './utils.jsx';

const { Text, Title } = Typography;

export function IssueLeaderboardPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const api = useApi();

  const query = useQuery<IssueLeaderboard>({
    queryKey: ['issue-leaderboard', code],
    queryFn: async () =>
      (await api.get<IssueLeaderboard>(`/api/intelligence/issues/${code!}/leaderboard`)).data,
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  });

  const data = query.data;

  const columns = [
    {
      title: '#',
      width: 50,
      render: (_: unknown, _r: LeaderboardRegistrant, idx: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{idx + 1}</Text>
      ),
    },
    {
      title: 'Registrant',
      dataIndex: 'name',
      render: (name: string, record: LeaderboardRegistrant) => (
        <Space>
          <Text style={{ fontSize: 13 }}>{name}</Text>
          {record.isNewEntrant && <Tag color="red" style={{ fontSize: 10 }}>NEW</Tag>}
        </Space>
      ),
    },
    {
      title: 'Filings (2y)',
      dataIndex: 'filingCount',
      width: 110,
      defaultSortOrder: 'descend' as const,
      sorter: (a: LeaderboardRegistrant, b: LeaderboardRegistrant) => a.filingCount - b.filingCount,
      render: (v: number) => <Text strong>{formatNum(v)}</Text>,
    },
    {
      title: 'Total Income',
      dataIndex: 'totalIncome',
      width: 140,
      sorter: (a: LeaderboardRegistrant, b: LeaderboardRegistrant) => a.totalIncome - b.totalIncome,
      render: (v: number) => <Text>{formatMoney(v)}</Text>,
    },
    {
      title: 'First Filing',
      dataIndex: 'firstFilingDate',
      width: 120,
      render: (d: string | null) => d ? new Date(d).toLocaleDateString() : '—',
    },
    {
      title: 'Shared Lobbyists',
      dataIndex: 'sharedLobbyists',
      width: 160,
      render: (lobbyists: string[]) =>
        lobbyists.length > 0 ? (
          <Tooltip title={lobbyists.join(', ')}>
            <Tag color="orange" style={{ fontSize: 11 }}>
              {lobbyists.length} shared lobbyist{lobbyists.length > 1 ? 's' : ''}
            </Tag>
          </Tooltip>
        ) : null,
    },
  ];

  const newEntrantCount = data?.registrants.filter((r) => r.isNewEntrant).length ?? 0;
  const sharedLobbyistCount = data?.registrants.filter((r) => r.sharedLobbyists.length > 0).length ?? 0;

  return (
    <div
      className="redesign"
      style={{ padding: '24px 32px', overflow: 'auto', height: '100%', background: 'var(--bg-canvas)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate(-1)} />
        <TrophyOutlined style={{ fontSize: 20, color: '#faad14' }} />
        <Title level={4} style={{ margin: 0 }}>
          Issue Leaderboard: {code}
        </Title>
        {data && <Tag style={{ fontSize: 12 }}>{data.issueName}</Tag>}
      </div>

      {query.isLoading && <Skeleton active paragraph={{ rows: 12 }} />}

      {query.isError && (
        <Alert
          type="error"
          message="Failed to load leaderboard"
          description={(query.error as Error)?.message}
          style={{ marginBottom: 16 }}
        />
      )}

      {data && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <Card size="small">
              <Statistic
                title="Total Filings (2y)"
                value={data.totalFilings}
                formatter={(v) => formatNum(v as number)}
              />
            </Card>
            <Card size="small">
              <Statistic title="Registrants" value={data.registrants.length} />
            </Card>
            <Card size="small">
              <Statistic
                title="New Entrants (90d)"
                value={newEntrantCount}
                valueStyle={newEntrantCount > 0 ? { color: '#ff4d4f' } : undefined}
              />
            </Card>
            <Card size="small">
              <Statistic
                title="Shared Lobbyist Overlap"
                value={sharedLobbyistCount}
                valueStyle={sharedLobbyistCount > 0 ? { color: '#fa8c16' } : undefined}
              />
            </Card>
          </div>

          <Table<LeaderboardRegistrant>
            rowKey="name"
            size="small"
            dataSource={data.registrants}
            columns={columns}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{
              emptyText: (
                <Empty description="No registrants found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
            }}
          />
        </>
      )}
    </div>
  );
}
