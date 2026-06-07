import { IntelligenceService } from './intelligence.service.js';

/**
 * Pins the FEC money-flow bill linkage + window fixes:
 *   • associated bills come from recipient candidates who are themselves bill
 *     sponsors (candidate→sponsor_name), NOT the old FEC-committee-id ↔
 *     congressional-committee-code join that never matched (billCount was always 0);
 *   • the Schedule A flow query is bounded to a rolling window.
 */
describe('IntelligenceService.getFecMoneyFlow — bill linkage + window', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const clientId = '00000000-0000-0000-0000-000000000010';

  const make = () => {
    const sqlCalls: string[] = [];
    const tenantTx = {
      client: { findFirst: jest.fn(async () => ({ id: clientId, name: 'Acme Defense' })) },
    };
    const prisma: any = {
      withTenant: jest.fn(async (_t: string, run: (tx: any) => Promise<any>) => run(tenantTx)),
      clientIntelMapping: {
        // getFecMoneyFlow unions confirmed fec_employer mappings; getPacGiving
        // reads fec_committee mappings (none → tracked:false early return).
        findMany: jest.fn(async (args: any) =>
          args?.where?.source === 'fec_employer' ? [{ externalName: 'ACME DEFENSE INC' }] : [],
        ),
      },
      $queryRaw: jest.fn(async (strings: any) => {
        const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
        sqlCalls.push(sql);
        if (sql.includes('FROM fec_contribution fc')) {
          return [
            {
              committee_id: 'C00123',
              committee_name: 'Smith for Senate',
              candidate_id: 'S001',
              candidate_name: 'Rep. Smith',
              contribution_count: 3,
              total_amount: 15000,
              latest_contribution_date: new Date('2026-01-01'),
            },
          ];
        }
        if (sql.includes('UNNEST') && sql.includes('member_name')) {
          return [{ candidate_name: 'Rep. Smith', member_name: 'Rep. Smith', bill_count: 2 }];
        }
        if (sql.includes('cb.id AS bill_id') && sql.includes('cb.sponsor_name')) {
          return [
            { sponsor_name: 'Rep. Smith', bill_id: '119-hr-1', bill_title: 'Defense Act' },
            { sponsor_name: 'Rep. Smith', bill_id: '119-hr-2', bill_title: 'Cyber Act' },
          ];
        }
        return [];
      }),
    };
    const service = new IntelligenceService(prisma);
    return { service, sqlCalls };
  };

  test('links bills via candidate→sponsor, never via congressional committee codes, and windows the flow', async () => {
    const { service, sqlCalls } = make();
    const result = await service.getFecMoneyFlow(clientId, tenantId);

    expect(result.mappedEmployer).toBe('ACME DEFENSE INC');
    expect(result.summary.committeeCount).toBe(1);
    expect(result.summary.memberCount).toBe(1);
    expect(result.summary.billCount).toBe(2); // was always 0 under the broken join
    expect(result.committees[0]!.bills.map((b) => b.billId).sort()).toEqual([
      '119-hr-1',
      '119-hr-2',
    ]);

    // The broken FEC-id ↔ committee-code join is gone.
    expect(sqlCalls.some((s) => s.includes('congress_bill_committee'))).toBe(false);
    // The Schedule A flow query is date-windowed (no longer unbounded "TTM").
    expect(
      sqlCalls.some(
        (s) => s.includes('FROM fec_contribution fc') && s.includes('contribution_date'),
      ),
    ).toBe(true);
  });
});
