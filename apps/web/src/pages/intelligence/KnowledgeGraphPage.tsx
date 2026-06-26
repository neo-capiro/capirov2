import { KnowledgeGraphPanel } from './panels/KnowledgeGraphPanel.js';

/**
 * Standalone full-page route for the institutional-memory knowledge graph.
 * Reachable at /intelligence/graph and surfaced as a "Knowledge Graph" item
 * under the Intelligence group in the left nav. Replaces the legacy
 * per-client ReactFlow graph that previously lived in this file (now unused).
 */
export function KnowledgeGraphPage() {
  return (
    <div
      className="redesign"
      style={{ padding: '24px 32px', height: '100%', overflow: 'auto', background: 'var(--bg-canvas)' }}
    >
      <KnowledgeGraphPanel />
    </div>
  );
}
