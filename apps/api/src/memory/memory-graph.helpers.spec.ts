import {
  buildKnowledgeGraph,
  walkFrom,
  type FkRelation,
} from './memory-graph.helpers.js';
import type { MemoryEdge } from './memory.types.js';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('memory graph builder (Phase 3, criterion #5)', () => {
  const fks: FkRelation[] = [
    {
      srcType: 'client',
      srcSlug: 'acme-corp',
      srcLabel: 'Acme Corp',
      dstType: 'bill',
      dstSlug: 'hr-1234',
      dstLabel: 'HR 1234',
      relation: 'tracks',
    },
  ];

  const wikiEdges: MemoryEdge[] = [
    {
      tenantId: TENANT,
      srcItemId: 'item-soul',
      relation: 'mentions',
      dstType: 'person',
      dstSlug: 'jane-doe',
    },
    {
      tenantId: TENANT,
      srcItemId: 'item-soul',
      relation: 'mentions',
      dstType: 'bill',
      dstSlug: 'hr-1234',
    },
  ];

  const itemNodeById = new Map([
    ['item-soul', { type: 'client', slug: 'acme-corp', label: 'Acme Corp' }],
  ]);

  it('merges DB FKs and wikilink edges into one graph', () => {
    const g = buildKnowledgeGraph(fks, wikiEdges, itemNodeById);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain('client:acme-corp');
    expect(ids).toContain('bill:hr-1234');
    expect(ids).toContain('person:jane-doe');
  });

  it('tags edges with provenance (fk vs mention) — fact vs analysis', () => {
    const g = buildKnowledgeGraph(fks, wikiEdges, itemNodeById);
    const fk = g.edges.find((e) => e.relation === 'tracks');
    const mention = g.edges.find((e) => e.dst === 'person:jane-doe');
    expect(fk?.origin).toBe('fk');
    expect(mention?.origin).toBe('mention');
  });

  it('de-duplicates the bill node reached via both FK and wikilink', () => {
    const g = buildKnowledgeGraph(fks, wikiEdges, itemNodeById);
    expect(g.nodes.filter((n) => n.id === 'bill:hr-1234').length).toBe(1);
  });

  it('skips wikilink edges whose source item cannot be resolved', () => {
    const orphan: MemoryEdge[] = [
      { tenantId: TENANT, srcItemId: 'missing', relation: 'mentions', dstType: 'bill', dstSlug: 'x' },
    ];
    const g = buildKnowledgeGraph([], orphan, itemNodeById);
    expect(g.nodes.length).toBe(0);
    expect(g.edges.length).toBe(0);
  });

  it('walks from a seed to answer "history with this entity" (depth-bounded)', () => {
    const g = buildKnowledgeGraph(fks, wikiEdges, itemNodeById);
    const sub = walkFrom(g, 'person:jane-doe', 1);
    // 1 hop from jane-doe reaches the client (acme-corp) via the mention edge
    expect(sub.nodes.map((n) => n.id)).toContain('person:jane-doe');
    expect(sub.nodes.map((n) => n.id)).toContain('client:acme-corp');
  });

  it('depth 2 from a person reaches bills the client tracks', () => {
    const g = buildKnowledgeGraph(fks, wikiEdges, itemNodeById);
    const sub = walkFrom(g, 'person:jane-doe', 2);
    // jane-doe -> acme-corp -> hr-1234
    expect(sub.nodes.map((n) => n.id)).toContain('bill:hr-1234');
  });

  it('produces deterministic node + edge ordering', () => {
    const g1 = buildKnowledgeGraph(fks, wikiEdges, itemNodeById);
    const g2 = buildKnowledgeGraph(fks, wikiEdges, itemNodeById);
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });
});
