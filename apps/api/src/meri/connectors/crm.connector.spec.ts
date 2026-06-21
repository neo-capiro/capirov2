import { describe, expect, test } from '@jest/globals';
import { MockCrmConnector } from './crm.connector.js';

const seed = {
  contacts: [
    { id: 'c1', name: 'Jane Staffer', email: 'jane@house.gov', accountId: 'a1' },
    { id: 'c2', name: 'Bob Aide', email: 'bob@senate.gov', accountId: 'a2' },
  ],
  opportunities: [
    { id: 'o1', name: 'FY25 approps', stage: 'open', accountId: 'a1' },
    { id: 'o2', name: 'NDAA amendment', stage: 'won', accountId: 'a2' },
  ],
};

describe('MockCrmConnector', () => {
  test('finds contacts by name/email (and returns all on empty query)', async () => {
    const c = new MockCrmConnector(seed);
    expect((await c.findContacts('jane')).map((x) => x.id)).toEqual(['c1']);
    expect((await c.findContacts('senate.gov')).map((x) => x.id)).toEqual(['c2']);
    expect((await c.findContacts('')).length).toBe(2);
  });

  test('lists opportunities, optionally filtered by account', async () => {
    const c = new MockCrmConnector(seed);
    expect((await c.listOpportunities()).length).toBe(2);
    expect((await c.listOpportunities('a1')).map((o) => o.id)).toEqual(['o1']);
  });

  test('logs an activity and returns its id', async () => {
    const c = new MockCrmConnector(seed);
    const { id } = await c.logActivity('c1', 'Met at fly-in');
    expect(id).toBe('act-1');
    expect(c.activities).toHaveLength(1);
    expect(c.status()).toBe('connected');
  });
});
