import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Phase 3 of the client→data association overhaul: the prepopulation cascade.
 *
 * Given a client's CONFIRMED LDA mappings, this:
 *   - syncs clients.lda_client_ids (the denormalized id cache the read path joins on),
 *   - unions LDA-derived issue codes into clients.issue_codes (drives bill/reg matching),
 *   - fills description when empty (never clobbers a user-entered one),
 *   - stamps derived signals (spend, latest year, # lobbying firms) under
 *     intakeData.ldaSignals.
 *
 * Idempotent: it recomputes everything from the current confirmed set, so it is
 * safe to call after import, after resolve-on-create, or after a manual confirm/
 * un-confirm. Merge/fill-empty policy — it never overwrites user-entered values.
 * client_intel_mapping is not RLS-scoped (read direct); the clients write goes
 * through withTenant.
 */
@Injectable()
export class ClientPrepopulationService {
  private readonly logger = new Logger(ClientPrepopulationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async prepopulate(
    tenantId: string,
    clientId: string,
  ): Promise<{ ldaClientIds: number[]; issueCodesAdded: number }> {
    // 1. Confirmed LDA ids for this client (client_intel_mapping has no RLS).
    const confirmed = await this.prisma.clientIntelMapping.findMany({
      where: { clientId, source: 'lda', confirmed: true },
      select: { externalId: true },
    });
    const ldaClientIds = Array.from(
      new Set(confirmed.map((m) => Number(m.externalId)).filter((n) => Number.isInteger(n))),
    );

    // 2. Aggregate LDA-derived fields across the confirmed id set.
    let ldaIssueCodes: string[] = [];
    let description: string | null = null;
    let totalSpend = 0;
    let latestFilingYear: number | null = null;
    let lobbyingFirms = 0;

    if (ldaClientIds.length > 0) {
      const ldaClients = await this.prisma.ldaClient.findMany({
        where: { id: { in: ldaClientIds } },
        select: {
          generalDescription: true,
          issueCodes: true,
          totalSpending: true,
          latestFilingYear: true,
        },
      });
      const codes = new Set<string>();
      for (const c of ldaClients) {
        for (const code of c.issueCodes ?? []) if (code) codes.add(code.toUpperCase());
        if (!description && c.generalDescription) description = c.generalDescription;
        if (c.latestFilingYear && (latestFilingYear == null || c.latestFilingYear > latestFilingYear)) {
          latestFilingYear = c.latestFilingYear;
        }
        totalSpend += Number(c.totalSpending ?? 0);
      }
      ldaIssueCodes = Array.from(codes);

      const firmRows = await this.prisma.ldaFiling.findMany({
        where: { clientId: { in: ldaClientIds }, registrantId: { not: null } },
        select: { registrantId: true },
        distinct: ['registrantId'],
      });
      lobbyingFirms = firmRows.length;
    }

    // 3. Merge-write under tenant scope. Never clobber user-entered values.
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({
        where: { id: clientId },
        select: { issueCodes: true, description: true, intakeData: true },
      });
      if (!client) return { issueCodesAdded: 0 };

      const before = client.issueCodes ?? [];
      const mergedIssueCodes = Array.from(new Set([...before, ...ldaIssueCodes]));
      const intake = (client.intakeData ?? {}) as Record<string, unknown>;
      const ldaSignals =
        ldaClientIds.length > 0
          ? {
              ldaClientIds,
              totalSpend,
              latestFilingYear,
              lobbyingFirms,
              refreshedAt: new Date().toISOString(),
            }
          : null;

      await tx.client.update({
        where: { id: clientId },
        data: {
          ldaClientIds,
          issueCodes: mergedIssueCodes,
          // Fill description only when the client has none (don't overwrite edits).
          ...(!client.description && description ? { description } : {}),
          intakeData: { ...intake, ...(ldaSignals ? { ldaSignals } : {}) } as object,
        },
      });
      return { issueCodesAdded: mergedIssueCodes.length - before.length };
    });

    return { ldaClientIds, issueCodesAdded: result.issueCodesAdded };
  }

  /**
   * Backfill helper: prepopulate every client in a tenant from its confirmed LDA
   * mappings. Used after a bulk resolution pass (the existing-client migration).
   */
  async prepopulateAllForTenant(tenantId: string): Promise<{ clients: number }> {
    const clients = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findMany({ select: { id: true } }),
    );
    for (const c of clients) {
      try {
        await this.prepopulate(tenantId, c.id);
      } catch (e) {
        this.logger.warn(
          `prepopulate(${c.id}) failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { clients: clients.length };
  }
}
