/**
 * Attachment Q&A eval fixtures (assistant-parity F1).
 *
 * Twenty cases across the attachment surface: text-PDF Q&A (bill text, an
 * LDA-style filing, a J-book excerpt), docx + plain-text Q&A, vision
 * round-trips on generated images, plus the explicit-failure cases (scanned
 * PDF, oversized file, magic-byte spoof). Document CONTENT is defined here so
 * the runner (scripts/eval-clio-attachments.ts) can render the actual files
 * (pdf-lib / docx / generated PNGs) and the graders can substring-match —
 * fixture validity is CI-tested without tokens (attachment-fixtures.spec.ts).
 */

export interface AttachmentDocFixture {
  id: string;
  format: 'pdf' | 'docx' | 'text';
  filename: string;
  /** Lines of document body the runner renders into the file. */
  lines: string[];
  question: string;
  mustInclude: string[];
}

export const BILL_TEXT_LINES = [
  'H. R. 4729 - 119th Congress, 2d Session',
  'A BILL to strengthen the domestic advanced-composites industrial base.',
  'SECTION 1. SHORT TITLE.',
  'This Act may be cited as the Advanced Composites Manufacturing Act of 2026.',
  'SEC. 2. PILOT PROGRAM.',
  'The Secretary of Defense shall establish a pilot program to qualify not fewer',
  'than 12 domestic suppliers of composite airframe structures by fiscal year 2029.',
  'SEC. 3. AUTHORIZATION OF APPROPRIATIONS.',
  'There is authorized to be appropriated $240,000,000 for fiscal years 2027 through 2029.',
];

export const LDA_FILING_LINES = [
  'LOBBYING REPORT - LD-2 Disclosure Form, Quarter 1 2026',
  'Registrant: Capitol Strategies Group LLC',
  'Client Name: Meridian Aerostructures Inc.',
  'Income relating to lobbying activities: $90,000.00',
  'General issue area code: DEF (Defense), AER (Aerospace)',
  'Specific lobbying issues: HR 4729 Advanced Composites Manufacturing Act;',
  'FY27 Defense Appropriations - RDT&E line PE 0604015F;',
  'Houses and agencies contacted: U.S. House, U.S. Senate, Department of Defense.',
  'Lobbyists: Jordan Pike, Alexis Romero.',
];

export const JBOOK_LINES = [
  'Exhibit R-2, RDT&E Budget Item Justification: PB 2027 Air Force',
  'Program Element 0604015F: Advanced Materials and Structures.',
  'FY 2025 Actual: 41.2 million. FY 2026 Enacted: 47.8 million.',
  'FY 2027 Request: 55.3 million.',
  'Mission Description: This program element matures composite airframe',
  'technologies, including thermoplastic structures and automated fiber placement,',
  'and transitions them to bomber and mobility platforms.',
  'Accomplishments FY 2025: completed full-scale fatigue test of a thermoplastic',
  'wing box, 18 months ahead of schedule.',
];

export const MEMO_DOCX_LINES = [
  'MEMORANDUM - Meridian Aerostructures Hill Strategy',
  'From: Capitol Strategies Group. Date: June 2, 2026.',
  'Recommendation: concentrate on the Section 848 pilot program amendment.',
  'The fly-in is the week of May 11; we are targeting 8 member-level meetings.',
  'Our primary champion remains Rep. Dana Whitfield (KS-04) on HASC.',
];

export const NOTES_TEXT_LINES = [
  'Call notes, 2026-06-08, with Theo Brandt (defense LA, Sen. Quist office):',
  'Brandt confirmed the boss is open to leading a colloquy on composites.',
  'He asked for a one-page summary of the carbon-fiber capacity study,',
  'which is due to Congress September 30, 2026.',
  'Follow-up owed: draft colloquy script by Friday.',
];

export const ATTACHMENT_DOC_FIXTURES: AttachmentDocFixture[] = [
  // ── Bill-text PDF (4 probes) ──
  {
    id: 'bill-short-title',
    format: 'pdf',
    filename: 'hr4729.pdf',
    lines: BILL_TEXT_LINES,
    question: 'What is the short title of this bill?',
    mustInclude: ['Advanced Composites Manufacturing Act'],
  },
  {
    id: 'bill-supplier-count',
    format: 'pdf',
    filename: 'hr4729.pdf',
    lines: BILL_TEXT_LINES,
    question: 'How many domestic suppliers must the pilot program qualify, and by when?',
    mustInclude: ['12', '2029'],
  },
  {
    id: 'bill-authorization',
    format: 'pdf',
    filename: 'hr4729.pdf',
    lines: BILL_TEXT_LINES,
    question: 'What dollar amount does the bill authorize to be appropriated?',
    mustInclude: ['240'],
  },
  {
    id: 'bill-secretary',
    format: 'pdf',
    filename: 'hr4729.pdf',
    lines: BILL_TEXT_LINES,
    question: 'Which official is directed to establish the pilot program?',
    mustInclude: ['Secretary of Defense'],
  },
  // ── LDA filing PDF (4 probes) ──
  {
    id: 'lda-client',
    format: 'pdf',
    filename: 'ld2-q1-2026.pdf',
    lines: LDA_FILING_LINES,
    question: 'Who is the client on this lobbying report?',
    mustInclude: ['Meridian Aerostructures'],
  },
  {
    id: 'lda-income',
    format: 'pdf',
    filename: 'ld2-q1-2026.pdf',
    lines: LDA_FILING_LINES,
    question: 'What lobbying income does this report disclose?',
    mustInclude: ['90,000'],
  },
  {
    id: 'lda-issue-codes',
    format: 'pdf',
    filename: 'ld2-q1-2026.pdf',
    lines: LDA_FILING_LINES,
    question: 'Which general issue area codes are listed?',
    mustInclude: ['DEF', 'AER'],
  },
  {
    id: 'lda-lobbyists',
    format: 'pdf',
    filename: 'ld2-q1-2026.pdf',
    lines: LDA_FILING_LINES,
    question: 'Name the lobbyists listed on the filing.',
    mustInclude: ['Pike', 'Romero'],
  },
  // ── J-book PDF (4 probes) ──
  {
    id: 'jbook-pe',
    format: 'pdf',
    filename: 'r2-0604015F.pdf',
    lines: JBOOK_LINES,
    question: 'Which program element is this budget exhibit for?',
    mustInclude: ['0604015F'],
  },
  {
    id: 'jbook-fy27',
    format: 'pdf',
    filename: 'r2-0604015F.pdf',
    lines: JBOOK_LINES,
    question: 'What is the FY 2027 request in this exhibit?',
    mustInclude: ['55.3'],
  },
  {
    id: 'jbook-trend',
    format: 'pdf',
    filename: 'r2-0604015F.pdf',
    lines: JBOOK_LINES,
    question: 'Did funding grow or shrink from FY 2025 actual to the FY 2027 request? Give both numbers.',
    mustInclude: ['41.2', '55.3'],
  },
  {
    id: 'jbook-accomplishment',
    format: 'pdf',
    filename: 'r2-0604015F.pdf',
    lines: JBOOK_LINES,
    question: 'What did the program accomplish in FY 2025 and how far ahead of schedule?',
    mustInclude: ['wing box', '18 months'],
  },
  // ── docx memo (2 probes) ──
  {
    id: 'memo-amendment',
    format: 'docx',
    filename: 'hill-strategy.docx',
    lines: MEMO_DOCX_LINES,
    question: 'Which amendment does the memo recommend concentrating on?',
    mustInclude: ['848'],
  },
  {
    id: 'memo-champion',
    format: 'docx',
    filename: 'hill-strategy.docx',
    lines: MEMO_DOCX_LINES,
    question: 'Who is named as the primary champion in the memo?',
    mustInclude: ['Whitfield'],
  },
  // ── plain text notes (2 probes) ──
  {
    id: 'notes-colloquy',
    format: 'text',
    filename: 'call-notes.txt',
    lines: NOTES_TEXT_LINES,
    question: 'What did Theo Brandt confirm the senator is open to?',
    mustInclude: ['colloquy'],
  },
  {
    id: 'notes-deadline',
    format: 'text',
    filename: 'call-notes.txt',
    lines: NOTES_TEXT_LINES,
    question: 'When is the carbon-fiber capacity study due to Congress?',
    mustInclude: ['September 30'],
  },
];

/** Vision round-trip cases. The runner renders deterministic PNGs. */
export interface AttachmentImageFixture {
  id: string;
  filename: string;
  /** What the runner draws (see renderEvalPng in the runner). */
  scene: 'three-bars' | 'red-circle' | 'two-by-two-grid';
  question: string;
  mustInclude: string[];
}

export const ATTACHMENT_IMAGE_FIXTURES: AttachmentImageFixture[] = [
  {
    id: 'image-bars',
    filename: 'chart.png',
    scene: 'three-bars',
    question:
      'This is a simple bar chart with three vertical bars. Which bar is the tallest: the left, middle, or right one? Answer with one word.',
    mustInclude: ['right'],
  },
  {
    id: 'image-circle',
    filename: 'shape.png',
    scene: 'red-circle',
    question: 'What shape is drawn in this image, and what color is it?',
    mustInclude: ['circle', 'red'],
  },
  {
    id: 'image-grid',
    filename: 'grid.png',
    scene: 'two-by-two-grid',
    question:
      'This image is a 2x2 grid of colored squares. What color is the top-left square?',
    mustInclude: ['blue'],
  },
];

/** Explicit-failure cases: must produce a visible status + reason, never a silent drop. */
export interface AttachmentFailureFixture {
  id: string;
  scenario: 'scanned-pdf' | 'oversized' | 'html-spoofed-pdf';
  expectStatus: 'scanned' | 'unsupported';
}

export const ATTACHMENT_FAILURE_FIXTURES: AttachmentFailureFixture[] = [
  { id: 'scanned-pdf', scenario: 'scanned-pdf', expectStatus: 'scanned' },
  { id: 'oversized-file', scenario: 'oversized', expectStatus: 'unsupported' },
  { id: 'html-spoof', scenario: 'html-spoofed-pdf', expectStatus: 'unsupported' },
];

export const ATTACHMENT_EVAL_CASE_COUNT =
  ATTACHMENT_DOC_FIXTURES.length +
  ATTACHMENT_IMAGE_FIXTURES.length +
  ATTACHMENT_FAILURE_FIXTURES.length;
