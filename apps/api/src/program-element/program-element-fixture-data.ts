import type { PeMilestoneInput, PeRecordInput, PeYearInput } from './types.js';

export interface ProgramElementFixture {
  record: PeRecordInput;
  years: PeYearInput[];
  milestones: PeMilestoneInput[];
  currentCycleFy: number;
}

export const REQUIRED_PE_CODES = ['0603270A', '0603250F', '0204134N', '0603766S', '0603860D'] as const;

const FY_WINDOW = [2023, 2024, 2025, 2026, 2027] as const;

type YearSeriesPoint = {
  request: number;
  hascMark: number | null;
  sascMark: number | null;
  hacDMark: number | null;
  sacDMark: number | null;
  conference: number | null;
  enacted: number | null;
  reprogrammed: number | null;
  executed: number | null;
  notes: string;
};

function yearsFor(peCode: string, series: YearSeriesPoint[]): PeYearInput[] {
  if (series.length !== FY_WINDOW.length) {
    throw new Error(`Fixture year mismatch for ${peCode}: expected ${FY_WINDOW.length} rows, got ${series.length}`);
  }

  return FY_WINDOW.map((fy, idx) => {
    const row = series[idx];
    if (!row) {
      throw new Error(`Missing fixture row for ${peCode} FY${fy}`);
    }

    return {
      peCode,
      fy,
      request: row.request,
      hascMark: row.hascMark,
      sascMark: row.sascMark,
      hacDMark: row.hacDMark,
      sacDMark: row.sacDMark,
      conference: row.conference,
      enacted: row.enacted,
      reprogrammed: row.reprogrammed,
      executed: row.executed,
      notes: row.notes,
      rDocSection: `FY${fy} PB justification`,
    };
  });
}

export const PROGRAM_ELEMENT_FIXTURES: ProgramElementFixture[] = [
  {
    record: {
      peCode: '0603270A',
      service: 'Army',
      serviceCode: 'A',
      appropriationType: 'RDT&E',
      budgetActivity: '04',
      budgetActivityName: 'Advanced Component Development & Prototypes',
      lineNumber: '41',
      title: 'Electronic Warfare Advanced Payloads',
      description: 'Army EW payload modernization and rapid prototyping.',
      acatLevel: 'ACAT II',
      programOfRecord: 'Terrestrial Layer EW Suite',
      status: 'active',
      rDocUrl: 'https://example.mil/army/rdoc/0603270A',
      pDocUrl: 'https://example.mil/army/pdoc/0603270A',
      oDocUrl: 'https://example.mil/army/odoc/0603270A',
      firstSeenFy: 2023,
      raw: { fixture: true },
    },
    years: yearsFor('0603270A', [
      { request: 220.1, hascMark: 235.2, sascMark: 214.0, hacDMark: 230.0, sacDMark: 212.5, conference: 224.0, enacted: 224.0, reprogrammed: 5.0, executed: 229.0, notes: 'HASC plus-up for EW kits' },
      { request: 233.4, hascMark: 228.0, sascMark: 241.0, hacDMark: 225.2, sacDMark: 238.0, conference: 232.0, enacted: 232.0, reprogrammed: 2.1, executed: 234.1, notes: 'SASC prioritizes airborne integration' },
      { request: 245.8, hascMark: 260.0, sascMark: 252.0, hacDMark: 256.0, sacDMark: 249.0, conference: 253.0, enacted: 253.0, reprogrammed: 1.0, executed: 254.0, notes: 'Conference compromise near midpoint' },
      { request: 262.0, hascMark: 250.0, sascMark: 244.0, hacDMark: 248.0, sacDMark: 242.0, conference: 245.0, enacted: 245.0, reprogrammed: -3.0, executed: 242.0, notes: 'Across-the-board cut pressure' },
      { request: 278.5, hascMark: 290.0, sascMark: 284.0, hacDMark: 288.0, sacDMark: 281.0, conference: 286.0, enacted: 286.0, reprogrammed: null, executed: null, notes: 'Current cycle in progress' },
    ]),
    milestones: [
      { peCode: '0603270A', milestoneType: 'MS_B', plannedDate: '2025-10-01', status: 'planned', notes: 'Subsystem baseline' },
      { peCode: '0603270A', milestoneType: 'LRIP', plannedDate: '2027-04-01', status: 'planned', notes: 'Low-rate kit fielding' },
    ],
    currentCycleFy: 2027,
  },
  {
    record: {
      peCode: '0603250F',
      service: 'Air Force',
      serviceCode: 'F',
      appropriationType: 'RDT&E',
      budgetActivity: '05',
      budgetActivityName: 'System Development & Demonstration',
      lineNumber: '27',
      title: 'Adaptive Engine Transition',
      description: 'Adaptive cycle propulsion risk-reduction and integration.',
      acatLevel: 'ACAT I',
      programOfRecord: 'Next Generation Adaptive Propulsion',
      status: 'active',
      firstSeenFy: 2023,
      raw: { fixture: true },
    },
    years: yearsFor('0603250F', [
      { request: 310.0, hascMark: 300.0, sascMark: 325.0, hacDMark: 298.0, sacDMark: 322.0, conference: 311.0, enacted: 311.0, reprogrammed: 0.0, executed: 311.0, notes: 'SASC plus-up for propulsion test cells' },
      { request: 326.5, hascMark: 339.0, sascMark: 332.0, hacDMark: 336.0, sacDMark: 330.0, conference: 333.0, enacted: 333.0, reprogrammed: 3.0, executed: 336.0, notes: 'House supports accelerated materials buys' },
      { request: 345.1, hascMark: 340.0, sascMark: 336.0, hacDMark: 338.0, sacDMark: 334.0, conference: 336.0, enacted: 336.0, reprogrammed: -2.0, executed: 334.0, notes: 'Conference trims growth profile' },
      { request: 360.0, hascMark: 372.0, sascMark: 355.0, hacDMark: 369.0, sacDMark: 351.0, conference: 361.0, enacted: 361.0, reprogrammed: 4.0, executed: 365.0, notes: 'House plus-up for digital twin lab' },
      { request: 382.0, hascMark: null, sascMark: null, hacDMark: null, sacDMark: null, conference: null, enacted: null, reprogrammed: null, executed: null, notes: 'Current cycle request only' },
    ]),
    milestones: [
      { peCode: '0603250F', milestoneType: 'MS_C', plannedDate: '2026-09-01', status: 'planned', notes: 'Engine integration gate' },
      { peCode: '0603250F', milestoneType: 'IOC', plannedDate: '2028-01-15', status: 'planned', notes: 'Initial fielded lot' },
    ],
    currentCycleFy: 2027,
  },
  {
    record: {
      peCode: '0204134N',
      service: 'Navy',
      serviceCode: 'N',
      appropriationType: 'RDT&E',
      budgetActivity: '06',
      budgetActivityName: 'RDT&E Management Support',
      lineNumber: '12',
      title: 'F/A-18 Service Life and Mission Systems',
      description: 'Navy F/A-18 sustainment modernization and avionics refresh.',
      acatLevel: 'ACAT I',
      programOfRecord: 'F/A-18 E/F Block III',
      status: 'active',
      firstSeenFy: 2023,
      raw: { fixture: true },
    },
    years: yearsFor('0204134N', [
      { request: 188.0, hascMark: 180.0, sascMark: 196.0, hacDMark: 179.0, sacDMark: 194.0, conference: 187.0, enacted: 187.0, reprogrammed: 1.0, executed: 188.0, notes: 'Senate adds radar reliability funds' },
      { request: 193.2, hascMark: 201.0, sascMark: 196.0, hacDMark: 199.0, sacDMark: 194.5, conference: 197.0, enacted: 197.0, reprogrammed: 0.0, executed: 197.0, notes: 'House supports depot backlog relief' },
      { request: 201.0, hascMark: 198.0, sascMark: 205.0, hacDMark: 197.0, sacDMark: 203.0, conference: 200.0, enacted: 200.0, reprogrammed: 2.0, executed: 202.0, notes: 'Conference keeps request level' },
      { request: 210.0, hascMark: 215.0, sascMark: 212.0, hacDMark: 214.0, sacDMark: 210.0, conference: 212.0, enacted: 212.0, reprogrammed: -1.0, executed: 211.0, notes: 'Slight house lead on engine kits' },
      { request: 222.0, hascMark: 219.0, sascMark: 225.0, hacDMark: 218.0, sacDMark: 223.0, conference: 221.0, enacted: 221.0, reprogrammed: null, executed: null, notes: 'Current cycle near-conference estimate' },
    ]),
    milestones: [
      { peCode: '0204134N', milestoneType: 'MS_B', plannedDate: '2024-11-01', actualDate: '2024-10-15', status: 'complete', notes: 'Avionics package baselined' },
      { peCode: '0204134N', milestoneType: 'MS_C', plannedDate: '2026-08-01', status: 'planned', notes: 'Fleet integration gate' },
    ],
    currentCycleFy: 2027,
  },
  {
    record: {
      peCode: '0603766S',
      service: 'Space Force',
      serviceCode: 'S',
      appropriationType: 'RDT&E',
      budgetActivity: '05',
      budgetActivityName: 'System Development & Demonstration',
      lineNumber: '05',
      title: 'GPS III Follow-on Modernization',
      description: 'Space Force modernization of GPS III capability increments.',
      acatLevel: 'ACAT IC',
      programOfRecord: 'GPS III',
      status: 'active',
      firstSeenFy: 2023,
      raw: { fixture: true },
    },
    years: yearsFor('0603766S', [
      { request: 410.0, hascMark: 420.0, sascMark: 405.0, hacDMark: 418.0, sacDMark: 401.0, conference: 410.0, enacted: 410.0, reprogrammed: 0.0, executed: 410.0, notes: 'House plus-up for launch resiliency' },
      { request: 430.0, hascMark: 425.0, sascMark: 437.0, hacDMark: 423.0, sacDMark: 435.0, conference: 429.0, enacted: 429.0, reprogrammed: 2.0, executed: 431.0, notes: 'Senate prioritizes anti-jam payload' },
      { request: 445.0, hascMark: 455.0, sascMark: 448.0, hacDMark: 452.0, sacDMark: 446.0, conference: 449.0, enacted: 449.0, reprogrammed: 1.0, executed: 450.0, notes: 'Conference modest plus-up' },
      { request: 463.0, hascMark: 458.0, sascMark: 469.0, hacDMark: 456.0, sacDMark: 467.0, conference: 462.0, enacted: 462.0, reprogrammed: -2.0, executed: 460.0, notes: 'Range-side infrastructure shift' },
      { request: 482.0, hascMark: null, sascMark: null, hacDMark: null, sacDMark: null, conference: null, enacted: null, reprogrammed: null, executed: null, notes: 'Current cycle request only' },
    ]),
    milestones: [
      { peCode: '0603766S', milestoneType: 'SV_TEST', plannedDate: '2026-06-01', status: 'planned', notes: 'Space vehicle thermal-vac test' },
      { peCode: '0603766S', milestoneType: 'LAUNCH_READINESS', plannedDate: '2027-09-01', status: 'planned', notes: 'Launch readiness review' },
    ],
    currentCycleFy: 2027,
  },
  {
    record: {
      peCode: '0603860D',
      service: 'DoD-wide',
      serviceCode: 'DW',
      appropriationType: 'RDT&E',
      budgetActivity: '04',
      budgetActivityName: 'Advanced Component Development & Prototypes',
      lineNumber: '88',
      title: 'Counter-UAS Joint Defeat System',
      description: 'DoD-wide CUAS integration and rapid response prototyping.',
      acatLevel: 'ACAT ID',
      programOfRecord: 'Joint CUAS',
      status: 'active',
      firstSeenFy: 2023,
      raw: { fixture: true },
    },
    years: yearsFor('0603860D', [
      { request: 275.0, hascMark: 289.0, sascMark: 280.0, hacDMark: 287.0, sacDMark: 278.0, conference: 283.0, enacted: 283.0, reprogrammed: 4.0, executed: 287.0, notes: 'House plus-up due to theater demand' },
      { request: 291.0, hascMark: 286.0, sascMark: 299.0, hacDMark: 284.0, sacDMark: 297.0, conference: 291.0, enacted: 291.0, reprogrammed: 0.0, executed: 291.0, notes: 'Senate supports sensor expansion' },
      { request: 304.0, hascMark: 300.0, sascMark: 309.0, hacDMark: 298.0, sacDMark: 307.0, conference: 303.0, enacted: 303.0, reprogrammed: 1.5, executed: 304.5, notes: 'Conference near request' },
      { request: 318.0, hascMark: 326.0, sascMark: 321.0, hacDMark: 324.0, sacDMark: 320.0, conference: 322.0, enacted: 322.0, reprogrammed: -1.0, executed: 321.0, notes: 'House line restoration' },
      { request: 332.0, hascMark: 335.0, sascMark: 330.0, hacDMark: 334.0, sacDMark: 329.0, conference: 332.0, enacted: 332.0, reprogrammed: null, executed: null, notes: 'Current cycle estimate complete' },
    ]),
    milestones: [
      { peCode: '0603860D', milestoneType: 'MS_B', plannedDate: '2025-05-01', actualDate: '2025-06-15', status: 'complete', notes: 'Architecture baseline approved' },
      { peCode: '0603860D', milestoneType: 'MS_C', plannedDate: '2027-03-01', status: 'planned', notes: 'Joint deployment decision' },
    ],
    currentCycleFy: 2027,
  },
  {
    record: { peCode: '0604721A', service: 'Army', serviceCode: 'A', appropriationType: 'RDT&E', budgetActivity: '05', budgetActivityName: 'System Development & Demonstration', lineNumber: '66', title: 'Network C3 Resilience', description: 'Army command-and-control resilience and mesh networking.', status: 'active', firstSeenFy: 2023, raw: { fixture: true } },
    years: yearsFor('0604721A', [
      { request: 130.0, hascMark: 136.0, sascMark: 132.0, hacDMark: 135.0, sacDMark: 131.0, conference: 133.0, enacted: 133.0, reprogrammed: 0.0, executed: 133.0, notes: 'Modest house plus-up' },
      { request: 138.0, hascMark: 134.0, sascMark: 141.0, hacDMark: 133.0, sacDMark: 139.0, conference: 137.0, enacted: 137.0, reprogrammed: 1.0, executed: 138.0, notes: 'Senate funding for SATCOM links' },
      { request: 145.0, hascMark: 149.0, sascMark: 146.0, hacDMark: 148.0, sacDMark: 145.0, conference: 146.5, enacted: 146.5, reprogrammed: 0.0, executed: 146.5, notes: 'Conference compromise' },
      { request: 151.0, hascMark: 150.0, sascMark: 154.0, hacDMark: 149.0, sacDMark: 153.0, conference: 151.5, enacted: 151.5, reprogrammed: null, executed: 151.5, notes: 'Stable growth' },
      { request: 159.0, hascMark: 161.0, sascMark: 158.0, hacDMark: 160.0, sacDMark: 157.0, conference: 159.0, enacted: 159.0, reprogrammed: null, executed: null, notes: 'Current cycle near request' },
    ]),
    milestones: [
      { peCode: '0604721A', milestoneType: 'IOC', plannedDate: '2026-11-01', status: 'planned', notes: 'Initial operational node package' },
    ],
    currentCycleFy: 2027,
  },
  {
    record: { peCode: '0604288F', service: 'Air Force', serviceCode: 'F', appropriationType: 'RDT&E', budgetActivity: '04', budgetActivityName: 'Advanced Component Development & Prototypes', lineNumber: '73', title: 'NGAD Enabling Technologies', description: 'Air dominance enabling technologies for NGAD portfolio.', status: 'active', firstSeenFy: 2023, raw: { fixture: true } },
    years: yearsFor('0604288F', [
      { request: 520.0, hascMark: 540.0, sascMark: 530.0, hacDMark: 538.0, sacDMark: 528.0, conference: 534.0, enacted: 534.0, reprogrammed: 6.0, executed: 540.0, notes: 'Broad congressional support' },
      { request: 545.0, hascMark: 552.0, sascMark: 559.0, hacDMark: 550.0, sacDMark: 557.0, conference: 554.0, enacted: 554.0, reprogrammed: 3.0, executed: 557.0, notes: 'Both chambers add margin' },
      { request: 570.0, hascMark: 562.0, sascMark: 579.0, hacDMark: 560.0, sacDMark: 576.0, conference: 568.0, enacted: 568.0, reprogrammed: -4.0, executed: 564.0, notes: 'Conference trims to affordability' },
      { request: 589.0, hascMark: 600.0, sascMark: 592.0, hacDMark: 597.0, sacDMark: 590.0, conference: 594.0, enacted: 594.0, reprogrammed: 2.0, executed: 596.0, notes: 'House plus-up for low-observable tooling' },
      { request: 610.0, hascMark: 605.0, sascMark: 612.0, hacDMark: 603.0, sacDMark: 610.0, conference: 608.0, enacted: 608.0, reprogrammed: null, executed: null, notes: 'Current cycle complete profile' },
    ]),
    milestones: [{ peCode: '0604288F', milestoneType: 'TECH_DEMO', plannedDate: '2026-04-01', status: 'planned', notes: 'Integrated subsystem demo' }],
    currentCycleFy: 2027,
  },
  {
    record: { peCode: '0204571N', service: 'Navy', serviceCode: 'N', appropriationType: 'RDT&E', budgetActivity: '04', budgetActivityName: 'Advanced Component Development & Prototypes', lineNumber: '90', title: 'Naval Hypersonic Integration', description: 'Hypersonic strike integration for naval platforms.', status: 'active', firstSeenFy: 2023, raw: { fixture: true } },
    years: yearsFor('0204571N', [
      { request: 260.0, hascMark: 257.0, sascMark: 268.0, hacDMark: 255.0, sacDMark: 266.0, conference: 261.0, enacted: 261.0, reprogrammed: 1.0, executed: 262.0, notes: 'Senate plus-up for test flights' },
      { request: 276.0, hascMark: 282.0, sascMark: 279.0, hacDMark: 280.0, sacDMark: 277.0, conference: 279.0, enacted: 279.0, reprogrammed: 0.0, executed: 279.0, notes: 'House support for launch infrastructure' },
      { request: 290.0, hascMark: 287.0, sascMark: 295.0, hacDMark: 286.0, sacDMark: 293.0, conference: 289.0, enacted: 289.0, reprogrammed: 2.0, executed: 291.0, notes: 'Conference near request with targeted adds' },
      { request: 304.0, hascMark: 312.0, sascMark: 307.0, hacDMark: 310.0, sacDMark: 305.0, conference: 308.0, enacted: 308.0, reprogrammed: -1.0, executed: 307.0, notes: 'House marginal lead' },
      { request: 320.0, hascMark: 318.0, sascMark: 323.0, hacDMark: 317.0, sacDMark: 322.0, conference: 320.0, enacted: 320.0, reprogrammed: null, executed: null, notes: 'Current cycle complete profile' },
    ]),
    milestones: [{ peCode: '0204571N', milestoneType: 'FLIGHT_TEST', plannedDate: '2027-02-01', status: 'planned', notes: 'Sea-based integrated test' }],
    currentCycleFy: 2027,
  },
  {
    record: { peCode: '1206893S', service: 'Space Force', serviceCode: 'S', appropriationType: 'RDT&E', budgetActivity: '04', budgetActivityName: 'Advanced Component Development & Prototypes', lineNumber: '33', title: 'Tactical SATCOM Agility', description: 'Protected tactical SATCOM waveform and terminal agility.', status: 'active', firstSeenFy: 2023, raw: { fixture: true } },
    years: yearsFor('1206893S', [
      { request: 150.0, hascMark: 155.0, sascMark: 149.0, hacDMark: 154.0, sacDMark: 147.0, conference: 151.0, enacted: 151.0, reprogrammed: 1.0, executed: 152.0, notes: 'House supports anti-jam terminals' },
      { request: 162.0, hascMark: 160.0, sascMark: 166.0, hacDMark: 159.0, sacDMark: 164.0, conference: 162.0, enacted: 162.0, reprogrammed: 0.0, executed: 162.0, notes: 'Senate push for tactical gateways' },
      { request: 174.0, hascMark: 178.0, sascMark: 176.0, hacDMark: 177.0, sacDMark: 174.0, conference: 175.0, enacted: 175.0, reprogrammed: 2.0, executed: 177.0, notes: 'Conference slight plus-up' },
      { request: 186.0, hascMark: 184.0, sascMark: 190.0, hacDMark: 183.0, sacDMark: 188.0, conference: 186.0, enacted: 186.0, reprogrammed: null, executed: 186.0, notes: 'Steady demand growth' },
      { request: 198.0, hascMark: null, sascMark: null, hacDMark: null, sacDMark: null, conference: null, enacted: null, reprogrammed: null, executed: null, notes: 'Current cycle request only' },
    ]),
    milestones: [{ peCode: '1206893S', milestoneType: 'MS_B', plannedDate: '2026-03-15', status: 'planned', notes: 'Terminal integration baseline' }],
    currentCycleFy: 2027,
  },
  {
    record: { peCode: '0605013D', service: 'DoD-wide', serviceCode: 'DW', appropriationType: 'RDT&E', budgetActivity: '05', budgetActivityName: 'System Development & Demonstration', lineNumber: '51', title: 'Trusted Microelectronics Transition', description: 'DoD trusted microelectronics and secure packaging transition.', status: 'active', firstSeenFy: 2023, raw: { fixture: true } },
    years: yearsFor('0605013D', [
      { request: 340.0, hascMark: 348.0, sascMark: 344.0, hacDMark: 347.0, sacDMark: 342.0, conference: 345.0, enacted: 345.0, reprogrammed: 2.0, executed: 347.0, notes: 'House plus-up for domestic fab tooling' },
      { request: 360.0, hascMark: 355.0, sascMark: 366.0, hacDMark: 353.0, sacDMark: 364.0, conference: 359.0, enacted: 359.0, reprogrammed: 1.0, executed: 360.0, notes: 'Senate boost on secure packaging' },
      { request: 379.0, hascMark: 386.0, sascMark: 381.0, hacDMark: 384.0, sacDMark: 379.0, conference: 382.0, enacted: 382.0, reprogrammed: 0.0, executed: 382.0, notes: 'Conference plus-up for foundry resilience' },
      { request: 398.0, hascMark: 392.0, sascMark: 401.0, hacDMark: 390.0, sacDMark: 399.0, conference: 395.0, enacted: 395.0, reprogrammed: -3.0, executed: 392.0, notes: 'Conference trims but keeps growth' },
      { request: 415.0, hascMark: 418.0, sascMark: 413.0, hacDMark: 416.0, sacDMark: 412.0, conference: 414.0, enacted: 414.0, reprogrammed: null, executed: null, notes: 'Current cycle complete profile' },
    ]),
    milestones: [{ peCode: '0605013D', milestoneType: 'PILOT_LINE', plannedDate: '2026-10-01', status: 'planned', notes: 'Pilot line qualification' }],
    currentCycleFy: 2027,
  },
  {
    record: { peCode: '0607138A', service: 'Army', serviceCode: 'A', appropriationType: 'RDT&E', budgetActivity: '04', budgetActivityName: 'Advanced Component Development & Prototypes', lineNumber: '58', title: 'UAS Payload Interoperability', description: 'Army UAS payload interoperability and autonomy toolkit.', status: 'active', firstSeenFy: 2023, raw: { fixture: true } },
    years: yearsFor('0607138A', [
      { request: 95.0, hascMark: 102.0, sascMark: 98.0, hacDMark: 101.0, sacDMark: 97.0, conference: 99.0, enacted: 99.0, reprogrammed: 0.0, executed: 99.0, notes: 'House plus-up for autonomy stack' },
      { request: 103.0, hascMark: 101.0, sascMark: 107.0, hacDMark: 100.0, sacDMark: 105.0, conference: 103.0, enacted: 103.0, reprogrammed: 1.0, executed: 104.0, notes: 'Senate adds test-range support' },
      { request: 111.0, hascMark: 114.0, sascMark: 112.0, hacDMark: 113.0, sacDMark: 110.0, conference: 112.0, enacted: 112.0, reprogrammed: 0.0, executed: 112.0, notes: 'Conference aligns with growth' },
      { request: 118.0, hascMark: 116.0, sascMark: 121.0, hacDMark: 115.0, sacDMark: 119.0, conference: 118.0, enacted: 118.0, reprogrammed: null, executed: 118.0, notes: 'Steady procurement handoff' },
      { request: 126.0, hascMark: 127.0, sascMark: 124.0, hacDMark: 126.0, sacDMark: 123.0, conference: 125.0, enacted: 125.0, reprogrammed: null, executed: null, notes: 'Current cycle complete profile' },
    ]),
    milestones: [{ peCode: '0607138A', milestoneType: 'FIELD_TEST', plannedDate: '2026-07-01', status: 'planned', notes: 'Joint field event' }],
    currentCycleFy: 2027,
  },
  {
    record: { peCode: '0605210F', service: 'Air Force', serviceCode: 'F', appropriationType: 'RDT&E', budgetActivity: '06', budgetActivityName: 'RDT&E Management Support', lineNumber: '61', title: 'Cyber Mission Resilience', description: 'Air Force cyber mission resilience and mission assurance tooling.', status: 'active', firstSeenFy: 2023, raw: { fixture: true } },
    years: yearsFor('0605210F', [
      { request: 140.0, hascMark: 143.0, sascMark: 139.0, hacDMark: 142.0, sacDMark: 138.0, conference: 140.0, enacted: 140.0, reprogrammed: 0.0, executed: 140.0, notes: 'House plus-up for zero trust pilots' },
      { request: 148.0, hascMark: 146.0, sascMark: 151.0, hacDMark: 145.0, sacDMark: 150.0, conference: 148.0, enacted: 148.0, reprogrammed: 1.0, executed: 149.0, notes: 'Senate favors mission assurance analytics' },
      { request: 156.0, hascMark: 160.0, sascMark: 157.0, hacDMark: 159.0, sacDMark: 156.0, conference: 158.0, enacted: 158.0, reprogrammed: 0.0, executed: 158.0, notes: 'Conference modest plus-up' },
      { request: 164.0, hascMark: 162.0, sascMark: 167.0, hacDMark: 161.0, sacDMark: 166.0, conference: 164.0, enacted: 164.0, reprogrammed: -1.0, executed: 163.0, notes: 'Small late-cycle cut' },
      { request: 172.0, hascMark: 171.0, sascMark: 174.0, hacDMark: 170.0, sacDMark: 173.0, conference: 172.0, enacted: 172.0, reprogrammed: null, executed: null, notes: 'Current cycle complete profile' },
    ]),
    milestones: [{ peCode: '0605210F', milestoneType: 'MS_B', plannedDate: '2025-09-01', status: 'planned', notes: 'Architecture lock for deployable stack' }],
    currentCycleFy: 2027,
  },
];
