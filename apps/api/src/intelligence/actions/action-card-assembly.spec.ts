import {
  assembleCard,
  type AssembleCardFacts,
} from './action-card-assembly.js';
import type { ActionType } from './action-recommendation.types.js';

function baseFacts(overrides: Partial<AssembleCardFacts> = {}): AssembleCardFacts {
  return {
    actionType: 'protect_funding',
    clientName: 'Acme Defense Systems',
    peCode: '0603270F',
    peTitle: 'Electronic Warfare Development',
    programName: 'EW Development',
    delta: {
      deltaType: 'mark_increase',
      amountFrom: 120.5,
      amountTo: 145.0,
      deltaPct: 20.3,
      assertedFy: 2026,
      stageFrom: 'requested',
      stageTo: 'house_mark',
    },
    relevancePaths: [
      { path: 'capability_pe_direct', evidence: ['client capability names PE 0603270F'] },
    ],
    deadline: '2026-07-15',
    deadlineSource: 'markup_window',
    ...overrides,
  };
}

describe('action-card-assembly (§10 deterministic narrative)', () => {
  test('a protect_funding card for a mark increase reads correctly with $ figures, FY and client name', () => {
    const card = assembleCard(baseFacts());

    // whatChanged carries the objective fact, all from inputs.
    expect(card.whatChanged).toBe(
      'Electronic Warfare Development (PE 0603270F) increased from $120.5M to $145M ' +
        '(+20%) in the house mark position for FY26.',
    );

    // Figures come only from inputs — none invented.
    expect(card.whatChanged).toContain('$120.5M');
    expect(card.whatChanged).toContain('$145M');
    expect(card.whatChanged).toContain('FY26');

    // whyItMatters cites the client + the relevance path evidence.
    expect(card.whyItMatters).toContain('Acme Defense Systems');
    expect(card.whyItMatters).toContain('client capability names PE 0603270F');

    // recommendedAction and title reflect the action type.
    expect(card.issueTitle).toMatch(/Protect/i);
    expect(card.recommendedAction).toContain('FY26');
    expect(card.recommendedAction).toContain('2026-07-15');
    expect(card.suggestedArtifactType).toBe('committee_staff_memo');
  });

  test('renders a decrease correctly', () => {
    const card = assembleCard(
      baseFacts({
        actionType: 'restore_cut',
        delta: {
          deltaType: 'mark_decrease',
          amountFrom: 200,
          amountTo: 150,
          deltaPct: -25,
          assertedFy: 2026,
          stageTo: 'senate_mark',
        },
      }),
    );
    expect(card.whatChanged).toContain('decreased from $200M to $150M');
    expect(card.whatChanged).toContain('(-25%)');
    expect(card.whatChanged).toContain('senate mark');
  });

  test('a deadline-less card says "no known deadline" and never invents a date', () => {
    const card = assembleCard(baseFacts({ deadline: null, deadlineSource: null }));
    expect(card.recommendedAction).toContain('no known deadline');
    expect(card.recommendedAction).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test('only facts appear — the client name and PE are never fabricated', () => {
    const card = assembleCard(
      baseFacts({ clientName: 'Beta Corp', peCode: '0604999N', peTitle: 'Some Program' }),
    );
    expect(card.whatChanged).toContain('Some Program');
    expect(card.whatChanged).toContain('0604999N');
    expect(card.whyItMatters).toContain('Beta Corp');
    expect(card.whatChanged).not.toContain('Acme');
  });

  test('each actionType yields a distinct recommendedAction', () => {
    const types: ActionType[] = [
      'protect_funding',
      'restore_cut',
      'add_report_language',
      'oppose_restriction',
      'district_one_pager',
      'monitor_procurement',
      'client_alert',
      'schedule_outreach',
      'escalate_uncertainty',
      'update_compliance_notes',
    ];
    const actions = types.map((t) => assembleCard(baseFacts({ actionType: t })).recommendedAction);
    expect(new Set(actions).size).toBe(types.length);
  });

  test('escalate_uncertainty instructs not to contact anyone yet', () => {
    const card = assembleCard(baseFacts({ actionType: 'escalate_uncertainty' }));
    expect(card.recommendedAction).toMatch(/do not contact/i);
    expect(card.recommendedAction).toMatch(/confirm the program match/i);
  });

  test('handles a string FY (e.g. "FY2026") and empty relevance paths gracefully', () => {
    const card = assembleCard(
      baseFacts({
        delta: {
          deltaType: 'mark_increase',
          amountFrom: 10,
          amountTo: 12,
          deltaPct: 20,
          assertedFy: 'FY2026',
          stageTo: 'house_mark',
        },
        relevancePaths: [],
      }),
    );
    expect(card.whatChanged).toContain('FY26');
    expect(card.whyItMatters).toContain('Acme Defense Systems');
    expect(card.whyItMatters).toContain('tracked interest');
  });
});
