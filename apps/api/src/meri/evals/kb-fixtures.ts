/**
 * Client knowledge base eval fixtures (assistant-parity F5).
 *
 * A seeded synthetic client — Meridian Aerostructures, a composite-airframe
 * defense supplier in Wichita, KS — defined as plain data: a profile, 6
 * people, 5 facilities across 4 congressional districts, and 3 documents,
 * plus 30 eval questions. The manual runner (scripts/eval-clio-kb.ts) builds
 * the retrieval corpus from this data with the PRODUCTION text builders +
 * chunker (client-kb.helpers.ts), embeds it, retrieves top-6 per question,
 * and asks CLIO_MODEL against [KB snapshot + retrieved rows].
 *
 * Pure data + corpus/snapshot builders so fixture validity is CI-tested
 * (kb-fixtures.spec.ts) without burning tokens: every `mustInclude` answer
 * string must literally appear in the corpus the production builders emit.
 */

import {
  buildClientFacilityText,
  buildClientPersonText,
  buildClientProfileText,
  buildDocChunkText,
  buildKbSnapshot,
  chunkDocumentText,
  type KbSourceType,
} from '../../embeddings/client-kb.helpers.js';

// ── Seeded client data ──────────────────────────────────────────────────────

export interface KbFixtureClient {
  name: string;
  description: string;
  productDescription: string;
  sectorTag: string;
  issueCodes: string[];
  uei: string;
  naicsCodes: string[];
  pscCodes: string[];
}

export const MERIDIAN_CLIENT: KbFixtureClient = {
  name: 'Meridian Aerostructures',
  description:
    'Meridian Aerostructures is a composite-airframe defense supplier headquartered in ' +
    'Wichita, Kansas, manufacturing advanced thermoplastic composite fuselage and wing ' +
    'assemblies for military aircraft programs.',
  productDescription:
    'Out-of-autoclave thermoplastic composite airframe structures, automated fiber placement ' +
    'tooling, and rapid-repair composite patch kits for legacy airframes.',
  sectorTag: 'defense',
  issueCodes: ['DEF', 'AER'],
  uei: 'MER1D1ANAER0',
  naicsCodes: ['336413', '326199'],
  pscCodes: ['1560'],
};

export interface KbFixturePerson {
  name: string;
  title: string;
  role: string;
  email: string;
  phone: string;
  lastContact: Date;
  notes: string;
}

export const MERIDIAN_PEOPLE: KbFixturePerson[] = [
  {
    name: 'Pilar Vance',
    title: 'Chief Executive Officer',
    role: 'Executive sponsor',
    email: 'pilar.vance@meridianaero.example.com',
    phone: '316-555-0101',
    lastContact: new Date('2026-05-28'),
    notes:
      'Prefers early-morning meetings and no slide decks. 2026-04-02 meeting: pushed to lock ' +
      'the client fly-in for the week of May 11, 2026 and asked for all briefings as ' +
      'one-pagers with a five-bullet executive summary. 2026-05-28 call: wants a readout on ' +
      'the RDT&E plus-up before the next board meeting.',
  },
  {
    name: 'Marcus Okafor',
    title: 'Vice President of Government Affairs',
    role: 'Primary lobbying contact',
    email: 'marcus.okafor@meridianaero.example.com',
    phone: '202-555-0144',
    lastContact: new Date('2026-06-01'),
    notes:
      'Handles appropriations requests and member outreach; owns the April 17, 2026 member ' +
      'appropriations request form deadline and the relationship with the HASC champion office.',
  },
  {
    name: 'Sofia Ramirez',
    title: 'Principal Engineer, Trade Compliance',
    role: 'Engineering compliance lead',
    email: 'sofia.ramirez@meridianaero.example.com',
    phone: '316-555-0167',
    lastContact: new Date('2026-04-22'),
    notes:
      'Handles ITAR compliance and export-control reviews for composite tooling and automated ' +
      'fiber placement equipment shipments.',
  },
  {
    name: 'Devin Holt',
    title: 'Chief Financial Officer',
    role: 'Budget and contracting approvals',
    email: 'devin.holt@meridianaero.example.com',
    phone: '316-555-0123',
    lastContact: new Date('2026-03-17'),
    notes:
      'Approves the $25,000 monthly retainer, billed quarterly; reviews the lobbying budget ' +
      'each January before renewal.',
  },
  {
    name: 'Anika Sorensen',
    title: 'Wichita Plant General Manager',
    role: 'Site operations',
    email: 'anika.sorensen@meridianaero.example.com',
    phone: '316-555-0190',
    lastContact: new Date('2026-05-06'),
    notes:
      'Runs the Wichita Main Plant on McConnell Boulevard; point of contact for facility ' +
      'tours during the client fly-in.',
  },
  {
    name: 'Trent Caldwell',
    title: 'Director of Communications',
    role: 'Press and coalition messaging',
    email: 'trent.caldwell@meridianaero.example.com',
    phone: '202-555-0178',
    lastContact: new Date('2026-05-15'),
    notes:
      'Coordinates Advanced Airframe Coalition messaging and clears every press release that ' +
      'touches the coalition or its member companies.',
  },
];

export interface KbFixtureFacility {
  name: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  congressionalDistrict: string;
  employeeCount: number;
  notes: string;
}

/** 5 facilities across 4 districts (KS-04 x2, OH-10, AL-05, CA-52). */
export const MERIDIAN_FACILITIES: KbFixtureFacility[] = [
  {
    name: 'Wichita Main Plant',
    addressLine: '4400 McConnell Boulevard',
    city: 'Wichita',
    state: 'KS',
    zip: '67210',
    congressionalDistrict: '04',
    employeeCount: 850,
    notes: 'Primary fuselage assembly line and automated fiber placement cells.',
  },
  {
    name: 'Wichita R&D Center',
    addressLine: '2120 Innovation Way',
    city: 'Wichita',
    state: 'KS',
    zip: '67260',
    congressionalDistrict: '04',
    employeeCount: 120,
    notes: 'Thermoplastic composites research and prototyping lab.',
  },
  {
    name: 'Dayton Engineering Office',
    addressLine: '7575 Research Park Drive',
    city: 'Dayton',
    state: 'OH',
    zip: '45431',
    congressionalDistrict: '10',
    employeeCount: 45,
    notes: 'AFRL liaison office supporting the OTA agreement work.',
  },
  {
    name: 'Huntsville Test Facility',
    addressLine: '300 Redstone Gateway',
    city: 'Huntsville',
    state: 'AL',
    zip: '35808',
    congressionalDistrict: '05',
    employeeCount: 60,
    notes: 'Structural and thermal test rigs for composite airframe sections.',
  },
  {
    name: 'San Diego Repair Depot',
    addressLine: '8910 Miramar Road',
    city: 'San Diego',
    state: 'CA',
    zip: '92126',
    congressionalDistrict: '52',
    employeeCount: 75,
    notes: 'Composite patch-kit repair depot serving Navy aviation customers.',
  },
];

export interface KbFixtureDocument {
  fileName: string;
  text: string;
}

export const MERIDIAN_DOCUMENTS: KbFixtureDocument[] = [
  {
    fileName: 'Meridian Hill Strategy Memo FY2027.docx',
    text: [
      'MEMORANDUM — Meridian Aerostructures FY2027 Hill Strategy',
      '',
      'Objective. Secure an $18.5 million RDT&E plus-up in PE 0604015F, the Air Force ' +
        'advanced materials line, in the FY2027 defense appropriations bill. The plus-up ' +
        'funds qualification of Meridian\'s out-of-autoclave thermoplastic fuselage panels ' +
        'on two program-of-record aircraft.',
      '',
      'Recommendations. First, submit member appropriations request forms before the ' +
        'April 17, 2026 deadline; Marcus Okafor owns the submissions. Second, anchor the ' +
        'House push on Representative Dana Whitfield (KS-04), who sits on HASC and ' +
        'represents both Wichita facilities; request that her office lead a programmatic ' +
        'request letter. Third, on the Senate side, target Theo Brandt, defense legislative ' +
        'assistant to Senator Maro Quist, for a matching request. Fourth, book eight Hill ' +
        'meetings during the client fly-in the week of May 11, 2026, prioritizing HASC and ' +
        'SAC-D personal offices.',
      '',
      'Risks. Talon Composites lobbied against our composite-qualification language last ' +
        'year and is expected to oppose the plus-up again; prepare a rebuttal one-pager on ' +
        'dual-sourcing benefits. Watch for report language directing a study on domestic ' +
        'carbon-fiber capacity, due to Congress September 30, 2026, which we should cite in ' +
        'member meetings.',
      '',
      'Sustainment. Keep the Advanced Airframe Coalition aligned; Meridian chairs the ' +
        'coalition through 2027 and should circulate the ask to member companies before the ' +
        'fly-in.',
    ].join('\n'),
  },
  {
    fileName: 'PE 0604015F RDT&E Budget Exhibit Extract.pdf',
    text: [
      'Exhibit R-2, RDT&E Budget Item Justification: PB 2027 Air Force.',
      'Appropriation/Budget Activity: 3600 / 04. R-1 Program Element (Number/Name): ' +
        'PE 0604015F — Advanced Materials for Airframe Structures.',
      '',
      'Funding profile ($ in millions): FY2025 actual 42.3; FY2026 enacted 47.1; FY2027 ' +
        'request 51.6. The FY2027 request supports out-of-autoclave thermoplastic composite ' +
        'qualification, automated fiber placement process maturation, and transition of ' +
        'rapid-repair composite patch kits to depot use.',
      '',
      'Accomplishments/Planned Programs. In FY2025 the program completed full-scale static ' +
        'testing of a thermoplastic composite fuselage barrel section and awarded prototype ' +
        'work through Other Transaction agreement FA8650-25-9-9301 with the Air Force ' +
        'Research Laboratory (AFRL). FY2026 efforts extend fatigue and damage-tolerance ' +
        'testing and begin airworthiness qualification with two program offices. FY2027 ' +
        'plans complete qualification test articles and deliver depot repair demonstrations.',
      '',
      'Remarks. Industrial-base participants include composite-airframe suppliers in ' +
        'Kansas, Ohio, and Alabama. The program office notes single-source risk in ' +
        'carbon-fiber precursor supply and recommends continued investment in domestic ' +
        'capacity.',
    ].join('\n'),
  },
  {
    fileName: 'Meridian Capabilities One-Pager.pdf',
    text: [
      'Meridian Aerostructures — Capabilities Overview',
      '',
      'Who we are. Meridian Aerostructures designs and manufactures composite airframe ' +
        'structures for defense aircraft, headquartered in Wichita, Kansas. ' +
        'UEI: MER1D1ANAER0. NAICS: 336413, 326199.',
      '',
      'What we build. Out-of-autoclave thermoplastic fuselage and wing assemblies, ' +
        'automated fiber placement tooling, and rapid-repair composite patch kits for ' +
        'legacy airframes.',
      '',
      'Footprint. 850 employees at the Wichita Main Plant (KS-04) plus a 120-person ' +
        'Wichita R&D Center (KS-04); Dayton Engineering Office (OH-10); Huntsville Test ' +
        'Facility (AL-05); San Diego Repair Depot (CA-52).',
      '',
      'Recognition. Won a $3.2 million Department of Energy grant for thermoplastic ' +
        'recycling under award DE-EE0011447. Founding chair of the Advanced Airframe ' +
        'Coalition through 2027. Delivers prototype work to AFRL under OTA agreement ' +
        'FA8650-25-9-9301.',
    ].join('\n'),
  },
];

// ── Eval questions ──────────────────────────────────────────────────────────

export interface KbEvalQuestion {
  id: string;
  question: string;
  /** The KB source type the top-6 retrieval should surface (retrieval@6). */
  expectKind: KbSourceType;
  /** Case-insensitive substrings the graded answer must contain. Every one
   *  literally appears in the seeded corpus (asserted by kb-fixtures.spec.ts). */
  mustInclude: string[];
}

export const KB_EVAL_QUESTIONS: KbEvalQuestion[] = [
  // People lookups
  {
    id: 'kb-person-appropriations',
    question: 'Who at Meridian handles appropriations?',
    expectKind: 'client_person',
    mustInclude: ['Marcus Okafor'],
  },
  {
    id: 'kb-person-itar',
    question: 'Who at Meridian handles ITAR compliance?',
    expectKind: 'client_person',
    mustInclude: ['Sofia Ramirez'],
  },
  {
    id: 'kb-person-ceo-preferences',
    question: "What are CEO Pilar Vance's meeting preferences?",
    expectKind: 'client_person',
    mustInclude: ['early-morning', 'no slide decks'],
  },
  {
    id: 'kb-person-govaffairs-title',
    question: "What is Marcus Okafor's title at Meridian?",
    expectKind: 'client_person',
    mustInclude: ['Vice President of Government Affairs'],
  },
  {
    id: 'kb-person-retainer',
    question: "Who approves Meridian's monthly retainer, and what is the amount?",
    expectKind: 'client_person',
    mustInclude: ['Devin Holt', '$25,000'],
  },
  {
    id: 'kb-person-plant-manager',
    question: "Who runs Meridian's Wichita Main Plant day to day?",
    expectKind: 'client_person',
    mustInclude: ['Anika Sorensen'],
  },
  {
    id: 'kb-person-coalition-comms',
    question: 'Who coordinates Advanced Airframe Coalition messaging for Meridian?',
    expectKind: 'client_person',
    mustInclude: ['Trent Caldwell'],
  },
  {
    id: 'kb-person-last-contact',
    question: 'On what date did we last contact Marcus Okafor?',
    expectKind: 'client_person',
    mustInclude: ['2026-06-01'],
  },
  // Document content
  {
    id: 'kb-doc-memo-ask',
    question: 'What plus-up does the Hill strategy memo recommend, and in which program element?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['18.5', '0604015F'],
  },
  {
    id: 'kb-doc-memo-champion',
    question: 'Per the strategy memo, which House member should lead our push?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['Dana Whitfield', 'KS-04'],
  },
  {
    id: 'kb-doc-memo-senate-target',
    question: 'Which Senate office does the strategy memo target, and through which staffer?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['Theo Brandt', 'Maro Quist'],
  },
  {
    id: 'kb-doc-memo-deadline',
    question: 'What deadline does the strategy memo set for member appropriations request forms?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['April 17, 2026'],
  },
  {
    id: 'kb-doc-memo-competitor',
    question: 'Which competitor does the strategy memo expect to oppose the plus-up?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['Talon Composites'],
  },
  {
    id: 'kb-doc-memo-flyin',
    question: 'Which week is the Meridian fly-in, according to the strategy memo?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['May 11, 2026'],
  },
  {
    id: 'kb-doc-exhibit-fy2027',
    question: 'What is the FY2027 request for PE 0604015F in the budget exhibit (in millions)?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['51.6'],
  },
  {
    id: 'kb-doc-exhibit-fy2026',
    question: 'What was enacted for PE 0604015F in FY2026, per the budget exhibit (in millions)?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['47.1'],
  },
  {
    id: 'kb-doc-exhibit-ota',
    question: "What is the agreement number for Meridian's OTA with AFRL?",
    expectKind: 'client_doc_chunk',
    mustInclude: ['FA8650-25-9-9301'],
  },
  {
    id: 'kb-doc-onepager-grant',
    question: 'What DOE grant did Meridian win, per the capabilities one-pager?',
    expectKind: 'client_doc_chunk',
    mustInclude: ['DE-EE0011447', '3.2'],
  },
  // Facility / district questions
  {
    id: 'kb-fac-districts',
    question: 'Which congressional districts have Meridian facilities?',
    expectKind: 'client_facility',
    mustInclude: ['KS-04', 'OH-10', 'AL-05', 'CA-52'],
  },
  {
    id: 'kb-fac-wichita-headcount',
    question: 'How many employees work at the Wichita Main Plant?',
    expectKind: 'client_facility',
    mustInclude: ['850'],
  },
  {
    id: 'kb-fac-dayton-purpose',
    question: "What does Meridian's Dayton Engineering Office do?",
    expectKind: 'client_facility',
    mustInclude: ['AFRL liaison'],
  },
  {
    id: 'kb-fac-san-diego-district',
    question: 'Which congressional district is the San Diego Repair Depot in?',
    expectKind: 'client_facility',
    mustInclude: ['CA-52'],
  },
  {
    id: 'kb-fac-huntsville',
    question: 'Which Meridian facility is in Alabama, and how many people work there?',
    expectKind: 'client_facility',
    mustInclude: ['Huntsville Test Facility', '60'],
  },
  {
    id: 'kb-fac-rnd-center',
    question: 'What happens at the Wichita R&D Center?',
    expectKind: 'client_facility',
    mustInclude: ['Thermoplastic', 'prototyping'],
  },
  // Profile facts
  {
    id: 'kb-profile-uei',
    question: "What is Meridian's UEI?",
    expectKind: 'client_profile',
    mustInclude: ['MER1D1ANAER0'],
  },
  {
    id: 'kb-profile-issue-codes',
    question: "Which LDA issue codes are on Meridian's profile?",
    expectKind: 'client_profile',
    mustInclude: ['DEF', 'AER'],
  },
  {
    id: 'kb-profile-naics',
    question: 'Which NAICS codes does Meridian operate under?',
    expectKind: 'client_profile',
    mustInclude: ['336413', '326199'],
  },
  {
    id: 'kb-profile-sector',
    question: 'What sector is Meridian in, and what kind of structures does the company make?',
    expectKind: 'client_profile',
    mustInclude: ['defense', 'composite'],
  },
  // Multi-hop
  {
    id: 'kb-multi-champion-district-facilities',
    question:
      "Which Meridian facilities sit in our House champion's district? (The strategy memo names the champion.)",
    expectKind: 'client_facility',
    mustInclude: ['Wichita Main Plant', 'Wichita R&D Center'],
  },
  {
    id: 'kb-multi-pe-owner',
    question:
      'Who at Meridian should own the PE 0604015F appropriations push, and what is the dollar ask?',
    expectKind: 'client_person',
    mustInclude: ['Marcus Okafor', '18.5'],
  },
];

// ── Corpus + snapshot builders (production text builders, reused by the
//    runner and the CI spec so they can never drift) ────────────────────────

export interface KbCorpusRow {
  kind: KbSourceType;
  id: string;
  text: string;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** The full retrieval corpus exactly as the production indexer would embed it. */
export function buildKbEvalCorpus(): KbCorpusRow[] {
  const clientName = MERIDIAN_CLIENT.name;
  const rows: KbCorpusRow[] = [
    {
      kind: 'client_profile',
      id: `profile:${slug(clientName)}`,
      text: buildClientProfileText(MERIDIAN_CLIENT),
    },
    ...MERIDIAN_PEOPLE.map((p) => ({
      kind: 'client_person' as const,
      id: `person:${slug(p.name)}`,
      text: buildClientPersonText({ ...p, clientName }),
    })),
    ...MERIDIAN_FACILITIES.map((f) => ({
      kind: 'client_facility' as const,
      id: `facility:${slug(f.name)}`,
      text: buildClientFacilityText({ ...f, clientName }),
    })),
  ];
  for (const doc of MERIDIAN_DOCUMENTS) {
    const chunks = chunkDocumentText(doc.text);
    chunks.forEach((chunk, i) => {
      rows.push({
        kind: 'client_doc_chunk',
        id: `doc:${slug(doc.fileName)}:${i}`,
        text: buildDocChunkText({
          clientName,
          fileName: doc.fileName,
          chunk,
          chunkIndex: i,
          chunkCount: chunks.length,
        }),
      });
    });
  }
  return rows;
}

/** Fixed timestamp so the snapshot is deterministic. */
export const KB_EVAL_DOC_CREATED_AT = new Date('2026-06-01T00:00:00Z');

/** The always-on KB snapshot exactly as production would inject it. */
export function buildKbEvalSnapshot(): string {
  return buildKbSnapshot({
    client: MERIDIAN_CLIENT,
    people: MERIDIAN_PEOPLE,
    facilities: MERIDIAN_FACILITIES,
    recentDocs: MERIDIAN_DOCUMENTS.map((d) => ({
      fileName: d.fileName,
      createdAt: KB_EVAL_DOC_CREATED_AT,
    })),
  });
}
