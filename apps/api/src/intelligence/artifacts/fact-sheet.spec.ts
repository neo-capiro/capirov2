import { buildFactSheet, describeSourceRef, type FactSheetCard } from './fact-sheet.js';
import type { EvidenceRef } from '../actions/action-recommendation.types.js';

/**
 * Step 3.3 — deterministic FactSheet builder. The builder is PURE, so these specs
 * exercise it directly: a card yields claims covering each evidence ref + each
 * distinct numeric figure, with stable c1.. ids and no double-claimed figures.
 */

function makeCard(overrides: Partial<FactSheetCard> = {}): FactSheetCard {
  return {
    issueTitle: 'House cut to PE 0604123A',
    whatChanged: 'House mark of $90M is below the $120M request.',
    whyItMatters: 'Affects ClientCo radar program.',
    recommendedAction: 'Push to restore the $30M cut before conference.',
    evidence: [
      { kind: 'delta', deltaId: 'delta-1', note: 'HASC mark cut $30M' },
      { kind: 'source', sourceDocumentId: 'R-2A', page: 144 },
    ] as EvidenceRef[],
    uncertainty: null,
    ...overrides,
  };
}

describe('buildFactSheet', () => {
  it('emits one claim per evidence ref with stable ids and projected source refs', () => {
    const { claims } = buildFactSheet(makeCard());

    // First two claims are the two evidence refs, in array order.
    expect(claims[0]!.id).toBe('c1');
    expect(claims[0]!.sourceRef.kind).toBe('delta');
    expect(claims[0]!.sourceRef.deltaId).toBe('delta-1');
    expect(claims[1]!.id).toBe('c2');
    expect(claims[1]!.sourceRef.kind).toBe('source');
    expect(claims[1]!.sourceRef.sourceDocumentId).toBe('R-2A');
    expect(claims[1]!.sourceRef.page).toBe(144);
  });

  it('emits a claim for each distinct numeric figure in whatChanged + recommendedAction', () => {
    const { claims } = buildFactSheet(makeCard());
    const values = claims.map((c) => c.value).filter(Boolean);

    // $30M is in the evidence note AND recommendedAction -> claimed exactly once.
    expect(values).toContain('$90M');
    expect(values).toContain('$120M');
    expect(values).toContain('$30M');
    const thirties = claims.filter((c) => c.value === '$30M');
    expect(thirties).toHaveLength(1);
  });

  it('is deterministic: same card -> same claim ids and order', () => {
    const a = buildFactSheet(makeCard());
    const b = buildFactSheet(makeCard());
    expect(a.claims.map((c) => c.id)).toEqual(b.claims.map((c) => c.id));
    expect(a.claims.map((c) => c.value)).toEqual(b.claims.map((c) => c.value));
  });

  it('handles a card with no evidence by anchoring figures on a narrative source ref', () => {
    const { claims } = buildFactSheet(
      makeCard({ evidence: [], whatChanged: 'Mark is $50M.', recommendedAction: 'Protect it.' }),
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]!.id).toBe('c1');
    expect(claims[0]!.value).toBe('$50M');
    expect(claims[0]!.sourceRef.kind).toBe('narrative');
  });

  it('ignores bare single digits but keeps percentages and dollar figures', () => {
    const { claims } = buildFactSheet(
      makeCard({
        evidence: [],
        whatChanged: 'A 12% cut affecting 1 program element.',
        recommendedAction: 'Restore funding.',
      }),
    );
    const values = claims.map((c) => c.value);
    expect(values).toContain('12%');
    expect(values).not.toContain('1');
  });
});

describe('describeSourceRef', () => {
  it('renders a source-doc page citation', () => {
    expect(describeSourceRef({ kind: 'source', sourceDocumentId: 'R-2A', page: 144 })).toBe(
      'R-2A p.144',
    );
  });

  it('renders a narrative ref from its note', () => {
    expect(describeSourceRef({ kind: 'narrative', note: 'analyst summary' })).toBe(
      'analyst summary',
    );
  });
});
