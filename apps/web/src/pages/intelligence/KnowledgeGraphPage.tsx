import { useMemo, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Progress,
  Skeleton,
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
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useApi } from '../../lib/use-api.js';

const { Text } = Typography;

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
  { color: string; soft: string; icon: ReactNode; label: string }
> = {
  client:     { color: '#1c2e4a', soft: '#dee6f8', icon: <GlobalOutlined />, label: 'Client' },
  registrant: { color: '#2c5bd4', soft: '#dce4f8', icon: <TeamOutlined />,   label: 'Registrant' },
  lobbyist:   { color: '#7a3aa6', soft: '#ece2f4', icon: <UserOutlined />,   label: 'Lobbyist' },
  contractor: { color: '#2e6b43', soft: '#ddebde', icon: <BarChartOutlined />, label: 'Contractor' },
  bill:       { color: '#a26913', soft: '#f4e5c3', icon: <FileTextOutlined />, label: 'Bill' },
  pac:        { color: '#b5301b', soft: '#f6ddd6', icon: <BankOutlined />,   label: 'PAC/FEC' },
  agency:     { color: '#4f525a', soft: '#efece4', icon: <BankOutlined />,   label: 'Agency' },
};

function confidenceBuckets(avgConfidence: number, confirmed: number, total: number) {
  const safeTotal = Math.max(total, 0);
  const high = Math.max(0, Math.min(safeTotal, Math.round((avgConfidence / 100) * safeTotal)));
  const remaining = Math.max(0, safeTotal - high);
  const mid = Math.max(0, Math.min(remaining, Math.round(remaining * 0.6)));
  const low = Math.max(0, safeTotal - high - mid);
  return [
    { label: '≥80%', value: Math.max(high, confirmed), color: '#52c41a' },
    { label: '50-79%', value: mid, color: '#faad14' },
    { label: '<50%', value: low, color: '#ff4d4f' },
  ];
}

/* ── Custom React Flow node renderers ───────────────────────────────────── */

function ClientNode({ data }: NodeProps) {
  const d = data as { label: string; sectorTag?: string | null; edgeCount: number; nodeCount: number };
  return (
    <div className="kg-node kg-node-client">
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="kg-node-client-name">{d.label}</div>
      {d.sectorTag ? <div className="kg-node-client-sector">{d.sectorTag.toUpperCase()}</div> : null}
      <div className="kg-node-client-meta">
        {d.edgeCount} relationships · {d.nodeCount} entities
      </div>
    </div>
  );
}

function EntityNode({ data }: NodeProps) {
  const d = data as {
    label: string;
    nodeType: GraphNode['type'];
    subtitle?: string | null;
    edgeLabel?: string | null;
  };
  const cfg = NODE_TYPE_CONFIG[d.nodeType] ?? NODE_TYPE_CONFIG.registrant;
  return (
    <div className="kg-node kg-node-entity" style={{ borderTopColor: cfg.color }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="kg-node-entity-eyebrow" style={{ color: cfg.color }}>
        {cfg.label.toUpperCase()}
      </div>
      <div className="kg-node-entity-label">{d.label}</div>
      {d.subtitle ? <div className="kg-node-entity-sub">{d.subtitle}</div> : null}
    </div>
  );
}

const NODE_TYPES = {
  client: ClientNode,
  entity: EntityNode,
};

/* ── Radial layout helper ───────────────────────────────────────────────── */

function radialLayout(centerNode: GraphNode | undefined, satellites: GraphNode[]) {
  // Group satellites by type so same-type nodes sit on the same arc band.
  const TYPE_ORDER: GraphNode['type'][] = ['bill', 'registrant', 'lobbyist', 'contractor', 'pac', 'agency'];
  const byType = TYPE_ORDER.map((t) => satellites.filter((n) => n.type === t)).filter((g) => g.length);

  const positions = new Map<string, { x: number; y: number }>();
  const center = { x: 0, y: 0 };
  if (centerNode) positions.set(centerNode.id, center);

  // One ring per non-empty type, rings spaced out.
  byType.forEach((group, ringIdx) => {
    const radius = 280 + ringIdx * 60;
    const startAngle = (ringIdx * Math.PI) / 6; // slight stagger between rings
    group.forEach((node, i) => {
      const angle = startAngle + (i / group.length) * Math.PI * 2;
      positions.set(node.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    });
  });

  return positions;
}

function subtitleFor(node: GraphNode): string | null {
  switch (node.type) {
    case 'registrant': {
      const n = node.metadata.filingCount;
      return typeof n === 'number' ? `${n.toLocaleString()} filings` : null;
    }
    case 'lobbyist': {
      const positions = node.metadata.coveredPositions;
      if (Array.isArray(positions) && positions.length > 0) {
        const first = positions[0] as Record<string, unknown> | undefined;
        if (first && typeof first.position === 'string') {
          const s = first.position;
          return s.length > 36 ? s.slice(0, 36) + '…' : s;
        }
      }
      return null;
    }
    case 'bill': {
      const t = node.metadata.title;
      if (typeof t === 'string') {
        return t.length > 60 ? t.slice(0, 60) + '…' : t;
      }
      return null;
    }
    case 'agency': {
      const amt = node.metadata.amount;
      return typeof amt === 'number' ? `$${(amt / 1e9).toFixed(1)}B in contracts` : null;
    }
    case 'contractor': {
      const amt = node.metadata.totalContracts;
      return typeof amt === 'number' ? `$${(amt / 1e9).toFixed(1)}B contracts` : null;
    }
    default:
      return null;
  }
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
  const satellites = useMemo(
    () => (data?.nodes ?? []).filter((n) => n.type !== 'client'),
    [data?.nodes],
  );

  const { rfNodes, rfEdges } = useMemo(() => {
    if (!data) return { rfNodes: [] as Node[], rfEdges: [] as Edge[] };
    const positions = radialLayout(centerNode, satellites);

    const nodes: Node[] = [];
    if (centerNode) {
      const pos = positions.get(centerNode.id) ?? { x: 0, y: 0 };
      nodes.push({
        id: centerNode.id,
        type: 'client',
        position: pos,
        data: {
          label: centerNode.label,
          sectorTag: (centerNode.metadata.sectorTag as string | null) ?? null,
          edgeCount: data.edges.length,
          nodeCount: data.nodes.length - 1,
        },
        draggable: true,
      });
    }
    for (const n of satellites) {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      nodes.push({
        id: n.id,
        type: 'entity',
        position: pos,
        data: {
          label: n.label,
          nodeType: n.type,
          subtitle: subtitleFor(n),
        },
        draggable: true,
      });
    }

    const edges: Edge[] = data.edges.map((e, i) => {
      const targetNode = data.nodes.find((n) => n.id === e.target);
      const stroke = targetNode
        ? NODE_TYPE_CONFIG[targetNode.type]?.color ?? '#8a8780'
        : '#8a8780';
      return {
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        label: e.label,
        labelStyle: { fontSize: 10, fill: 'var(--ink-3)' },
        labelBgStyle: { fill: 'var(--bg-canvas)' },
        labelBgPadding: [4, 2] as [number, number],
        style: { stroke, strokeWidth: 1.5, opacity: 0.55 },
        type: 'default',
      };
    });

    return { rfNodes: nodes, rfEdges: edges };
  }, [data, centerNode, satellites]);

  const minimapNodeColor = useCallback((node: Node) => {
    if (node.type === 'client') return NODE_TYPE_CONFIG.client.color;
    const d = node.data as { nodeType?: GraphNode['type'] };
    return d.nodeType ? NODE_TYPE_CONFIG[d.nodeType]?.color ?? '#8a8780' : '#8a8780';
  }, []);

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <Tooltip title="Average confidence of confirmed entity mappings">
                    <Progress
                      type="circle"
                      percent={data.resolutionQuality.avgConfidence}
                      size={64}
                      strokeColor={
                        data.resolutionQuality.avgConfidence >= 80
                          ? 'var(--success)'
                          : data.resolutionQuality.avgConfidence >= 50
                          ? 'var(--notable)'
                          : 'var(--critical)'
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
              <div>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                  Confidence distribution
                </Text>
                <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border-1)' }}>
                  {confidenceBuckets(
                    data.resolutionQuality.avgConfidence,
                    data.resolutionQuality.confirmedCount,
                    data.nodes.length,
                  ).map((b) => (
                    <div
                      key={b.label}
                      title={`${b.label}: ${b.value}`}
                      style={{
                        width: `${(b.value / Math.max(1, data.nodes.length)) * 100}%`,
                        background: b.color,
                      }}
                    />
                  ))}
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {confidenceBuckets(
                    data.resolutionQuality.avgConfidence,
                    data.resolutionQuality.confirmedCount,
                    data.nodes.length,
                  ).map((b) => (
                    <span key={b.label} style={{ fontSize: 11, color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color }} />
                      {b.label} <b style={{ color: 'var(--ink-1)' }}>{b.value}</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Relationship graph */}
          {data.nodes.length <= 1 ? (
            <Empty
              description="No entity connections found. Confirm mappings in Settings → Intelligence Mappings to populate the graph."
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 32 }}
            />
          ) : (
            <Card
              size="small"
              title="Relationship graph"
              extra={
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {data.edges.length} relationships · {satellites.length} entities · drag nodes to rearrange
                </Text>
              }
              styles={{ body: { padding: 0 } }}
            >
              <div className="kg-flow-container">
                <ReactFlow
                  nodes={rfNodes}
                  edges={rfEdges}
                  nodeTypes={NODE_TYPES}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  minZoom={0.2}
                  maxZoom={2}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={24} size={1} color="var(--border-1)" />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable nodeColor={minimapNodeColor} maskColor="rgba(232,228,217,0.6)" />
                </ReactFlow>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
