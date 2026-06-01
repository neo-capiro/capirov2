import type { ClioSkill } from './skill.types.js';

/**
 * Government Affairs Briefing. Migrated verbatim from the legacy
 * intentGuidance['generate_briefing'] + templateForIntent('generate_briefing')
 * in clio.service.ts and kept byte-identical (enforced by skill-registry.spec.ts).
 */
export const briefingSkill: ClioSkill = {
  id: 'briefing',
  name: 'Government Affairs Briefing',
  triggers: ['generate_briefing'],
  systemAddendum:
    'Create an actionable briefing with key points, risks, and recommendations. Use intelligence data when relevant.',
  requiredTools: [
    'query_intelligence',
    'search_congress_bills',
    'search_lda_filings',
    'search_public_web',
  ],
  template: {
    heading: 'Government Affairs Briefing',
    sections: ['Executive Summary', 'Signal Scan', 'Opportunities', 'Risks', 'Recommended Actions'],
  },
};
