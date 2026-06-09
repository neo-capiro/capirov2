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

  async prepopulate(tenantId: string, clientId: string): Promise<{ ldaClientIds: number[] }> {
    // 1. Confirmed LDA ids for this client. client_intel_mapping now carries
    //    tenant_id + forced RLS, so this read is tenant-scoped (a foreign clientId
    //    yields nothing).
    const confirmed = await this.prisma.withTenant(tenantId, (tx) =>
      tx.clientIntelMapping.findMany({
        where: { clientId, source: 'lda', confirmed: true },
        select: { externalId: true },
      }),
    );
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

    // 3. Atomic, race-free write under tenant scope (RLS confines the UPDATE to
    //    this tenant's row; a wrong-tenant clientId simply matches 0 rows). A single
    //    statement that references the CURRENT column values, so it cannot lose a
    //    concurrent prepopulate or user edit:
    //      - lda_client_ids is recomputed IN-SQL from the confirmed mappings (the
    //        read path joins on this column — must reflect the latest confirmed set);
    //      - issue_codes UNIONs the LDA codes with whatever is stored now (a
    //        concurrent user edit is preserved, never clobbered);
    //      - description is filled only when empty;
    //      - ldaSignals is written via targeted jsonb_set (preserving other
    //        intakeData keys) and REMOVED when the confirmed set is empty.
    const signalsJson =
      ldaClientIds.length > 0
        ? JSON.stringify({
            ldaClientIds,
            totalSpend,
            latestFilingYear,
            lobbyingFirms,
            refreshedAt: new Date().toISOString(),
          })
        : null;
    const ldaCodesJson = JSON.stringify(ldaIssueCodes);

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE clients SET
           lda_client_ids = (
             SELECT coalesce(array_agg(DISTINCT m.external_id::int), '{}')
             FROM client_intel_mapping m
             WHERE m.client_id = $1::uuid AND m.source = 'lda' AND m.confirmed = true
               AND m.external_id ~ '^[0-9]+$'
           ),
           issue_codes = (
             SELECT array(
               SELECT DISTINCT e
               FROM unnest(issue_codes || ARRAY(SELECT jsonb_array_elements_text($2::jsonb))) AS e
               WHERE e <> ''
             )
           ),
           description = CASE
             WHEN (description IS NULL OR description = '') AND $3::text IS NOT NULL THEN $3::text
             ELSE description END,
           intake_data_jsonb = CASE
             WHEN $4::jsonb IS NULL THEN (coalesce(intake_data_jsonb, '{}'::jsonb) - 'ldaSignals')
             ELSE jsonb_set(coalesce(intake_data_jsonb, '{}'::jsonb), '{ldaSignals}', $4::jsonb) END,
           updated_at = now()
         WHERE id = $1::uuid`,
        clientId,
        ldaCodesJson,
        description,
        signalsJson,
      ),
    );

    return { ldaClientIds };
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
