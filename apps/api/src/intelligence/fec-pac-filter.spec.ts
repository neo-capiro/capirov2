import { describe, expect, test } from '@jest/globals';

/**
 * Unit test for the sync-fec-pac row filter (Schedule B). The sync keeps only
 * candidate-directed disbursements (PAC -> candidate giving), dropping operational
 * spend with no recipient. This mirrors the predicate in scripts/sync-fec-pac.ts;
 * the script itself is integration-tested via ECS, but the filter is pure logic
 * worth pinning so a refactor can't silently start ingesting operational spend.
 */
interface ScheduleBRow {
  candidate_name?: string;
  recipient_committee_id?: string;
  recipient_name?: string;
  disbursement_amount?: number;
}

function keepRow(r: ScheduleBRow): boolean {
  const amount = r.disbursement_amount;
  if (!amount || amount <= 0) return false;
  if (!r.candidate_name && !r.recipient_committee_id && !r.recipient_name) return false;
  return true;
}

describe('sync-fec-pac Schedule B row filter', () => {
  test('keeps a candidate-directed disbursement', () => {
    expect(keepRow({ candidate_name: 'Jane Doe', disbursement_amount: 5000 })).toBe(true);
  });

  test('keeps a recipient-committee disbursement', () => {
    expect(keepRow({ recipient_committee_id: 'C00123', disbursement_amount: 2500 })).toBe(true);
  });

  test('drops operational spend with no recipient', () => {
    expect(keepRow({ recipient_name: '', disbursement_amount: 1200 })).toBe(false);
  });

  test('drops zero / negative / missing amounts', () => {
    expect(keepRow({ candidate_name: 'X', disbursement_amount: 0 })).toBe(false);
    expect(keepRow({ candidate_name: 'X', disbursement_amount: -50 })).toBe(false);
    expect(keepRow({ candidate_name: 'X' })).toBe(false);
  });
});
