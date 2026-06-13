// Locks the Generate & Review entity model: per-entity draft slots
// (individual = 1, list = 1 per member, group = 1 shared) and the send
// projection that fans a group's shared draft to every member.

import { describe, expect, it } from 'vitest';
import { buildGenerationModel, listAidFromKey, projectDraftsForSend } from './generation.js';
import type { OutreachTarget } from './targets.js';
import type { OutreachRecipient } from '../../OutreachView.js';

const rec = (email: string): OutreachRecipient => ({ email });

const individual = (email: string): OutreachTarget => ({
  key: `t-${email}`,
  type: 'individual',
  recipients: [rec(email)],
  cc: [],
  bcc: [],
});
const list = (key: string, audienceId: string | undefined, emails: string[]): OutreachTarget => ({
  key,
  type: 'list',
  audienceId,
  name: 'L',
  recipients: emails.map(rec),
  cc: [],
  bcc: [],
});
const group = (key: string, audienceId: string | undefined, emails: string[]): OutreachTarget => ({
  key,
  type: 'group',
  audienceId,
  name: 'G',
  recipients: emails.map(rec),
  cc: [],
  bcc: [],
});

const mix: OutreachTarget[] = [
  individual('a@x.com'),
  list('L1', 'aud1', ['b@x.com', 'c@x.com']),
  group('G1', 'aud2', ['d@x.com', 'e@x.com']),
];

describe('buildGenerationModel', () => {
  it('emits one slot per individual, one per list member, one per group', () => {
    const { entities, slots } = buildGenerationModel(mix);
    expect(entities).toHaveLength(3);
    expect(slots.map((s) => s.genKey)).toEqual([
      'individual:a@x.com',
      'list:aud1:b@x.com',
      'list:aud1:c@x.com',
      'group:aud2',
    ]);
  });

  it('a group slot generates from ONE representative and carries the member listing', () => {
    const { slots } = buildGenerationModel(mix);
    const groupSlot = slots.find((s) => s.genKey === 'group:aud2')!;
    expect(groupSlot.appliesTo).toBe('group');
    expect(groupSlot.genRecipients).toHaveLength(1);
    expect(groupSlot.additionalContext).toContain('d@x.com');
    expect(groupSlot.additionalContext).toContain('e@x.com');
  });

  it('falls back to the target key when a list/group has no saved audienceId', () => {
    const { slots } = buildGenerationModel([group('tkey', undefined, ['z@x.com'])]);
    expect(slots[0]!.genKey).toBe('group:tkey');
  });
});

describe('projectDraftsForSend', () => {
  const generated = {
    'individual:a@x.com': { subject: 'SA', body: 'BA', status: 'ready' },
    'list:aud1:b@x.com': { subject: 'SB', body: 'BB', status: 'ready' },
    'list:aud1:c@x.com': { subject: 'SC', body: 'BC', status: 'ready' },
    'group:aud2': { subject: 'SG', body: 'BG', status: 'ready' },
  };

  it('one draft per recipient; the group shared draft fans to every member', () => {
    const drafts = projectDraftsForSend(mix, generated);
    expect(drafts).toHaveLength(5);
    const byId = Object.fromEntries(drafts.map((d) => [d.recipientId, d]));
    expect(byId['a@x.com']!.subject).toBe('SA');
    expect(byId['b@x.com']!.subject).toBe('SB');
    expect(byId['d@x.com']!.subject).toBe('SG');
    expect(byId['e@x.com']!.body).toBe('BG');
  });

  it('skips drafts with no subject and no body', () => {
    const drafts = projectDraftsForSend([individual('a@x.com')], {
      'individual:a@x.com': { subject: '  ', body: '', status: 'ready' },
    });
    expect(drafts).toHaveLength(0);
  });

  it('a group claims its members before an overlapping individual/list (groups-first)', () => {
    const dup = 'shared@x.com';
    const targets = [individual(dup), group('G9', 'aud9', [dup, 'other@x.com'])];
    const gen = {
      'individual:shared@x.com': { subject: 'IND', body: 'IND', status: 'ready' },
      'group:aud9': { subject: 'GRP', body: 'GRP', status: 'ready' },
    };
    const byId = Object.fromEntries(
      projectDraftsForSend(targets, gen).map((d) => [d.recipientId, d]),
    );
    expect(byId['shared@x.com']!.subject).toBe('GRP');
  });
});

describe('listAidFromKey', () => {
  it('extracts the colon-free audience id even when the recipientKey contains colons', () => {
    expect(listAidFromKey('list:aud1:clientperson:abc')).toBe('aud1');
  });
  it('returns null for non-list keys', () => {
    expect(listAidFromKey('group:aud2')).toBeNull();
    expect(listAidFromKey('individual:x')).toBeNull();
  });
});
