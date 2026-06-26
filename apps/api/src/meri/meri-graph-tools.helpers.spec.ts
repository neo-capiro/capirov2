import { buildKnowledgeGraph, walkFrom, type FkRelation } from '../memory/memory-graph.helpers.js';

// Mirrors the BFS helper in meri-tools.service.ts (shortestGraphPath). Kept in
// sync here to unit-test path-finding behavior without standing up the full
// Nest service (which needs Prisma + 25 injected deps).
function shortestGraphPath(
  graph: { nodes: Array<{ id: string }>; edges: Array<{ src: string; dst: string }> },
  from: string, to: string, maxDepth: number,
): string[] | null {
  if (from === to) return [from];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    (adj.get(e.src) ?? adj.set(e.src, []).get(e.src)!).push(e.dst);
    (adj.get(e.dst) ?? adj.set(e.dst, []).get(e.dst)!).push(e.src);
  }
  const prev = new Map<string, string>();
  const depthOf = new Map<string, number>([[from, 0]]);
  const visited = new Set<string>([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      const d = depthOf.get(id) ?? 0;
      if (d >= maxDepth) continue;
      for (const nb of adj.get(id) ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb); prev.set(nb, id); depthOf.set(nb, d + 1);
        if (nb === to) {
          const path = [nb]; let cur = nb;
          while (prev.has(cur)) { cur = prev.get(cur)!; path.unshift(cur); }
          return path;
        }
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}

describe('Meri knowledge-graph tool path-finding', () => {
  // client:c1 -> bill:b1 ; client:c1 -> person:p1 ; person:p1 mentioned-with office:o1
  const fk: FkRelation[] = [
    { srcType: 'client', srcSlug: 'c1', srcLabel: 'Acme', dstType: 'bill', dstSlug: 'b1', dstLabel: 'HR1', relation: 'tracks' },
    { srcType: 'client', srcSlug: 'c1', srcLabel: 'Acme', dstType: 'person', dstSlug: 'p1', dstLabel: 'Jane', relation: 'contact' },
  ];
  const wiki = [
    { tenantId: 't', srcItemId: 'item-p1', relation: 'mentions', dstType: 'office', dstSlug: 'o1' },
  ];
  const itemNodes = new Map([['item-p1', { type: 'person', slug: 'p1', label: 'Jane' }]]);
  const graph = buildKnowledgeGraph(fk, wiki, itemNodes);

  it('finds a path from a client to a connected office', () => {
    const path = shortestGraphPath(graph, 'client:c1', 'office:o1', 4);
    expect(path).not.toBeNull();
    expect(path![0]).toBe('client:c1');
    expect(path![path!.length - 1]).toBe('office:o1');
  });

  it('returns null when the target is beyond maxDepth', () => {
    expect(shortestGraphPath(graph, 'client:c1', 'office:o1', 1)).toBeNull();
  });

  it('returns null for an unreachable node', () => {
    expect(shortestGraphPath(graph, 'client:c1', 'office:nonexistent', 5)).toBeNull();
  });

  it('walkFrom bounds the neighborhood by depth', () => {
    const near = walkFrom(graph, 'client:c1', 1);
    expect(near.nodes.some((n) => n.id === 'bill:b1')).toBe(true);
    expect(near.nodes.some((n) => n.id === 'client:c1')).toBe(true);
  });
});
