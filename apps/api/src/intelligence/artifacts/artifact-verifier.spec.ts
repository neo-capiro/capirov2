import { verifyArtifact } from './artifact-verifier.js';
import type { FactSheet, GeneratedParagraph } from './artifact-types.js';

/**
 * Step 3.3 — artifact grounding verifier. PURE. Adversarial fixture: a paragraph
 * with an unsourced "$999M" is rejected; a clean paragraph passes; a zero-claim
 * paragraph is rejected; caveat text is exempt by index.
 */

const factSheet: FactSheet = {
  claims: [
    {
      id: 'c1',
      claimText: 'House mark of $90M is below the $120M request.',
      value: '$90M',
      sourceRef: { kind: 'delta', deltaId: 'delta-1' },
    },
    {
      id: 'c2',
      claimText: 'The FY2026 request is $120M.',
      value: '$120M',
      sourceRef: { kind: 'source', sourceDocumentId: 'R-2A', page: 144 },
    },
  ],
};

describe('verifyArtifact', () => {
  it('passes a clean paragraph whose numerals all trace to cited claims', () => {
    const paragraphs: GeneratedParagraph[] = [
      {
        text: 'The House mark of $90M falls short of the $120M request.',
        claimIds: ['c1', 'c2'],
      },
    ];
    const result = verifyArtifact(paragraphs, factSheet);
    expect(result.ok).toBe(true);
    expect(result.rejected).toHaveLength(0);
  });

  it('ADVERSARIAL: rejects a paragraph asserting an unsourced $999M', () => {
    const paragraphs: GeneratedParagraph[] = [
      {
        text: 'The program faces a staggering $999M shortfall this year.',
        claimIds: ['c1'],
      },
    ];
    const result = verifyArtifact(paragraphs, factSheet);
    expect(result.ok).toBe(false);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.index).toBe(0);
    expect(result.rejected[0]!.reason).toContain('999');
  });

  it('rejects a paragraph that cites zero claims', () => {
    const paragraphs: GeneratedParagraph[] = [
      { text: 'This program is strategically important.', claimIds: [] },
    ];
    const result = verifyArtifact(paragraphs, factSheet);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]!.reason).toContain('no claims');
  });

  it('rejects a paragraph that cites only unknown claim ids', () => {
    const paragraphs: GeneratedParagraph[] = [
      { text: 'Funding is stable.', claimIds: ['c999'] },
    ];
    const result = verifyArtifact(paragraphs, factSheet);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]!.reason).toContain('unknown claim');
  });

  it('exempts caveat paragraphs from both zero-claim and numeral checks', () => {
    const paragraphs: GeneratedParagraph[] = [
      { text: 'The House mark is $90M.', claimIds: ['c1'] },
      {
        // Caveat text: no claim ids and an unsupported figure, but it is exempt.
        text: 'Mapping confidence is low; figures may shift up to 5% before conference.',
        claimIds: [],
      },
    ];
    const result = verifyArtifact(paragraphs, factSheet, { caveatIndices: [1] });
    expect(result.ok).toBe(true);
    expect(result.rejected).toHaveLength(0);
  });

  it('still rejects a non-caveat unsourced paragraph when caveats are present', () => {
    const paragraphs: GeneratedParagraph[] = [
      { text: 'A surprise $999M cut landed.', claimIds: ['c2'] },
      { text: 'Confidence is moderate.', claimIds: [] },
    ];
    const result = verifyArtifact(paragraphs, factSheet, { caveatIndices: [1] });
    expect(result.ok).toBe(false);
    expect(result.rejected.map((r) => r.index)).toEqual([0]);
  });
});
