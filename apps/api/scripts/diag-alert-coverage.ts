/**
 * Read-only diagnostic: why are only "comment" alerts showing on the dashboard
 * / inbox / client Intelligence tab?
 *
 * Each compute-on-read alert category has a hard precondition. This prints the
 * coverage of those preconditions across the tenant so we can see exactly which
 * categories are gated by missing data (vs a bug):
 *   - competitor_filing  -> needs a CONFIRMED lda mapping (issue codes)
 *   - contract_award     -> needs a CONFIRMED contracting mapping + recent award
 *   - hearing / bill_movement -> needs tracked bills
 *   - comment_deadline/overdue -> only needs a sector/keyword FedReg match (broad)
 *
 * SAFE: only COUNT()/findMany(select) reads. No writes. Exits non-zero on error.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const now = Date.now();
  const since30 = new Date(now - 30 * 864e5);
  const since90 = new Date(now - 90 * 864e5);

  const [
    clients,
    ldaConfirmed,
    ldaCandidates,
    contractingConfirmed,
    contractingCandidates,
    awards30d,
    awardsTotal,
    hearingsUpcoming,
    ldaFilings90d,
  ] = await Promise.all([
    prisma.client.count({ where: { status: { not: 'archived' } } }),
    prisma.clientIntelMapping.count({ where: { source: 'lda', confirmed: true } }),
    prisma.clientIntelMapping.count({ where: { source: 'lda', confirmed: false } }),
    prisma.clientIntelMapping.count({ where: { source: 'contracting', confirmed: true } }),
    prisma.clientIntelMapping.count({ where: { source: 'contracting', confirmed: false } }),
    prisma.federalAward.count({ where: { awardedAt: { gte: since30 } } }),
    prisma.federalAward.count(),
    prisma.committeeHearing.count({ where: { date: { gte: new Date() } } }),
    prisma.ldaFiling.count({ where: { dtPosted: { gte: since90 } } }),
  ]);

  // Distinct clients with at least one confirmed mapping of each source.
  const confirmedLda = await prisma.clientIntelMapping.findMany({
    where: { source: 'lda', confirmed: true },
    select: { clientId: true },
    distinct: ['clientId'],
  });
  const confirmedContracting = await prisma.clientIntelMapping.findMany({
    where: { source: 'contracting', confirmed: true },
    select: { clientId: true },
    distinct: ['clientId'],
  });

  const result = {
    activeClients: clients,
    // Competitor-filing gate
    ldaMappings: { confirmed: ldaConfirmed, candidatesAwaitingConfirm: ldaCandidates },
    clientsWithConfirmedLda: confirmedLda.length,
    ldaFilings_last90d: ldaFilings90d,
    // Contract-award gate
    contractingMappings: { confirmed: contractingConfirmed, candidatesAwaitingConfirm: contractingCandidates },
    clientsWithConfirmedContracting: confirmedContracting.length,
    federalAwards: { last30d: awards30d, total: awardsTotal },
    // Hearing/bill-movement gate
    hearingsUpcoming,
  };

  console.log('DIAG_RESULT ' + JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error('DIAG_ERR', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
