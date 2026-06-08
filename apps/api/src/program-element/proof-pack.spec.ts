import { compareProofPackSources, proofPackRank } from './proof-pack.js';

describe('proofPackRank', () => {
  it('orders exhibits R-1 < R-2 < R-2A < R-3 < P-1 < P-40', () => {
    const order = ['R-1', 'R-2', 'R-2A', 'R-3', 'P-1', 'P-40'];
    const ranks = order.map((e) => proofPackRank('R', e));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(proofPackRank('R', 'R-1')).toBeLessThan(proofPackRank('R', 'R-3'));
    // whitespace tolerated in the exhibit label
    expect(proofPackRank('R', 'r-2a')).toBe(proofPackRank('R', 'R-2A'));
  });

  it('unknown exhibits sort after known ones; P-docs ahead of other', () => {
    expect(proofPackRank('R', 'R-2')).toBeLessThan(proofPackRank('P', null));
    expect(proofPackRank('P', null)).toBeLessThan(proofPackRank('O', null));
  });
});

describe('compareProofPackSources', () => {
  it('sorts by exhibit order, then fiscal year desc, then page asc', () => {
    const rows = [
      { docType: 'R', exhibitType: 'R-3', fy: 2027, pageNumber: 5 },
      { docType: 'R', exhibitType: 'R-1', fy: 2027, pageNumber: 10 },
      { docType: 'R', exhibitType: 'R-2', fy: 2026, pageNumber: 2 },
      { docType: 'R', exhibitType: 'R-2', fy: 2027, pageNumber: 8 },
    ];
    const sorted = [...rows].sort(compareProofPackSources);
    expect(sorted.map((r) => `${r.exhibitType}/${r.fy}/${r.pageNumber}`)).toEqual([
      'R-1/2027/10',
      'R-2/2027/8',
      'R-2/2026/2',
      'R-3/2027/5',
    ]);
  });
});
