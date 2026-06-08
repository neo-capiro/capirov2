import { describe, expect, test } from '@jest/globals';
import {
  classifyProvisionAction,
  type ProvisionActionType,
} from './provision-action-classifier.js';

/**
 * Table-driven cases. Each TRUE example is realistic committee-report phrasing and is
 * crafted so the FIRST matching rule (priority order) is the expected one — e.g. the
 * "cuts" example does not also contain a transfer/realign word.
 */
const TRUE_CASES: ReadonlyArray<{ type: ProvisionActionType; text: string }> = [
  {
    type: 'directs_briefing',
    text: 'The committee directs the Secretary of the Air Force to provide a briefing to the congressional defense committees not later than March 1, 2027.',
  },
  {
    type: 'directs_briefing',
    text: 'The Director shall brief the committee on the program of record by the end of the fiscal year.',
  },
  {
    type: 'directs_report',
    text: 'The committee directs the Secretary to submit a report to the congressional committees on the disposition of legacy systems.',
  },
  {
    type: 'directs_report',
    text: 'The Secretary shall report on cost growth in the program no later than 90 days after enactment of this Act.',
  },
  {
    type: 'adds',
    text: 'The committee recommends an increase of $25.0 million for the hypersonic test infrastructure account.',
  },
  {
    type: 'adds',
    text: 'The committee provides an additional $12,000,000 above the budget request for this program element.',
  },
  {
    type: 'cuts',
    text: 'The committee recommends a reduction of $40.0 million due to unjustified cost growth in the request.',
  },
  {
    type: 'cuts',
    text: 'The committee directs the department to descope the prototype effort given schedule slips.',
  },
  {
    type: 'transfers',
    text: 'The committee directs the transfer of $15.0 million from this line to the operations and maintenance account.',
  },
  {
    type: 'transfers',
    text: 'The committee recommends a realignment of resources within the research, development, test, and evaluation account.',
  },
  {
    type: 'restricts',
    text: 'None of the funds authorized to be appropriated by this Act may be obligated to retire the platform until the certification is delivered.',
  },
  {
    type: 'restricts',
    text: 'The committee includes a limitation on the obligation of funds pending submission of the required acquisition strategy.',
  },
  {
    type: 'encourages',
    text: 'The committee encourages the Secretary to accelerate fielding of the capability to the operational force.',
  },
  {
    type: 'encourages',
    text: 'The committee urges the department to prioritize open-architecture standards in future increments.',
  },
  {
    type: 'expresses_concern',
    text: 'The committee is concerned by the persistent schedule delays affecting the program and its impact on readiness.',
  },
  {
    type: 'expresses_concern',
    text: 'The committee remains concerned about the lack of competition in the propulsion supply base.',
  },
];

/**
 * Strings that MUST classify as null — generic descriptive narrative with none of the
 * trigger phrases, or budget-table-style prose that merely states a number without an
 * add/cut/transfer verb.
 */
const NULL_CASES: ReadonlyArray<string> = [
  'The program element funds development of the next-generation sensor suite.',
  'This program supports the modernization of the fleet across the future years defense program.',
  'The budget request for this program element is $310.5 million in fiscal year 2027.',
  'The Air Force is the lead component for this acquisition effort.',
  'The capability achieved initial operational capability in the prior fiscal year.',
  '',
];

describe('classifyProvisionAction — TRUE cases (one+ per action type)', () => {
  test.each(TRUE_CASES)('classifies $type', ({ type, text }) => {
    expect(classifyProvisionAction(text)).toBe(type);
  });
});

describe('classifyProvisionAction — AMBIGUOUS cases return null', () => {
  test.each(NULL_CASES)('returns null for: %s', (text) => {
    expect(classifyProvisionAction(text)).toBeNull();
  });
});

describe('classifyProvisionAction — no false directs_*', () => {
  test('plain narrative sentences never classify as a directive', () => {
    for (const text of NULL_CASES) {
      const result = classifyProvisionAction(text);
      expect(result).not.toBe('directs_briefing');
      expect(result).not.toBe('directs_report');
    }
  });

  test('a descriptive sentence that merely mentions "report" without a directive verb is not directs_report', () => {
    // No (submit|provide|deliver)...report, no "report to the committees", no "shall report".
    expect(
      classifyProvisionAction('The annual report describes the status of the program.'),
    ).not.toBe('directs_report');
  });

  test('coverage: every action type has at least one TRUE case', () => {
    const covered = new Set(TRUE_CASES.map((c) => c.type));
    const all: ProvisionActionType[] = [
      'directs_briefing',
      'directs_report',
      'adds',
      'cuts',
      'transfers',
      'restricts',
      'encourages',
      'expresses_concern',
    ];
    for (const t of all) expect(covered.has(t)).toBe(true);
  });
});
