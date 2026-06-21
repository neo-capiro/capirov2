import type { MeriSkill } from './skill.types.js';

/**
 * Library of government-affairs skills (P1-8). Each is triggered by a dedicated
 * classified intent (added to classifyIntent's valid set) so it never collides
 * with the migrated briefing/draft skills. Adding a skill = add a module here,
 * register it in skill-registry.ts, and add its intent to the classifier.
 */

export const billAnalysisSkill: MeriSkill = {
  id: 'bill_analysis',
  name: 'Bill Analysis',
  triggers: ['analyze_bill'],
  systemAddendum:
    'Analyze the bill section-by-section for a lobbyist: what it does, who it helps/hurts, and the realistic path. Ground every claim in the bill text + retrieved intelligence; cite sources. Be explicit about uncertainty on outcome and timing.',
  requiredTools: [
    'search_congress_bills',
    'query_intelligence',
    'search_public_web',
    'get_client_context',
  ],
  template: {
    heading: 'Bill Analysis',
    sections: [
      'Summary',
      'Key Provisions',
      'Stakeholders & Positions',
      'Impact on Client',
      'Likely Path & Timing',
      'Recommended Position',
    ],
  },
};

export const hearingPrepSkill: MeriSkill = {
  id: 'hearing_prep',
  name: 'Hearing Prep',
  triggers: ['prep_hearing'],
  systemAddendum:
    'Prepare a witness/attendee for a congressional hearing. Identify the panel, likely lines of questioning per member, member dynamics, and crisp talking points. Use hearing + member intelligence; flag risks and landmines.',
  requiredTools: [
    'query_intelligence',
    'search_congress_bills',
    'search_public_web',
    'get_client_context',
  ],
  template: {
    heading: 'Hearing Prep',
    sections: [
      'Hearing Overview',
      'Panel & Witnesses',
      'Likely Questions',
      'Member Dynamics',
      'Talking Points',
      'Risks & Landmines',
    ],
  },
};

export const coalitionLetterSkill: MeriSkill = {
  id: 'coalition_letter',
  name: 'Coalition Letter',
  triggers: ['draft_coalition_letter'],
  systemAddendum:
    'Draft a coalition sign-on letter to a member, committee, or agency. Lead with a single clear ask, support it with concrete rationale and district/economic nexus, and keep it tight and professional. No fabricated signatories or statistics.',
  requiredTools: ['get_client_context', 'query_intelligence', 'search_public_web'],
  template: {
    heading: 'Coalition Sign-On Letter',
    sections: [
      'Recipient & Subject',
      'The Ask',
      'Rationale',
      'Supporting Evidence',
      'Signatories',
      'Close',
    ],
  },
};

export const amendmentTrackerSkill: MeriSkill = {
  id: 'amendment_tracker',
  name: 'Amendment Tracker',
  triggers: ['track_amendment'],
  systemAddendum:
    'Track an amendment: sponsor, what it changes, current status, vote outlook, and impact on the client. Ground in bill/markup intelligence; be explicit about whip-count uncertainty and never guarantee an outcome.',
  requiredTools: ['search_congress_bills', 'query_intelligence', 'search_public_web'],
  template: {
    heading: 'Amendment Tracker',
    sections: [
      'Amendment',
      'Sponsor & Cosponsors',
      'Status',
      'Vote Outlook',
      'Impact on Client',
      'Next Steps',
    ],
  },
};

export const LOBBYING_SKILLS: readonly MeriSkill[] = [
  billAnalysisSkill,
  hearingPrepSkill,
  coalitionLetterSkill,
  amendmentTrackerSkill,
];
