/**
 * Analysis eval fixtures (assistant-parity F4 — run_analysis sandbox).
 *
 * 15 deterministic question+dataset cases shaped like real Capiro data
 * (LDA filings, PE budget timelines, federal awards, client facilities).
 * Every question requires real computation (sums, YoY deltas + percent
 * change, counts, averages, max) and every ground-truth number was computed
 * by hand from the fixture rows below.
 *
 * Grading contract (scripts/eval-clio-analysis.ts): the final model answer
 * must contain every `mustInclude` fragment after commas are stripped from
 * BOTH sides — so fragments are stored in digits-only canonical form
 * ('200000' matches "200,000" and "200000"; '1018.5' matches "1,018.5").
 *
 * Pure data so fixture validity is CI-tested (analysis-fixtures.spec.ts,
 * which RECOMPUTES each ground truth from the rows) without burning tokens.
 */

export interface AnalysisEvalDataset {
  name: string;
  rows: Array<Record<string, string | number>>;
}

export interface AnalysisEvalCase {
  id: string;
  question: string;
  datasets: AnalysisEvalDataset[];
  groundTruth: {
    /** Comma-insensitive, case-insensitive substrings the final answer must contain. */
    mustInclude: string[];
  };
}

// ── Shared row sets ────────────────────────────────────────────────────────

/** LDA filing rows: { client, registrant, year, amount } (amount in dollars). */
const LDA_FILING_ROWS: Array<Record<string, string | number>> = [
  { client: 'Apex Dynamics', registrant: 'Capitol Partners LLC', year: 2024, amount: 60000 },
  { client: 'Apex Dynamics', registrant: 'Capitol Partners LLC', year: 2025, amount: 80000 },
  { client: 'Apex Dynamics', registrant: 'Summit Strategies', year: 2024, amount: 50000 },
  { client: 'Helios Aerospace', registrant: 'Capitol Partners LLC', year: 2024, amount: 40000 },
  { client: 'Helios Aerospace', registrant: 'Summit Strategies', year: 2024, amount: 30000 },
  { client: 'Helios Aerospace', registrant: 'Summit Strategies', year: 2025, amount: 105000 },
  { client: 'Nova Marine', registrant: 'Beacon Hill Group', year: 2025, amount: 70000 },
  { client: 'Nova Marine', registrant: 'Capitol Partners LLC', year: 2025, amount: 20000 },
];

/** PE budget-timeline rows: { peCode, fiscalYear, requestMillions, enactedMillions }. */
const PE_BUDGET_ROWS: Array<Record<string, string | number>> = [
  { peCode: '0604858A', fiscalYear: 2024, requestMillions: 120.5, enactedMillions: 132.0 },
  { peCode: '0604858A', fiscalYear: 2025, requestMillions: 140.0, enactedMillions: 150.0 },
  { peCode: '0604858A', fiscalYear: 2026, requestMillions: 160.0, enactedMillions: 165.0 },
  { peCode: '0207138F', fiscalYear: 2024, requestMillions: 300.0, enactedMillions: 280.0 },
  { peCode: '0207138F', fiscalYear: 2025, requestMillions: 320.0, enactedMillions: 336.0 },
  { peCode: '0207138F', fiscalYear: 2026, requestMillions: 410.0, enactedMillions: 402.5 },
];

/** Federal award rows: { recipient, agency, amountDollars, state, district }. */
const FEDERAL_AWARD_ROWS: Array<Record<string, string | number>> = [
  { recipient: 'Apex Dynamics', agency: 'Department of Defense', amountDollars: 2500000, state: 'KS', district: 'KS-01' },
  { recipient: 'Apex Dynamics', agency: 'Department of Defense', amountDollars: 1500000, state: 'KS', district: 'KS-02' },
  { recipient: 'Apex Dynamics', agency: 'Department of Energy', amountDollars: 1000000, state: 'KS', district: 'KS-01' },
  { recipient: 'Helios Aerospace', agency: 'Department of Defense', amountDollars: 4000000, state: 'MO', district: 'MO-04' },
  { recipient: 'Helios Aerospace', agency: 'NASA', amountDollars: 3000000, state: 'MO', district: 'MO-04' },
  { recipient: 'Helios Aerospace', agency: 'Department of Energy', amountDollars: 700000, state: 'MO', district: 'MO-04' },
  { recipient: 'Nova Marine', agency: 'Department of Defense', amountDollars: 500000, state: 'VA', district: 'VA-02' },
  { recipient: 'Nova Marine', agency: 'NASA', amountDollars: 1200000, state: 'VA', district: 'VA-02' },
  { recipient: 'Nova Marine', agency: 'Department of Energy', amountDollars: 900000, state: 'VA', district: 'VA-03' },
];

/** Client facility rows: { name, state, district, employees }. */
const CLIENT_FACILITY_ROWS: Array<Record<string, string | number>> = [
  { name: 'Wichita Assembly Plant', state: 'KS', district: 'KS-04', employees: 1200 },
  { name: 'Wichita Supply Depot', state: 'KS', district: 'KS-04', employees: 350 },
  { name: 'Derby Avionics Shop', state: 'KS', district: 'KS-04', employees: 175 },
  { name: 'Topeka Research Center', state: 'KS', district: 'KS-02', employees: 450 },
  { name: 'Salina Logistics Hub', state: 'KS', district: 'KS-01', employees: 300 },
  { name: 'Kansas City Office', state: 'KS', district: 'KS-03', employees: 150 },
  { name: 'St. Louis Engineering Lab', state: 'MO', district: 'MO-01', employees: 600 },
  { name: 'Springfield Test Facility', state: 'MO', district: 'MO-07', employees: 250 },
  { name: 'Norfolk Shipyard Annex', state: 'VA', district: 'VA-03', employees: 800 },
];

const ldaDataset = (): AnalysisEvalDataset => ({ name: 'lda_filings', rows: LDA_FILING_ROWS });
const peDataset = (): AnalysisEvalDataset => ({ name: 'pe_budget', rows: PE_BUDGET_ROWS });
const awardDataset = (): AnalysisEvalDataset => ({ name: 'federal_awards', rows: FEDERAL_AWARD_ROWS });
const facilityDataset = (): AnalysisEvalDataset => ({ name: 'client_facilities', rows: CLIENT_FACILITY_ROWS });

// ── Cases ──────────────────────────────────────────────────────────────────

export const ANALYSIS_EVAL_CASES: AnalysisEvalCase[] = [
  // LDA filings —————————————————————————————————————————————————————————
  {
    id: 'lda-top-registrant',
    question:
      'Which registrant billed the highest total lobbying spend across all filings, and what is that total in dollars?',
    datasets: [ldaDataset()],
    // Capitol Partners LLC: 60000 + 80000 + 40000 + 20000 = 200000
    // (Summit Strategies: 185000; Beacon Hill Group: 70000)
    groundTruth: { mustInclude: ['Capitol Partners', '200000'] },
  },
  {
    id: 'lda-client-total-apex',
    question:
      'What is the total lobbying spend for client Apex Dynamics across all years and registrants, in dollars?',
    datasets: [ldaDataset()],
    // 60000 + 80000 + 50000 = 190000
    groundTruth: { mustInclude: ['190000'] },
  },
  {
    id: 'lda-yoy-helios',
    question:
      'For client Helios Aerospace, what was the total lobbying spend in 2024 and in 2025, and by how many dollars did it increase year over year?',
    datasets: [ldaDataset()],
    // 2024: 40000 + 30000 = 70000; 2025: 105000; delta = 35000
    groundTruth: { mustInclude: ['70000', '105000', '35000'] },
  },
  // PE budget timeline ———————————————————————————————————————————————————
  {
    id: 'pe-yoy-enacted-0604858a',
    question:
      'For program element 0604858A, what were the enacted amounts (in millions) for FY2025 and FY2026, and what was the percent change between them?',
    datasets: [peDataset()],
    // 150.0 -> 165.0 = +15.0, +10%
    groundTruth: { mustInclude: ['150', '165', '10'] },
  },
  {
    id: 'pe-enacted-above-request',
    question:
      'For program element 0207138F, in which fiscal year did the enacted amount exceed the request, and by how many millions?',
    datasets: [peDataset()],
    // Only FY2025: 336.0 enacted vs 320.0 requested = +16.0
    groundTruth: { mustInclude: ['2025', '16'] },
  },
  {
    id: 'pe-total-enacted-0207138f',
    question:
      'What is the total enacted funding for program element 0207138F across FY2024 through FY2026, in millions?',
    datasets: [peDataset()],
    // 280.0 + 336.0 + 402.5 = 1018.5
    groundTruth: { mustInclude: ['1018.5'] },
  },
  {
    id: 'pe-largest-request-growth',
    question:
      'Which program element had the largest absolute growth in REQUESTED funding from FY2024 to FY2026, and by how many millions did its request grow?',
    datasets: [peDataset()],
    // 0207138F: 410.0 - 300.0 = 110.0 (0604858A grew only 39.5)
    groundTruth: { mustInclude: ['0207138F', '110'] },
  },
  // Federal awards ———————————————————————————————————————————————————————
  {
    id: 'award-largest-single',
    question:
      'What is the largest single federal award in the data (full dollar amount), and which recipient received it?',
    datasets: [awardDataset()],
    // Helios Aerospace / Department of Defense / 4000000
    groundTruth: { mustInclude: ['Helios', '4000000'] },
  },
  {
    id: 'award-avg-by-agency',
    question:
      'Compute the average award size by agency. Which agency has the highest average award, and what is that average in full dollars?',
    datasets: [awardDataset()],
    // DoD: (2500000+1500000+4000000+500000)/4 = 2125000
    // NASA: (3000000+1200000)/2 = 2100000; DoE: (1000000+700000+900000)/3 ≈ 866667
    groundTruth: { mustInclude: ['Defense', '2125000'] },
  },
  {
    id: 'award-total-ks',
    question:
      'What is the total dollar amount of federal awards going to the state of Kansas (KS)?',
    datasets: [awardDataset()],
    // 2500000 + 1500000 + 1000000 = 5000000
    groundTruth: { mustInclude: ['5000000'] },
  },
  {
    id: 'award-count-by-district',
    question:
      'Count the number of federal awards per congressional district. Which district received the most awards, and how many?',
    datasets: [awardDataset()],
    // KS-01: 2, KS-02: 1, MO-04: 3, VA-02: 2, VA-03: 1 → MO-04 with 3
    groundTruth: { mustInclude: ['MO-04', '3'] },
  },
  {
    id: 'award-total-nova',
    question:
      'What is the total dollar amount of federal awards received by Nova Marine across all agencies?',
    datasets: [awardDataset()],
    // 500000 + 1200000 + 900000 = 2600000
    groundTruth: { mustInclude: ['2600000'] },
  },
  // Client facilities ————————————————————————————————————————————————————
  {
    id: 'facility-most-per-district',
    question:
      'Count the facilities per congressional district. Which district contains the most facilities, and how many does it have?',
    datasets: [facilityDataset()],
    // KS-04: 3; every other district has 1
    groundTruth: { mustInclude: ['KS-04', '3'] },
  },
  {
    id: 'facility-ks-employees',
    question:
      'What is the total number of employees across all facilities located in Kansas (KS) districts?',
    datasets: [facilityDataset()],
    // 1200 + 350 + 175 + 450 + 300 + 150 = 2625
    groundTruth: { mustInclude: ['2625'] },
  },
  {
    id: 'facility-mo-avg-employees',
    question:
      'What is the average employee count across the Missouri (MO) facilities?',
    datasets: [facilityDataset()],
    // (600 + 250) / 2 = 425
    groundTruth: { mustInclude: ['425'] },
  },
];

export const ANALYSIS_EVAL_CASE_COUNT = ANALYSIS_EVAL_CASES.length;
