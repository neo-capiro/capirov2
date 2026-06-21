import type { MeriSkill } from './skill.types.js';

/**
 * Outreach Draft. Migrated verbatim from intentGuidance['generate_draft'] +
 * templateForIntent('generate_draft') and kept byte-identical (see spec).
 */
export const draftSkill: MeriSkill = {
  id: 'draft',
  name: 'Outreach Draft',
  triggers: ['generate_draft'],
  systemAddendum:
    'Generate a professional government affairs email with proper tone and structure.',
  requiredTools: ['get_client_context', 'search_research_sources'],
  template: {
    heading: 'Outreach Draft',
    sections: ['Subject Line', 'Opening', 'Core Message', 'Ask / CTA', 'Close'],
  },
};
