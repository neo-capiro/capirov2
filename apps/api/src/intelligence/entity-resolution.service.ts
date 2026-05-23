import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface MatchRow {
  external_id: string;
  external_name: string;
  similarity: number;
}

interface ResolvedMatch {
  source: string;
  externalId: string;
  externalName: string;
  confidence: number;
}

export interface ResolutionSummary {
  total_clients: number;
  mappings_created: number;
  auto_confirmed: number;
  needs_review: number;
}

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveAllForTenant(tenantId: string): Promise<ResolutionSummary> {
    const clients = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findMany({ select: { id: true, name: true } }),
    );

    let mappings_created = 0;
    let auto_confirmed = 0;
    let needs_review = 0;

    for (const client of clients) {
      const matches = await this.matchClient(client.name);
      for (const match of matches) {
        const confirmed = match.confidence >= 0.85;
        await this.prisma.clientIntelMapping.upsert({
          where: {
            clientId_source_externalId: {
              clientId: client.id,
              source: match.source,
              externalId: match.externalId,
            },
          },
          update: {
            externalName: match.externalName,
            confidence: match.confidence,
            ...(confirmed ? { confirmed: true } : {}),
          },
          create: {
            clientId: client.id,
            source: match.source,
            externalId: match.externalId,
            externalName: match.externalName,
            confidence: match.confidence,
            confirmed,
          },
        });
        mappings_created++;
        if (confirmed) auto_confirmed++;
        else needs_review++;
      }
    }

    this.logger.log(
      `resolveAllForTenant(${tenantId}): ${clients.length} clients, ${mappings_created} mappings, ${auto_confirmed} auto-confirmed`,
    );

    return { total_clients: clients.length, mappings_created, auto_confirmed, needs_review };
  }

  private async matchClient(clientName: string): Promise<ResolvedMatch[]> {
    const [ldaRows, contractorRows, secRows, fecRows, faraRows] = await Promise.all([
      this.matchLda(clientName),
      this.matchContractor(clientName),
      this.matchSec(clientName),
      this.matchFec(clientName),
      this.matchFara(clientName),
    ]);

    return [
      ...ldaRows.map((r) => ({ source: 'lda', externalId: String(r.external_id), externalName: r.external_name, confidence: r.similarity })),
      ...contractorRows.map((r) => ({ source: 'contracting', externalId: r.external_id, externalName: r.external_name, confidence: r.similarity })),
      ...secRows.map((r) => ({ source: 'sec', externalId: r.external_id, externalName: r.external_name, confidence: r.similarity })),
      ...fecRows.map((r) => ({ source: 'fec_employer', externalId: r.external_id, externalName: r.external_name, confidence: r.similarity })),
      ...faraRows.map((r) => ({ source: 'fara', externalId: r.external_id, externalName: r.external_name, confidence: r.similarity })),
    ];
  }

  private matchLda(clientName: string) {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT id::text AS external_id, name AS external_name,
             similarity(name, ${clientName}) AS similarity
      FROM lda_client
      WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 3
    `;
  }

  private matchContractor(clientName: string) {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT id::text AS external_id, name AS external_name,
             similarity(name, ${clientName}) AS similarity
      FROM federal_contractor
      WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 3
    `;
  }

  private matchSec(clientName: string) {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT DISTINCT cik AS external_id, company_name AS external_name,
             similarity(company_name, ${clientName}) AS similarity
      FROM sec_filing
      WHERE similarity(company_name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 3
    `;
  }

  private matchFec(clientName: string) {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT contributor_employer AS external_id,
             contributor_employer AS external_name,
             similarity(contributor_employer, ${clientName}) AS similarity
      FROM (SELECT DISTINCT contributor_employer FROM fec_contribution WHERE contributor_employer IS NOT NULL) t
      WHERE similarity(contributor_employer, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 3
    `;
  }

  private matchFara(clientName: string) {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT registration_number AS external_id, registrant_name AS external_name,
             similarity(registrant_name, ${clientName}) AS similarity
      FROM fara_registration
      WHERE similarity(registrant_name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 3
    `;
  }
}
