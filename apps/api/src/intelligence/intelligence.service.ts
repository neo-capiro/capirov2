import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build a 360° intelligence profile for a CRM client by fuzzy-matching
   * the client name against all intelligence data sources.
   */
  async getClientProfile(clientId: string, tenantId: string) {
    // 1. Fetch the CRM client
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId },
      include: { capabilities: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    const clientName = client.name;
    const capabilityNames = (client.capabilities ?? []).map(
      (c) => c.name,
    );

    // 2. Fuzzy match against all intelligence sources in parallel
    const [ldaMatch, contractorMatch, lobbyMatch, existingMappings] =
      await Promise.all([
        this.fuzzyMatchLda(clientName),
        this.fuzzyMatchContractor(clientName),
        this.fuzzyMatchLobbyIntel(clientName),
        this.prisma.clientIntelMapping.findMany({ where: { clientId } }),
      ]);

    // 3. Get issue codes from LDA match
    const issueCodes: string[] = ldaMatch?.issueCodes ?? [];

    // 4. Find relevant bills and regulations in parallel
    const [relevantBills, activeRegulations, competitors] = await Promise.all([
      this.findRelevantBills(issueCodes),
      this.findActiveRegulations(issueCodes),
      this.findCompetitors(clientName, issueCodes),
    ]);

    return {
      client: {
        id: client.id,
        name: client.name,
        description: client.description,
        capabilities: capabilityNames,
      },
      lda: ldaMatch ?? {
        matched: false,
        ldaClientId: null,
        confidence: 0,
        totalFilings: 0,
        totalSpending: null,
        issueCodes: [],
        recentFilings: [],
        yearlySpend: [],
      },
      contracting: contractorMatch ?? {
        matched: false,
        contractorName: null,
        totalContracts: null,
        rankByContracts: null,
        noBidTotal: null,
        topAgencies: [],
        yearlySpend: [],
      },
      lobbyIntel: lobbyMatch ?? {
        matched: false,
        trajectory: null,
        growthRate: null,
        totalSpending: null,
      },
      relevantBills,
      activeRegulations,
      competitors,
      aiSummary: null, // Populated by Phase 4
      lastUpdated: new Date().toISOString(),
    };
  }

  /** Fuzzy match client name against LDA clients */
  private async fuzzyMatchLda(clientName: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        name: string;
        total_filings: number;
        total_spending: number | null;
        issue_codes: string[];
        similarity: number;
      }>
    >`
      SELECT c.id, c.name, c.total_filings, c.total_spending, 
             COALESCE(c.issue_codes, '{}') as issue_codes,
             similarity(c.name, ${clientName}) as similarity
      FROM lda_client c
      WHERE similarity(c.name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 1
    `;
    if (!rows.length) return null;

    const match = rows[0]!;
    // Get recent filings
    const filings = await this.prisma.ldaFiling.findMany({
      where: { clientId: match.id },
      orderBy: { dtPosted: 'desc' },
      take: 10,
    });
    // Get yearly spend trend
    const yearlySpend = await this.prisma.$queryRaw<
      Array<{ year: number; amount: number }>
    >`
      SELECT filing_year as year, COALESCE(SUM(income), 0)::float as amount
      FROM lda_filing WHERE client_id = ${match.id}
      GROUP BY filing_year ORDER BY filing_year
    `;

    return {
      matched: true,
      ldaClientId: match.id,
      confidence: match.similarity,
      totalFilings: match.total_filings,
      totalSpending: match.total_spending,
      issueCodes: match.issue_codes,
      recentFilings: filings,
      yearlySpend,
    };
  }

  /** Fuzzy match client name against federal contractors */
  private async fuzzyMatchContractor(clientName: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        total_contracts: number | null;
        rank_by_contracts: number | null;
        no_bid_total: number | null;
        yearly_spend: object[];
        top_agencies: object[];
        similarity: number;
      }>
    >`
      SELECT id, name, total_contracts, rank_by_contracts, no_bid_total,
             COALESCE(yearly_spend, '[]')::jsonb as yearly_spend,
             COALESCE(top_agencies, '[]')::jsonb as top_agencies,
             similarity(name, ${clientName}) as similarity
      FROM federal_contractor
      WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 1
    `;
    if (!rows.length) return null;

    const match = rows[0]!;
    return {
      matched: true,
      contractorName: match.name,
      totalContracts: match.total_contracts,
      rankByContracts: match.rank_by_contracts,
      noBidTotal: match.no_bid_total,
      topAgencies: match.top_agencies as { name: string; amount: number }[],
      yearlySpend: match.yearly_spend as { year: number; amount: number }[],
    };
  }

  /** Fuzzy match client name against lobby intel */
  private async fuzzyMatchLobbyIntel(clientName: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        trajectory: string | null;
        growth_rate: number | null;
        total_spending: number | null;
        similarity: number;
      }>
    >`
      SELECT id, name, trajectory, growth_rate, total_spending,
             similarity(name, ${clientName}) as similarity
      FROM lobby_intel
      WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 1
    `;
    if (!rows.length) return null;

    const match = rows[0]!;
    return {
      matched: true,
      trajectory: match.trajectory,
      growthRate: match.growth_rate,
      totalSpending: match.total_spending,
    };
  }

  /** Find Congress bills relevant to the client's issue areas */
  private async findRelevantBills(issueCodes: string[]) {
    if (!issueCodes.length) return { total: 0, bills: [] };

    // Map common LDA issue codes to policy area keywords
    const bills = await this.prisma.congressBill.findMany({
      where: {
        latestActionDate: { gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { latestActionDate: 'desc' },
      take: 10,
    });

    const total = await this.prisma.congressBill.count({
      where: {
        latestActionDate: { gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) },
      },
    });

    return { total, bills };
  }

  /** Find active regulations with open comment periods */
  private async findActiveRegulations(issueCodes: string[]) {
    const now = new Date();
    const docs = await this.prisma.federalRegisterDocument.findMany({
      where: {
        commentEndDate: { gt: now },
      },
      orderBy: { commentEndDate: 'asc' },
      take: 10,
    });

    const total = await this.prisma.federalRegisterDocument.count({
      where: { commentEndDate: { gt: now } },
    });

    return { total, documents: docs };
  }

  /** Find competitors: other entities lobbying on the same issue codes */
  private async findCompetitors(clientName: string, issueCodes: string[]) {
    if (!issueCodes.length) return { topBySpend: [], newEntrants: [] };

    // Find top spenders on the same issues (excluding the client itself)
    const topBySpend = await this.prisma.$queryRaw<
      Array<{ name: string; total_spending: number; shared_issues: string[] }>
    >`
      SELECT c.name, c.total_spending::float as total_spending,
             c.issue_codes as shared_issues
      FROM lda_client c
      WHERE c.issue_codes && ${issueCodes}::text[]
        AND similarity(c.name, ${clientName}) < 0.6
        AND c.total_spending IS NOT NULL
      ORDER BY c.total_spending DESC
      LIMIT 10
    `;

    // Find new entrants (first filing in last 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const newEntrants = await this.prisma.$queryRaw<
      Array<{ name: string; first_filing_date: string; issues: string[] }>
    >`
      SELECT c.name, MIN(f.dt_posted)::text as first_filing_date,
             c.issue_codes as issues
      FROM lda_client c
      JOIN lda_filing f ON f.client_id = c.id
      WHERE c.issue_codes && ${issueCodes}::text[]
        AND similarity(c.name, ${clientName}) < 0.6
      GROUP BY c.id, c.name, c.issue_codes
      HAVING MIN(f.dt_posted) >= ${ninetyDaysAgo}
      ORDER BY MIN(f.dt_posted) DESC
      LIMIT 5
    `;

    return {
      topBySpend: topBySpend.map((r) => ({
        name: r.name,
        totalSpending: r.total_spending,
        sharedIssues: r.shared_issues,
      })),
      newEntrants: newEntrants.map((r) => ({
        name: r.name,
        firstFilingDate: r.first_filing_date,
        issues: r.issues,
      })),
    };
  }

  /** Get recent intelligence changes */
  async getChanges(since?: string, clientId?: string, source?: string) {
    const where: Record<string, unknown> = {};
    if (since) where.detectedAt = { gte: new Date(since) };
    if (source) where.source = source;
    if (clientId) where.relatedClientIds = { has: clientId };

    const [data, total] = await Promise.all([
      this.prisma.intelligenceChange.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        take: 50,
      }),
      this.prisma.intelligenceChange.count({ where }),
    ]);

    return { data, total };
  }

  /** Get client-to-intel source mappings */
  async getMappings(clientId: string) {
    return this.prisma.clientIntelMapping.findMany({
      where: { clientId },
      orderBy: { confidence: 'desc' },
    });
  }

  /** Resolve mappings by fuzzy matching a CRM client against all sources */
  async resolveMapping(clientId: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const clientName = client.name;
    const results: Array<{
      source: string;
      externalId: string;
      externalName: string;
      confidence: number;
    }> = [];

    // Match against each source
    const ldaRows = await this.prisma.$queryRaw<
      Array<{ id: number; name: string; similarity: number }>
    >`
      SELECT id, name, similarity(name, ${clientName}) as similarity
      FROM lda_client WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC LIMIT 3
    `;
    for (const r of ldaRows) {
      results.push({
        source: 'lda',
        externalId: String(r.id),
        externalName: r.name,
        confidence: r.similarity,
      });
    }

    const contractorRows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; similarity: number }>
    >`
      SELECT id, name, similarity(name, ${clientName}) as similarity
      FROM federal_contractor WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC LIMIT 3
    `;
    for (const r of contractorRows) {
      results.push({
        source: 'contracting',
        externalId: r.id,
        externalName: r.name,
        confidence: r.similarity,
      });
    }

    const lobbyRows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; similarity: number }>
    >`
      SELECT id, name, similarity(name, ${clientName}) as similarity
      FROM lobby_intel WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC LIMIT 3
    `;
    for (const r of lobbyRows) {
      results.push({
        source: 'lobby_intel',
        externalId: r.id,
        externalName: r.name,
        confidence: r.similarity,
      });
    }

    // Upsert mappings
    const mappings = [];
    for (const r of results) {
      const mapping = await this.prisma.clientIntelMapping.upsert({
        where: {
          clientId_source_externalId: {
            clientId,
            source: r.source,
            externalId: r.externalId,
          },
        },
        update: {
          externalName: r.externalName,
          confidence: r.confidence,
        },
        create: {
          clientId,
          source: r.source,
          externalId: r.externalId,
          externalName: r.externalName,
          confidence: r.confidence,
          confirmed: r.confidence >= 0.6,
        },
      });
      mappings.push(mapping);
    }

    return mappings;
  }

  /** Confirm or reject a mapping */
  async confirmMapping(mappingId: string, confirmed: boolean) {
    return this.prisma.clientIntelMapping.update({
      where: { id: mappingId },
      data: { confirmed },
    });
  }
}
