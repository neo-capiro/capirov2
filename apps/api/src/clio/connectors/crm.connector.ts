/**
 * CRM connector (P3-2): read contacts + opportunities and log activities in an
 * external CRM (Salesforce / HubSpot) so Clio can ground on relationship data
 * and record outreach.
 *
 * Provider interface + in-memory mock; a live provider (with the shared OAuth
 * core in connector.types) drops in once which-CRM + credentials are chosen.
 */
import type { ConnectorStatus } from './connector.types.js';

export interface CrmContact {
  id: string;
  name: string;
  email?: string;
  title?: string;
  accountId?: string;
}

export interface CrmOpportunity {
  id: string;
  name: string;
  stage: string;
  amount?: number;
  closeDate?: string;
  accountId?: string;
}

export interface CrmConnector {
  readonly provider: string;
  status(): ConnectorStatus;
  findContacts(query: string): Promise<CrmContact[]>;
  listOpportunities(accountId?: string): Promise<CrmOpportunity[]>;
  /** Write a touchpoint (call/meeting/email) — gated by P2-5 confirmation/audit when wired. */
  logActivity(contactId: string, note: string): Promise<{ id: string }>;
}

export class MockCrmConnector implements CrmConnector {
  readonly provider = 'mock';
  private readonly contacts: CrmContact[];
  private readonly opportunities: CrmOpportunity[];
  readonly activities: Array<{ id: string; contactId: string; note: string }> = [];

  constructor(seed: { contacts?: CrmContact[]; opportunities?: CrmOpportunity[] } = {}) {
    this.contacts = seed.contacts ?? [];
    this.opportunities = seed.opportunities ?? [];
  }

  status(): ConnectorStatus {
    return 'connected';
  }

  async findContacts(query: string): Promise<CrmContact[]> {
    const q = query.trim().toLowerCase();
    if (!q) return this.contacts;
    return this.contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
    );
  }

  async listOpportunities(accountId?: string): Promise<CrmOpportunity[]> {
    return accountId
      ? this.opportunities.filter((o) => o.accountId === accountId)
      : this.opportunities;
  }

  async logActivity(contactId: string, note: string): Promise<{ id: string }> {
    const id = `act-${this.activities.length + 1}`;
    this.activities.push({ id, contactId, note });
    return { id };
  }
}
