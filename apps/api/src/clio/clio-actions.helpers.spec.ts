import { describe, expect, test } from '@jest/globals';
import { actionVerb, classifyToolAction, isSideEffectingTool } from './clio-actions.helpers.js';

describe('classifyToolAction', () => {
  test('send tools', () => {
    expect(classifyToolAction('send_email')).toBe('send');
    expect(classifyToolAction('reply_email')).toBe('send');
  });
  test('write tools', () => {
    for (const t of ['save_note', 'save_memory', 'draft_policy_memo', 'create_meeting_brief']) {
      expect(classifyToolAction(t)).toBe('write');
    }
  });
  test('read tools (default)', () => {
    for (const t of [
      'search_congress_bills',
      'query_intelligence',
      'get_client_context',
      'unknown_tool',
    ]) {
      expect(classifyToolAction(t)).toBe('read');
    }
  });
});

describe('isSideEffectingTool', () => {
  test('write + send are side-effecting; read is not', () => {
    expect(isSideEffectingTool('send_email')).toBe(true);
    expect(isSideEffectingTool('save_note')).toBe(true);
    expect(isSideEffectingTool('search_congress_bills')).toBe(false);
  });
});

describe('actionVerb', () => {
  test('known + unknown', () => {
    expect(actionVerb('send_email')).toBe('sent an email');
    expect(actionVerb('save_note')).toBe('saved a note');
    expect(actionVerb('mystery_tool')).toBe('ran mystery_tool');
  });
});
