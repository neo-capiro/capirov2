import { CLIO_SKILLS, matchSkill } from './skill-registry.js';

// Golden values copied from the legacy inline maps in clio.service.ts
// (intentGuidance + templateForIntent). The migrated skills MUST stay
// byte-identical to these so flipping CLIO_SKILLS_ENABLED never changes model
// output — that is the P0-5 acceptance ("migrated skill == removed hardcoded").
const LEGACY_INTENT_GUIDANCE: Record<string, string> = {
  generate_draft:
    'Generate a professional government affairs email with proper tone and structure.',
  generate_briefing:
    'Create an actionable briefing with key points, risks, and recommendations. Use intelligence data when relevant.',
};
const LEGACY_TEMPLATES: Record<string, { heading: string; sections: string[] }> = {
  generate_briefing: {
    heading: 'Government Affairs Briefing',
    sections: ['Executive Summary', 'Signal Scan', 'Opportunities', 'Risks', 'Recommended Actions'],
  },
  generate_draft: {
    heading: 'Outreach Draft',
    sections: ['Subject Line', 'Opening', 'Core Message', 'Ask / CTA', 'Close'],
  },
};

describe('matchSkill', () => {
  it('activates the briefing skill for generate_briefing', () => {
    expect(matchSkill('generate_briefing')?.id).toBe('briefing');
  });
  it('activates the draft skill for generate_draft', () => {
    expect(matchSkill('generate_draft')?.id).toBe('draft');
  });
  it('returns null for un-migrated / unknown intents (legacy fallback handles them)', () => {
    expect(matchSkill('query_intelligence')).toBeNull();
    expect(matchSkill('general_question')).toBeNull();
    expect(matchSkill('')).toBeNull();
  });
});

describe('migrated skills are byte-identical to the legacy inline definitions', () => {
  for (const skill of CLIO_SKILLS) {
    const intent = skill.triggers[0]!;
    it(`${skill.id}: systemAddendum matches legacy intentGuidance[${intent}]`, () => {
      expect(skill.systemAddendum).toBe(LEGACY_INTENT_GUIDANCE[intent]);
    });
    it(`${skill.id}: template matches legacy templateForIntent('${intent}')`, () => {
      expect(skill.template).toEqual(LEGACY_TEMPLATES[intent]);
    });
    it(`${skill.id}: declares the tools it relies on`, () => {
      expect(skill.requiredTools.length).toBeGreaterThan(0);
    });
  }
});
