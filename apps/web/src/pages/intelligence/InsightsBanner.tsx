import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { BulbOutlined, SyncOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import type { IntelligenceInsight } from './types.js';

const { Text, Paragraph } = Typography;

export function InsightsBanner() {
  const api = useApi();

  const insights = useQuery<IntelligenceInsight[]>({
    queryKey: ['intel-insights'],
    queryFn: async () => (await api.get<IntelligenceInsight[]>('/api/lda-intel/insights')).data,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const severityStyle: Record<string, { borderColor: string; bg: string }> = {
    info: { borderColor: '#2563eb', bg: 'rgba(37,99,235,0.03)' },
    notable: { borderColor: '#f59e0b', bg: 'rgba(245,158,11,0.03)' },
    critical: { borderColor: '#ef4444', bg: 'rgba(239,68,68,0.03)' },
  };

  if (insights.isError || (!insights.isLoading && !(insights.data?.length))) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space>
          <BulbOutlined style={{ color: '#f59e0b' }} />
          <Text strong style={{ fontSize: 13 }}>AI Insights</Text>
          {insights.data?.length ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{insights.data.length} active</Text>
          ) : null}
        </Space>
        <Button
          size="small"
          icon={<SyncOutlined spin={insights.isFetching} />}
          onClick={() => void insights.refetch()}
          loading={insights.isFetching}
        >
          Refresh Insights
        </Button>
      </div>
      {insights.isLoading ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {(insights.data ?? []).map((ins) => {
            const s = severityStyle[ins.severity] ?? { borderColor: '#2563eb', bg: 'rgba(37,99,235,0.03)' };
            return (
              <Card
                key={ins.id}
                size="small"
                style={{ minWidth: 220, maxWidth: 280, borderLeft: `3px solid ${s.borderColor}`, background: s.bg, flexShrink: 0 }}
                styles={{ body: { padding: '10px 12px' } }}
              >
                <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{ins.title}</Text>
                <Paragraph
                  ellipsis={{ rows: 2 }}
                  style={{ fontSize: 11, marginBottom: 4, color: 'rgba(0,0,0,0.6)' }}
                >
                  {ins.body}
                </Paragraph>
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {new Date(ins.generatedAt).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
