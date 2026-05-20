import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Progress, Skeleton, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type { Strategy } from './workflowTypes.js';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  active: 'blue',
  complete: 'green',
  archived: 'default',
  draft: 'orange',
};

export function StrategiesList() {
  const navigate = useNavigate();
  const api = useApi();

  const { data: strategies, isLoading } = useQuery<Strategy[]>({
    queryKey: ['strategies'],
    queryFn: () => api.get('/api/strategies').then((r) => r.data),
  });

  function calcProgress(strategy: Strategy): { completed: number; total: number } {
    const instances = (strategy as any).instances ?? [];
    const total = instances.length;
    const completed = instances.filter(
      (i: any) => i.status === 'submitted' || i.status === 'complete'
    ).length;
    return { completed, total };
  }

  if (isLoading) {
    return (
      <div className="strategy-list" style={{ padding: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <Title level={4} style={{ margin: 0 }}>Strategies</Title>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {[1, 2, 3].map((n) => (
            <Card key={n}>
              <Skeleton active paragraph={{ rows: 3 }} />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="strategy-list" style={{ padding: 32 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 28,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          Strategies
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/workspace/strategy/new')}
        >
          New Strategy
        </Button>
      </div>

      {!strategies || strategies.length === 0 ? (
        <Empty
          description="No strategies yet"
          style={{ marginTop: 80 }}
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/workspace/strategy/new')}
          >
            New Strategy
          </Button>
        </Empty>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 20,
          }}
        >
          {strategies.map((strategy) => {
            const { completed, total } = calcProgress(strategy);
            const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
            const clientName = (strategy as any).client?.name ?? '';
            const status = (strategy.status as string) ?? 'active';

            return (
              <Card
                key={strategy.id}
                className="strategy-card"
                hoverable
                onClick={() => navigate(`/workspace/strategy/${strategy.id}`)}
                style={{ cursor: 'pointer' }}
                styles={{ body: { padding: '20px 24px' } }}
              >
                <div style={{ marginBottom: 12 }}>
                  <Text
                    strong
                    style={{ fontSize: 15, display: 'block', marginBottom: 6, lineHeight: 1.4 }}
                  >
                    {strategy.name}
                  </Text>
                  {clientName && (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {clientName}
                    </Text>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  <Tag color="geekblue">{strategy.fiscalYear}</Tag>
                  <Tag color={STATUS_COLORS[status] ?? 'default'}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Tag>
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Submissions
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {completed}/{total}
                    </Text>
                  </div>
                  <Progress
                    percent={progressPct}
                    showInfo={false}
                    size="small"
                    strokeColor={progressPct === 100 ? '#52c41a' : '#1c2e4a'}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
