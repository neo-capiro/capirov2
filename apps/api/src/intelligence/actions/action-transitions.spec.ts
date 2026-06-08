import {
  ALLOWED_TRANSITIONS,
  validateTransition,
} from './action-transitions.js';

describe('action-transitions (§19 workflow)', () => {
  test('allows the canonical happy-path transitions', () => {
    expect(validateTransition('new', 'triaged').ok).toBe(true);
    expect(validateTransition('triaged', 'assigned').ok).toBe(true);
    expect(validateTransition('assigned', 'drafting').ok).toBe(true);
    expect(validateTransition('drafting', 'ready_for_review').ok).toBe(true);
    expect(validateTransition('ready_for_review', 'sent_to_client').ok).toBe(true);
    expect(validateTransition('sent_to_client', 'outreach_completed').ok).toBe(true);
    expect(validateTransition('outreach_completed', 'monitoring').ok).toBe(true);
    expect(validateTransition('monitoring', 'archived').ok).toBe(true);
  });

  test('allows the ready_for_review -> drafting bounce-back', () => {
    expect(validateTransition('ready_for_review', 'drafting').ok).toBe(true);
  });

  test('rejects transitions not in the allowed map', () => {
    const skip = validateTransition('new', 'assigned');
    expect(skip.ok).toBe(false);
    expect(skip.error).toContain('new -> assigned');

    expect(validateTransition('new', 'sent_to_client').ok).toBe(false);
    expect(validateTransition('triaged', 'drafting').ok).toBe(false);
    expect(validateTransition('monitoring', 'sent_to_client').ok).toBe(false);
  });

  test('archived is terminal', () => {
    expect(ALLOWED_TRANSITIONS.archived).toEqual([]);
    expect(validateTransition('archived', 'monitoring').ok).toBe(false);
    expect(validateTransition('archived', 'triaged').ok).toBe(false);
  });

  test('dismissal requires a non-empty reason', () => {
    const noReason = validateTransition('new', 'dismissed');
    expect(noReason.ok).toBe(false);
    expect(noReason.error).toMatch(/dismissal reason/i);

    expect(validateTransition('new', 'dismissed', { dismissalReason: '   ' }).ok).toBe(
      false,
    );

    expect(
      validateTransition('new', 'dismissed', { dismissalReason: 'duplicate of #12' }).ok,
    ).toBe(true);
  });

  test('dismiss is reachable from every non-terminal state except outreach_completed', () => {
    expect(validateTransition('triaged', 'dismissed', { dismissalReason: 'x' }).ok).toBe(
      true,
    );
    expect(
      validateTransition('monitoring', 'dismissed', { dismissalReason: 'x' }).ok,
    ).toBe(true);
    // outreach_completed has no dismiss edge per §19.
    expect(
      validateTransition('outreach_completed', 'dismissed', { dismissalReason: 'x' }).ok,
    ).toBe(false);
  });

  test('supports the dismissed -> triaged reopen path', () => {
    expect(validateTransition('dismissed', 'triaged').ok).toBe(true);
    // ...but cannot jump straight back to other states.
    expect(validateTransition('dismissed', 'assigned').ok).toBe(false);
  });
});
