/**
 * Workspace document templates — 20 total (2 per canonical product).
 *
 * Ported verbatim from the locked prototype `ui_kits/workspace/wsdata.jsx`
 * (WS.templates[]). Meri suggests primary + secondary per product in Setup ›
 * Templates and the editor Insert panel. Seeded into ws_template (scope GLOBAL).
 *
 * Each template: id, name, icon, desc, style, fontFamily, accentColor, product
 * (exact work-product name), meriPrimary | meriSecondary, elements[], sections[].
 */

export interface WsTemplateSeed {
  id: string;
  name: string;
  icon: string;
  desc: string;
  style: 'serif-formal' | 'sans-open';
  fontFamily: string;
  accentColor: string;
  product: string;
  meriPrimary: boolean;
  meriSecondary: boolean;
  elements: string[];
  sections: string[];
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = 'system-ui, -apple-system, sans-serif';
const NAVY = '#1B2D5B';
const BLUE = '#2A6FDB';

export const TEMPLATES: WsTemplateSeed[] = [
  // 1. NDAA Authorization Request
  { id: 'ndaa-traditional', name: 'Traditional Program Paper', icon: 'FileText', desc: 'Formal structure with letterhead, budget table, and justified narrative. One request per paper.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'NDAA Authorization Request', meriPrimary: true, meriSecondary: false, elements: ['Tables', 'Charts', 'Logos', 'Budget exhibit'], sections: ['Problem statement', 'Solution', 'Current status', 'Funding history & request', 'National security impact', 'Economic & district impact', 'The ask'] },
  { id: 'ndaa-modern', name: 'Modern Advocacy Brief', icon: 'Layers', desc: '1–2 pages. Lead with the bottom line; keep supporting data scannable.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'NDAA Authorization Request', meriPrimary: false, meriSecondary: true, elements: ['Charts', 'Logos'], sections: ['BLUF', 'Problem statement', 'Solution', 'The ask', 'Supporting data'] },

  // 2. Appropriations Justification
  { id: 'approps-traditional', name: 'Traditional Appropriations Justification', icon: 'Coins', desc: "References exact account and program/project/activity; anchored to President's Budget and prior-year enacted levels.", style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'Appropriations Justification', meriPrimary: true, meriSecondary: false, elements: ['Tables', 'Charts', 'Budget exhibit', 'Logos'], sections: ['Executive summary', 'Account & program line', 'Program description', 'Funding history', 'Justification & impact', 'Performance & outcomes', 'The ask'] },
  { id: 'approps-modern', name: 'Modern Funding Brief', icon: 'Layers', desc: '1–2 pages. The funding snapshot table (request vs. PBR vs. prior year) is the centerpiece.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'Appropriations Justification', meriPrimary: false, meriSecondary: true, elements: ['Tables', 'Budget exhibit'], sections: ['BLUF', 'Why it matters', 'Funding snapshot', 'Impact & outcomes'] },

  // 3. CDS / Earmark Application
  { id: 'cds-traditional', name: 'Traditional CDS/CPF Application', icon: 'Landmark', desc: 'Federal nexus, community support, and financial disclosure are mandatory eligibility gates. For-profit recipients are barred; single-year funding only.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'CDS / Earmark Application', meriPrimary: true, meriSecondary: false, elements: ['Tables', 'Budget exhibit', 'Logos', 'Photos', 'Cover letter'], sections: ['Requesting entity & recipient information', 'Project title', 'Project description', 'Requested amount & total cost', 'Federal nexus statement', 'Evidence of community support', 'Financial disclosure certification', 'Outcomes & metrics'] },
  { id: 'cds-modern', name: 'Modern Project Request', icon: 'Layers', desc: 'Streamlined for portal/database intake. The three eligibility gates still cannot be dropped.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'CDS / Earmark Application', meriPrimary: false, meriSecondary: true, elements: ['Tables', 'Budget exhibit', 'Photos'], sections: ['Project snapshot', 'Use of funds', 'Federal nexus', 'Community support', 'Financial disclosure certification'] },

  // 4. Authorization Bill Language
  { id: 'authbill-traditional', name: 'Traditional Legislative Draft', icon: 'Scale', desc: 'Follows House Office of Legislative Counsel style. Use Section 1 for the short title even in a single-section bill.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'Authorization Bill Language', meriPrimary: true, meriSecondary: false, elements: [], sections: ['Short title', 'Findings & purpose', 'Definitions', 'Main operative provision', 'Exceptions & special rules', 'Conforming & transitional provisions', 'Authorization of appropriations', 'Effective date'] },
  { id: 'authbill-modern', name: 'Modern Drafting Request', icon: 'Layers', desc: 'Request package sent to Legislative Counsel, not enacted text. Flags negotiated language and cites model statute or prior bill.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'Authorization Bill Language', meriPrimary: false, meriSecondary: true, elements: ['Tables'], sections: ['Summary of intent', 'Desired legal effect', 'Existing law to amend', 'Draft statutory text', 'Open questions'] },

  // 5. Report Language Request
  { id: 'reportlang-traditional', name: 'Traditional Report Language Request', icon: 'FileSignature', desc: 'Non-binding language (encourages/urges/directs agency action). Must not direct funding to a specific entity. Provide exact proposed text in a delineated block.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'Report Language Request', meriPrimary: true, meriSecondary: false, elements: ['Tables', 'Logos'], sections: ['Requesting entity & contact', 'Bill, account & subcommittee', 'Background & problem', 'Proposed report language', 'Justification', 'Relationship to existing law & PBR'] },
  { id: 'reportlang-modern', name: 'Modern Report Language Ask', icon: 'Layers', desc: 'Half-page to one page. The verbatim language block is the deliverable. Avoid wording that narrowly defines a single beneficiary.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'Report Language Request', meriPrimary: false, meriSecondary: true, elements: [], sections: ['Proposed language', 'Rationale', 'Agency & action directed'] },

  // 6. Meeting Brief & Advocacy
  { id: 'meeting-traditional', name: 'Traditional Meeting Brief', icon: 'Users', desc: 'Internal prep doc plus advocacy points. Frame around district impact; meetings run 10–45 min and may be cut short, so front-load the ask.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'Meeting Brief & Advocacy', meriPrimary: true, meriSecondary: false, elements: ['Photos', 'Tables', 'Logos'], sections: ['Meeting logistics', 'Member profile', 'Background', 'Objectives & the ask', 'Talking points', 'Anticipated questions & responses', 'Leave-behind summary', 'Follow-up plan'] },
  { id: 'meeting-modern', name: 'Modern Meeting One-Sheet', icon: 'Layers', desc: 'One page for fast-turnaround Hill days/fly-ins. Pairs with a separate one-pager leave-behind.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'Meeting Brief & Advocacy', meriPrimary: false, meriSecondary: true, elements: ['Photos', 'Logos'], sections: ['Who & why', 'The ask', 'Top talking points', 'Likely pushback & response', 'Leave-behind & follow-up'] },

  // 7. Member letter
  { id: 'memberletter-support', name: 'Support Letter', icon: 'Mail', desc: 'On official letterhead; state the ask in the first paragraph. For agency letters, reference program name and funding opportunity number. One page.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'Member letter', meriPrimary: true, meriSecondary: false, elements: ['Logos', 'Cover letter'], sections: ['Opening', 'Program description', 'Request', 'Closing'] },
  { id: 'memberletter-cosponsor', name: 'Cosponsor / Dear Colleague Letter', icon: 'FileSignature', desc: 'Distributed in bulk via the e-Dear Colleague system. Include bill number and staff contact for signing on. One page.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'Member letter', meriPrimary: false, meriSecondary: true, elements: ['Logos'], sections: ['Introduction', 'Bill overview', 'Why cosponsor', 'Closing'] },

  // 8. Written testimony
  { id: 'testimony-traditional', name: 'Traditional Written Testimony', icon: 'Mic', desc: 'Non-governmental witnesses must file a Truth-in-Testimony disclosure (House Rule XI, clause 2(g)(5)). Verify committee-specific length and format rules.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'Written testimony', meriPrimary: true, meriSecondary: false, elements: ['Tables', 'Charts', 'Logos'], sections: ['Disclosure & witness intro', 'Opening statement', 'Background', 'Position', 'Recommendations', 'Closing'] },
  { id: 'testimony-modern', name: 'Modern Public Witness Statement', icon: 'Layers', desc: 'Favored for appropriations public-witness testimony. Page cap (e.g. 4 pages, 12-pt, single-spaced) is configurable per subcommittee.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'Written testimony', meriPrimary: false, meriSecondary: true, elements: ['Charts'], sections: ['Disclosure & bio', 'The ask', 'Supporting reasons', 'Closing'] },

  // 9. One-pager
  { id: 'onepager-traditional', name: 'Traditional Issue One-Pager', icon: 'File', desc: 'Strictly one page. Always include org contact info.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'One-pager', meriPrimary: true, meriSecondary: false, elements: ['Logos', 'Tables', 'Charts', 'Photos'], sections: ['Header & title', 'Background', 'Key facts & data', 'Our position & the ask', 'Contact information'] },
  { id: 'onepager-modern', name: 'Modern Ask Card', icon: 'Layers', desc: 'One page, scannable, heavy white space. Designed so the ask is impossible to misread.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'One-pager', meriPrimary: false, meriSecondary: true, elements: ['Logos', 'Charts'], sections: ['Headline ask', 'Why it matters', 'Supporting stat', 'Contact & call to action'] },

  // 10. Strategy memo
  { id: 'strategymemo-traditional', name: 'Traditional Strategy Memo', icon: 'ClipboardList', desc: 'Internal document. Lead headers with substantive points.', style: 'serif-formal', fontFamily: SERIF, accentColor: NAVY, product: 'Strategy memo', meriPrimary: true, meriSecondary: false, elements: ['Tables', 'Charts'], sections: ['Situation', 'Background', 'Analysis', 'Recommendation', 'Next steps'] },
  { id: 'strategymemo-modern', name: 'Modern Decision Memo', icon: 'Layers', desc: '1–2 pages. Open with the recommendation; present 2–4 options using a risk-then-mitigation format.', style: 'sans-open', fontFamily: SANS, accentColor: BLUE, product: 'Strategy memo', meriPrimary: false, meriSecondary: true, elements: ['Tables'], sections: ['BLUF', 'Background', 'Options comparison', 'Risk & mitigation', 'Decision & next steps'] },
];
