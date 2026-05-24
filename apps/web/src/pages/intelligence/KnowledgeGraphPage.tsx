import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Empty,
  Progress,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  BankOutlined,
  BarChartOutlined,
  FileTextOutlined,
  GlobalOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';

const { Text, Title } = Typography;

interface GraphNode {
  id: string;
  type: 'client' | 'registrant' | 'lobbyist' | 'contractor' | 'bill' | 'pac' | 'agency';
  label: string;
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  label: string;
}

interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  resolutionQuality: {
    avgConfidence: number;
    confirmedCount: number;
    unconfirmedCount: number;
  };
}

const NODE_TYPE_CONFIG: Record<
  GraphNode['type'],
  { color: string; icon: ReactNode; label: string }
> = {
  client: { color: '#1c2e4a', icon: <GlobalOutlined />, label: 'Client' },
  registrant: { color: '#1677ff', icon: <TeamOutlined />, label: 'LDA Registrant' },
  lobbyist: { color: '#722ed1', icon: <UserOutlined />, label: 'Lobbyist' },
  contractor: { color: '#52c41a', icon: <BarChartOutlined />, label: 'Contractor' },
  bill: { color: '#fa8c16', icon: <FileTextOutlined />, label: 'Bill' },
  pac: { color: '#f5222d', icon: <BankOutlined />, label: 'PAC/FEC' },
  agency: { color: '#8c8c8c', icon: <BankOutlined />, label: 'Agency' },
};

function NodeCard({ node, edges }: { node: GraphNode; edges: GraphEdge[] }) {
  const config = NODE_TYPE_CONFIG[node.type] ?? NODE_TYPE_CONFIG.registrant;
  const incomingEdges = edges.filter((e) => e.target === node.id);
  const outgoingEdges = edges.filter((e) => e.source === node.id);

  return (
    <Card
      size="small"
      style={{
        borderTop: `3px solid ${config.color}`,
        minWidth: 180,
        maxWidth: 240,
      }}
      title={
        <Space size={4}>
          <span style={{ color: config.color }}>{config.icon}</span>
          <Tag color={config.color} style={{ fontSize: 9, margin: 0 }}>
            {config.label}
          </Tag>
        </Space>
      }
    >
      <div>
        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {node.label}
        </Text>

        {node.type === 'registrant' && typeof node.metadata.filingCount === 'number' && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {(node.metadata.filingCount as number).toLocaleString()} filings
          </Text>
        )}

        {node.type === 'lobbyist' && Array.isArray(node.metadata.coveredPositions) && (node.metadata.coveredPositions as unknown[]).length > 0 && (
          <div style={{ marginTop: 4 }}>
            {(node.metadata.coveredPositions as Array<Record<string, unknown>>).slice(0, 2).map((pos, i) => (
              <div key={i} style={{ fontSize: 10, color: '#8c8c8c' }}>
                {typeof pos.position === 'string' ? pos.position.slice(0, 35) : ''}
              </div>
            ))}
          </div>
        )}

        {node.type === 'bill' && typeof node.metadata.title === 'string' && (
          <Text type="secondary" style={{ fontSize: 10 }}>
            {(node.metadata.title as string).slice(0, 60)}
          </Text>
        )}

        {node.type === 'agency' && typeof node.metadata.amount === 'number' && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            ${((node.metadata.amount as number) / 1e9).toFixed(1)}B in contracts
          </Text>
        )}

        {incomingEdges.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {incomingEdges.slice(0, 2).map((e, i) => (
              <Tag key={i} style={{ fontSize: 9, margin: '2px 0' }}>
                {e.label}
              </Tag>
            ))}
          </div>
        )}

        {outgoingEdges.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {outgoingEdges.slice(0, 2).map((e, i) => (
              <Tag key={i} color="default" style={{ fontSize: 9, margin: '2px 0' }}>
                → {e.label}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function EntityGroup({
  type,
  nodes,
  edges,
}: {
  type: GraphNode['type'];
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const config = NODE_TYPE_CONFIG[type];
  if (!nodes.length) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          paddingLeft: 4,
          borderLeft: `3px solid ${config.color}`,
        }}
      >
        <span style={{ color: config.color }}>{config.icon}</span>
        <Text strong style={{ fontSize: 13, color: config.color }}>
          {config.label}s
        </Text>
        <Badge count={nodes.length} style={{ backgroundColor: config.color }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {nodes.map((node) => (
          <NodeCard key={node.id} node={node} edges={edges} />
        ))}
      </div>
    </div>
  );
}

interface KnowledgeGraphViewProps {
  clientId: string;
}

export function KnowledgeGraphView({ clientId }: KnowledgeGraphViewProps) {
  const navigate = useNavigate();
  const api = useApi();

  const graphQuery = useQuery<KnowledgeGraphData>({
    queryKey: ['knowledge-graph', clientId],
    queryFn: async () =>
      (
        await api.get<KnowledgeGraphData>(`/api/intelligence/clients/${clientId}/knowledge-graph`)
      ).data,
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const data = graphQuery.data;

  const centerNode = data?.nodes.find((n) => n.type === 'client');
  const nodesByType = data
    ? (['registrant', 'lobbyist', 'contractor', 'bill', 'pac', 'agency'] as const).map((type) => ({
        type,
        nodes: data.nodes.filter((n) => n.type === type),
      }))
    : [];

  return (
    <div>
      {graphQuery.isError && (
        <Alert
          type="error"
          message="Failed to load knowledge graph"
          description={(graphQuery.error as Error)?.message}
        />
      )}

      {graphQuery.isLoading && <Skeleton active paragraph={{ rows: 10 }} />}

      {data && (
        <>
          {/* Resolution Quality Scorecard */}
          <Card
            size="small"
            title="Resolution Quality Scorecard"
            style={{ marginBottom: 20 }}
            extra={
              <Button size="small" type="link" onClick={() => navigate('/settings/intelligence-mappings')}>
                Manage mappings →
              </Button>
            }
          >
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Tooltip title="Average confidence of confirmed entity mappings">
                  <Progress
                    type="circle"
                    percent={data.resolutionQuality.avgConfidence}
                    size={64}
                    strokeColor={
                      data.resolutionQuality.avgConfidence >= 80
                        ? '#52c41a'
                        : data.resolutionQuality.avgConfidence >= 50
                        ? '#faad14'
                        : '#ff4d4f'
                    }
                  />
                </Tooltip>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                  Avg Confidence
                </Text>
              </div>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="Confirmed mappings">
                  <Tag color="green">{data.resolutionQuality.confirmedCount}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Unconfirmed mappings">
                  <Tag color="orange">{data.resolutionQuality.unconfirmedCount}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Total nodes">{data.nodes.length}</Descriptions.Item>
                <Descriptions.Item label="Total edges">{data.edges.length}</Descriptions.Item>
              </Descriptions>
            </div>
          </Card>

          {/* Center node */}
          {centerNode && (
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Card
                style={{
                  display: 'inline-block',
                  borderTop: '4px solid #1c2e4a',
                  minWidth: 280,
                }}
                size="small"
              >
                <Title level={4} style={{ margin: 0, color: '#1c2e4a' }}>
                  <GlobalOutlined style={{ marginRight: 8 }} />
                  {centerNode.label}
                </Title>
                {(centerNode.metadata.sectorTag as string | null) && (
                  <Tag style={{ marginTop: 4 }}>{centerNode.metadata.sectorTag as string}</Tag>
                )}
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {data.edges.length} relationships · {data.nodes.length - 1} entities
                  </Text>
                </div>
              </Card>
            </div>
          )}

          {/* Satellite entity groups */}
          {data.nodes.length <= 1 ? (
            <Empty
              description="No entity connections found. Confirm mappings in Settings → Intelligence Mappings to populate the graph."
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 32 }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {nodesByType
                .filter((g) => g.nodes.length > 0)
                .map((g) => (
                  <EntityGroup key={g.type} type={g.type} nodes={g.nodes} edges={data.edges} />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
