import {
  composeWhitePaperDocument,
  getWhitePaperVariant,
  splitDocumentIntoSections,
  variantSections,
  WHITEPAPER_VARIANTS,
  type WhitePaperSection,
} from './whitepaper.types.js';

describe('whitepaper.types helpers', () => {
  describe('getWhitePaperVariant', () => {
    it('returns the named variant', () => {
      expect(getWhitePaperVariant('appropriations_brief').slug).toBe('appropriations_brief');
    });
    it('falls back to the default for unknown/empty slugs', () => {
      expect(getWhitePaperVariant(null).slug).toBe(WHITEPAPER_VARIANTS[0]!.slug);
      expect(getWhitePaperVariant('nope').slug).toBe(WHITEPAPER_VARIANTS[0]!.slug);
    });
  });

  describe('variantSections', () => {
    it('produces empty sections matching the variant spec', () => {
      const sections = variantSections('congressional_program');
      const variant = getWhitePaperVariant('congressional_program');
      expect(sections).toHaveLength(variant.sections.length);
      expect(sections.every((s) => s.body === '' && s.status === 'empty')).toBe(true);
      expect(sections[0]!.heading).toBe(variant.sections[0]!.heading);
    });
  });

  describe('composeWhitePaperDocument', () => {
    it('joins heading + body and skips empties', () => {
      const sections: WhitePaperSection[] = [
        { id: 'sec-1', heading: 'Problem Statement', body: 'A real gap exists.' },
        { id: 'sec-2', heading: 'Empty', body: '   ' },
        { id: 'sec-3', heading: 'The Ask', body: 'Fund $10M.' },
      ];
      const doc = composeWhitePaperDocument(sections);
      expect(doc).toContain('Problem Statement\nA real gap exists.');
      expect(doc).toContain('The Ask\nFund $10M.');
      // empty-body section keeps only its heading
      expect(doc).toContain('Empty');
    });
  });

  describe('splitDocumentIntoSections', () => {
    const headings = ['Problem Statement', 'Solution', 'The Ask'];

    it('does NOT collapse a multi-section blob into one section (regression B2)', () => {
      const blob = [
        'Problem Statement',
        'The capability gap is acute.',
        '',
        'Solution',
        'Our program closes it.',
        '',
        'The Ask',
        'Authorize $25M in FY27.',
      ].join('\n');
      const sections = splitDocumentIntoSections(blob, headings);
      expect(sections).toHaveLength(3);
      expect(sections[0]!.heading).toBe('Problem Statement');
      expect(sections[1]!.body).toContain('Our program closes it.');
      expect(sections[2]!.heading).toBe('The Ask');
      expect(sections.every((s) => s.body.length > 0)).toBe(true);
    });

    it('handles markdown ## headings', () => {
      const blob = '## Problem Statement\nGap.\n\n## Solution\nFix.';
      const sections = splitDocumentIntoSections(blob, headings);
      expect(sections.map((s) => s.heading)).toEqual(['Problem Statement', 'Solution']);
    });

    it('returns empty scaffold for blank input', () => {
      const sections = splitDocumentIntoSections('', headings);
      expect(sections).toHaveLength(3);
      expect(sections.every((s) => s.status === 'empty')).toBe(true);
    });

    it('seeds preamble before the first heading into the first section', () => {
      const blob = 'Intro line with no heading.\n\nProblem Statement\nGap.';
      const sections = splitDocumentIntoSections(blob, headings);
      expect(sections[0]!.body).toContain('Intro line with no heading.');
    });
  });
});
