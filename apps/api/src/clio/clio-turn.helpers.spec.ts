import { planTurnRerun, type RerunMessage } from './clio-turn.helpers.js';

const convo: RerunMessage[] = [
  { id: 'u1', role: 'user', body: 'first question' },
  { id: 'a1', role: 'assistant', body: 'first answer' },
  { id: 'u2', role: 'user', body: 'second question' },
  { id: 'a2', role: 'assistant', body: 'second answer' },
];

describe('planTurnRerun', () => {
  it('regenerate: reuses the last user message and drops the trailing assistant turn', () => {
    expect(planTurnRerun(convo, 'regenerate')).toEqual({
      contentToUse: 'second question',
      deleteMessageIds: ['a2'],
      updateUserMessageId: null,
    });
  });

  it('resend: replaces the last user body and drops everything after it', () => {
    expect(planTurnRerun(convo, 'resend', '  second question, revised  ')).toEqual({
      contentToUse: 'second question, revised',
      deleteMessageIds: ['a2'],
      updateUserMessageId: 'u2',
    });
  });

  it('resend with empty edit falls back to the existing last user body', () => {
    expect(planTurnRerun(convo, 'resend', '   ')).toEqual({
      contentToUse: 'second question',
      deleteMessageIds: ['a2'],
      updateUserMessageId: 'u2',
    });
  });

  it('deletes ALL messages after the last user turn (e.g. trailing assistant + tool notes)', () => {
    const trailing: RerunMessage[] = [
      { id: 'u1', role: 'user', body: 'q' },
      { id: 'a1', role: 'assistant', body: 'partial' },
      { id: 'a2', role: 'assistant', body: 'more' },
    ];
    expect(planTurnRerun(trailing, 'regenerate')).toEqual({
      contentToUse: 'q',
      deleteMessageIds: ['a1', 'a2'],
      updateUserMessageId: null,
    });
  });

  it('handles a last-message-is-user case (nothing to delete)', () => {
    const pending: RerunMessage[] = [
      { id: 'a0', role: 'assistant', body: 'hi' },
      { id: 'u1', role: 'user', body: 'q' },
    ];
    expect(planTurnRerun(pending, 'regenerate')).toEqual({
      contentToUse: 'q',
      deleteMessageIds: [],
      updateUserMessageId: null,
    });
  });

  it('returns null when there is no user message', () => {
    expect(planTurnRerun([{ id: 'a1', role: 'assistant', body: 'x' }], 'regenerate')).toBeNull();
    expect(planTurnRerun([], 'resend', 'edit')).toBeNull();
  });
});
