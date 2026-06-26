import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Empty, Segmented, Space, Spin, Tag, Typography } from 'antd';
import ForceGraph3D from 'react-force-graph-3d';
import { useApi } from '../../../lib/use-api.js';

const { Text } = Typography;

/**
 * Knowledge Graph subtab — a floating 3D force graph (react-force-graph-3d /
 * three.js, MIT) over the institutional-memory graph. Consumes
 * GET /api/memory/graph, which merges authoritative DB foreign keys
 * (origin='fk') with analyst wikilink edges (origin='mention'), tenant-scoped
 * by RLS server-side.
 *
 * Visual language:
 *   - node color  = entity type (client / bill / person / issue / ...)
 *   - node size   = degree (how connected it is)
 *   - edge color  = provenance: facts (fk) are brighter/thicker, analyst
 *                   mentions are dimmer — fact vs. interpretation at a glance.
 */

interface ApiNode {
  id: string;
  type: string;
  slug: string;
  label: string;
}
interface ApiEdge {
  src: string;
  dst: string;
  relation: string;
  origin: 'fk' | 'mention';
}
interface GraphResponse {
  nodes: ApiNode[];
  edges: ApiEdge[];
}

interface GNode {
  id: string;
  label: string;
  type: string;
  color: string;
  val: number;
}
interface GLink {
  source: string;
  target: string;
  origin: 'fk' | 'mention';
  color: string;
  width: number;
}

// Type → color. Dark-canvas friendly, high-contrast neon palette.
const TYPE_COLORS: Record<string, string> = {
  client: '#38bdf8',
  'client-soul': '#38bdf8',
  'client-compass': '#22d3ee',
  'client-people': '#2dd4bf',
  'client-hub': '#0ea5e9',
  bill: '#a78bfa',
  person: '#34d399',
  issue: '#fbbf24',
  meeting: '#f472b6',
  thread: '#94a3b8',
  office: '#fb7185',
};
function colorForType(type: string): string {
  return TYPE_COLORS[type] ?? '#cbd5e1';
}

const FK_COLOR = '#7dd3fc'; // bright — authoritative fact edges
const MENTION_COLOR = 'rgba(148,163,184,0.4)'; // dim — analyst interpretation

export function KnowledgeGraphPanel() {
  const api = useApi();
  const fgRef = useRef<unknown>(null);
  const [originFilter, setOriginFilter] = useState<'all' | 'fk' | 'mention'>('all');

  const graphQuery = useQuery<GraphResponse>({
    queryKey: ['memory-graph'],
    queryFn: async () => (await api.get<GraphResponse>('/api/memory/graph')).data,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const graphData = useMemo(() => {
    const data = graphQuery.data;
    if (!data) return { nodes: [] as GNode[], links: [] as GLink[] };

    const degree = new Map<string, number>();
    for (const e of data.edges) {
      degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
      degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
    }

    const nodes: GNode[] = data.nodes.map((n) => ({
      id: n.id,
      label: `${n.label || n.slug} (${n.type})`,
      type: n.type,
      color: colorForType(n.type),
      val: 1 + Math.min(12, degree.get(n.id) ?? 0),
    }));

    const filtered =
      originFilter === 'all'
        ? data.edges
        : data.edges.filter((e) => e.origin === originFilter);

    const links: GLink[] = filtered.map((e) => ({
      source: e.src,
      target: e.dst,
      origin: e.origin,
      color: e.origin === 'fk' ? FK_COLOR : MENTION_COLOR,
      width: e.origin === 'fk' ? 1.4 : 0.6,
    }));

    return { nodes, links };
  }, [graphQuery.data, originFilter]);

  if (graphQuery.isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: 480 }}>
        <Spin tip="Loading knowledge graph…" />
      </div>
    );
  }
  if (graphQuery.isError) {
    return <Empty description="Could not load the knowledge graph." />;
  }
  if (graphData.nodes.length === 0) {
    return (
      <Empty description="No memory connections yet. Add client notes, meetings, or Meri sessions with linked entities to grow the graph." />
    );
  }

  return (
    <Card
      size="small"
      styles={{ body: { padding: 0 } }}
      title={
        <Space size="middle">
          <span>Knowledge Graph</span>
          <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
            {graphData.nodes.length} nodes · {graphData.links.length} connections
          </Text>
        </Space>
      }
      extra={
        <Space>
          <Tag color="cyan">— fact</Tag>
          <Tag color="default" style={{ opacity: 0.6 }}>· mention</Tag>
          <Segmented
            size="small"
            value={originFilter}
            onChange={(v) => setOriginFilter(v as 'all' | 'fk' | 'mention')}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Facts', value: 'fk' },
              { label: 'Mentions', value: 'mention' },
            ]}
          />
        </Space>
      }
    >
      <div style={{ height: 620, background: '#0b1220', borderRadius: 8, overflow: 'hidden' }}>
        <ForceGraph3D
          ref={fgRef as never}
          graphData={graphData}
          backgroundColor="#0b1220"
          nodeColor={(n: GNode) => n.color}
          nodeVal={(n: GNode) => n.val}
          nodeLabel={(n: GNode) => n.label}
          nodeOpacity={0.95}
          nodeResolution={16}
          linkColor={(l: GLink) => l.color}
          linkWidth={(l: GLink) => l.width}
          linkOpacity={0.5}
          linkDirectionalParticles={(l: GLink) => (l.origin === 'fk' ? 2 : 0)}
          linkDirectionalParticleWidth={1.2}
          linkDirectionalParticleSpeed={0.006}
          enableNodeDrag
          showNavInfo={false}
          warmupTicks={40}
          cooldownTicks={120}
        />
      </div>
    </Card>
  );
}
