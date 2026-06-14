// Locks the Cc/Bcc send semantics for SCRUM-120 (Lists & Groups):
//   • entire-list ccContacts/bccContacts copy on EVERY member's email
//   • per-member memberCcContacts/memberBccContacts copy on that one member
//   • a member therefore receives the union of both, deduped
// plus the individual-target case from SCRUM-121.

import { describe, expect, it } from 'vitest';
import { flattenTargets, type CcBccContact, type OutreachTarget } from './targets.js';
import type { OutreachRecipient } from '../../OutreachView.js';

const rec = (name: string, email: string): OutreachRecipient => ({ name, email });
const contact = (name: string, email: string): CcBccContact => ({
  id: `c-${email}`,
  name,
  email,
  source: 'manual',
});

describe('flattenTargets — list Cc/Bcc (SCRUM-120)', () => {
  it('copies entire-list contacts on every member; per-member contacts only on that member', () => {
    // Story example: list of Bob, Dan, Bert. Cc Lia on the entire list, Cc Neo
    // on Dan only → Lia on all three, Dan also gets Neo.
    const listTarget: OutreachTarget = {
      key: 'L1',
      type: 'list',
      name: 'My List',
      recipients: [rec('Bob', 'bob@x.com'), rec('Dan', 'dan@x.com'), rec('Bert', 'bert@x.com')],
      cc: [],
      bcc: [],
      ccContacts: [contact('Lia', 'lia@x.com')],
      memberCcContacts: { 'dan@x.com': [contact('Neo', 'neo@x.com')] },
    };

    const byEmail = new Map(flattenTargets([listTarget]).map((r) => [r.email, r]));

    expect(byEmail.get('bob@x.com')?.cc).toEqual(['lia@x.com']);
    expect(byEmail.get('bert@x.com')?.cc).toEqual(['lia@x.com']);
    expect([...(byEmail.get('dan@x.com')?.cc ?? [])].sort()).toEqual(['lia@x.com', 'neo@x.com']);
  });

  it('supports entire-list Bcc + per-member Bcc independently', () => {
    const listTarget: OutreachTarget = {
      key: 'L2',
      type: 'list',
      name: 'L',
      recipients: [rec('Dan', 'dan@x.com'), rec('Bob', 'bob@x.com')],
      cc: [],
      bcc: [],
      bccContacts: [contact('Lia', 'lia@x.com')],
      memberBccContacts: { 'dan@x.com': [contact('Neo', 'neo@x.com')] },
    };

    const byEmail = new Map(flattenTargets([listTarget]).map((r) => [r.email, r]));
    expect(byEmail.get('bob@x.com')?.bcc).toEqual(['lia@x.com']);
    expect([...(byEmail.get('dan@x.com')?.bcc ?? [])].sort()).toEqual(['lia@x.com', 'neo@x.com']);
  });

  it('dedupes a contact added both to the whole list and to a member', () => {
    const listTarget: OutreachTarget = {
      key: 'L3',
      type: 'list',
      name: 'L',
      recipients: [rec('Dan', 'dan@x.com')],
      cc: [],
      bcc: [],
      ccContacts: [contact('Lia', 'lia@x.com')],
      memberCcContacts: { 'dan@x.com': [contact('Lia', 'LIA@x.com')] },
    };
    const [dan] = flattenTargets([listTarget]);
    expect(dan?.cc).toEqual(['lia@x.com']);
  });

  it('individual target applies its ccContacts to that recipient (SCRUM-121)', () => {
    const t: OutreachTarget = {
      key: 'i1',
      type: 'individual',
      recipients: [rec('A', 'a@x.com')],
      cc: [],
      bcc: [],
      ccContacts: [contact('Lia', 'lia@x.com')],
      bccContacts: [contact('Neo', 'neo@x.com')],
    };
    const [r] = flattenTargets([t]);
    expect(r?.cc).toEqual(['lia@x.com']);
    expect(r?.bcc).toEqual(['neo@x.com']);
  });

  it('member contacts on a non-list target are ignored (lists only)', () => {
    // memberCcContacts only applies to list targets — an individual ignores it.
    const t: OutreachTarget = {
      key: 'i2',
      type: 'individual',
      recipients: [rec('A', 'a@x.com')],
      cc: [],
      bcc: [],
      memberCcContacts: { 'a@x.com': [contact('Neo', 'neo@x.com')] },
    };
    const [r] = flattenTargets([t]);
    expect(r?.cc).toBeUndefined();
  });
});
