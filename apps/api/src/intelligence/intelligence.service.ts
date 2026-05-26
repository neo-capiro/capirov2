import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EngagementTaskStatus } from '@prisma/client';
import {
  AGENCY_SECTOR_MAP,
  ldaCodesForSectors,
  normalizeSector,
  type SectorTag,
} from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDateInZone, dateBoundsInZone, dayBoundsInZone } from './time-bounds.js';

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build a 360° intelligence profile for a CRM client.
   * Uses confirmed mappings from client_intel_mapping when available;
   * falls back to fuzzy matching for sources without confirmed mappings.
   */
  async getClientProfile(clientId: string, tenantId: string) {
    // 1. Fetch the CRM client (tenant-scoped via RLS)
    const client = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findFirst({
        where: { id: clientId },
        include: { capabilities: true },
      }),
    );
    if (!client) throw new NotFoundException('Client not found');

    const clientName = client.name;
    const capabilityRefs = (client.capabilities ?? []).map((c) => ({
      name: c.name,
      sector: c.sector ?? null,
      tags: Array.isArray(c.tags)
        ? (c.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
    }));

    // 2. Fetch existing confirmed mappings, then resolve each source.
    //    Confirmed mappings skip fuzzy re-match and query by externalId directly.
    const existingMappings = await this.prisma.clientIntelMapping.findMany({
      where: { clientId },
      orderBy: { confidence: 'desc' },
    });

    const confirmedBySource = new Map<string, string>(); // source → externalId
    for (const m of existingMappings) {
      if (m.confirmed && !confirmedBySource.has(m.source)) {
        confirmedBySource.set(m.source, m.externalId);
      }
    }

    // 3. Resolve each source — use confirmed mapping if present, else fuzzy match
    const [ldaMatch, contractorMatch, lobbyMatch] = await Promise.all([
      confirmedBySource.has('lda')
        ? this.fetchLdaById(Number(confirmedBySource.get('lda')))
        : this.fuzzyMatchLda(clientName),
      confirmedBySource.has('contracting')
        ? this.fetchContractorById(confirmedBySource.get('contracting')!)
        : this.fuzzyMatchContractor(clientName),
      confirmedBySource.has('lobby_intel')
        ? this.fetchLobbyIntelById(confirmedBySource.get('lobby_intel')!)
        : this.fuzzyMatchLobbyIntel(clientName),
    ]);

    // 3. Get issue codes from LDA match
    const issueCodes: string[] = ldaMatch?.issueCodes ?? [];

    // 4. Find relevant bills and regulations in parallel
    // When LDA didn't match (no issue codes), fall back to the client's own
    // capability metadata so the Bills + Regulations tabs aren't empty for
    // unmapped clients. This mirrors getTrackedBills() and keeps the
    // standalone /tracked-bills endpoint and the profile's relevantBills in
    // agreement.
    const capabilityFallbackTerms = issueCodes.length
      ? []
      : await this.capabilityFallbackTerms(tenantId, clientId);

    const [relevantBills, activeRegulations, competitors] = await Promise.all([
      this.findRelevantBills(issueCodes, capabilityFallbackTerms),
      this.findActiveRegulations(issueCodes, capabilityFallbackTerms),
      this.findCompetitors(clientName, issueCodes),
    ]);

    return {
      client: {
        id: client.id,
        name: client.name,
        description: client.description,
        sectorTag: client.sectorTag,
        submissionTracks: client.submissionTracks ?? [],
        capabilities: capabilityRefs,
      },
      mappings: existingMappings,
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

  /** Fetch LDA data by confirmed client ID (skips fuzzy match) */
  private async fetchLdaById(ldaClientId: number) {
    const row = await this.prisma.$queryRaw<
      Array<{
        id: number;
        name: string;
        total_filings: number;
        total_spending: number | null;
        issue_codes: string[];
      }>
    >`
      SELECT id, name, total_filings, total_spending,
             COALESCE(issue_codes, '{}') as issue_codes
      FROM lda_client WHERE id = ${ldaClientId}
    `;
    if (!row.length) return null;

    const match = row[0]!;
    const filings = await this.prisma.ldaFiling.findMany({
      where: { clientId: match.id },
      orderBy: { dtPosted: 'desc' },
      take: 10,
    });
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
      confidence: 1.0,
      totalFilings: match.total_filings,
      totalSpending: match.total_spending,
      issueCodes: match.issue_codes,
      recentFilings: filings,
      yearlySpend,
    };
  }

  /** Fetch contractor data by confirmed ID (skips fuzzy match) */
  private async fetchContractorById(id: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        total_contracts: number | null;
        rank_by_contracts: number | null;
        no_bid_total: number | null;
        yearly_spend_jsonb: object[];
        top_agencies_jsonb: object[];
      }>
    >`
      SELECT id, name, total_contracts, rank_by_contracts, no_bid_total,
             COALESCE(yearly_spend_jsonb, '[]')::jsonb as yearly_spend_jsonb,
             COALESCE(top_agencies_jsonb, '[]')::jsonb as top_agencies_jsonb
      FROM federal_contractor WHERE id = ${id}::uuid
    `;
    if (!rows.length) return null;

    const match = rows[0]!;
    return {
      matched: true,
      contractorName: match.name,
      totalContracts: match.total_contracts,
      rankByContracts: match.rank_by_contracts,
      noBidTotal: match.no_bid_total,
      topAgencies: match.top_agencies_jsonb as { name: string; amount: number }[],
      yearlySpend: match.yearly_spend_jsonb as { year: number; amount: number }[],
    };
  }

  /** Fetch lobby intel data by confirmed ID (skips fuzzy match) */
  private async fetchLobbyIntelById(id: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        trajectory: string | null;
        growth_rate: number | null;
        total_spending: number | null;
      }>
    >`
      SELECT id, name, trajectory, growth_rate, total_spending
      FROM lobby_intel_mv WHERE id = ${id}::uuid
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
        yearly_spend_jsonb: object[];
        top_agencies_jsonb: object[];
        similarity: number;
      }>
    >`
      SELECT id, name, total_contracts, rank_by_contracts, no_bid_total,
             COALESCE(yearly_spend_jsonb, '[]')::jsonb as yearly_spend_jsonb,
             COALESCE(top_agencies_jsonb, '[]')::jsonb as top_agencies_jsonb,
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
      topAgencies: match.top_agencies_jsonb as { name: string; amount: number }[],
      yearlySpend: match.yearly_spend_jsonb as { year: number; amount: number }[],
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
      FROM lobby_intel_mv
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
  /**
   * Pull capability-derived match terms for a client. Mirrors the keyword
   * extraction inside getTrackedBills() so the profile's `relevantBills` /
   * `activeRegulations` and the standalone /tracked-bills endpoint produce
   * the same fallback set when LDA matching yields no issue codes.
   */
  private async capabilityFallbackTerms(tenantId: string, clientId: string): Promise<string[]> {
    const terms: string[] = [];
    const caps = await this.prisma.withTenant(tenantId, (tx) =>
      tx.clientCapability.findMany({
        where: { clientId },
        select: { sector: true, name: true, tags: true },
      }),
    );
    for (const cap of caps) {
      if (cap.sector) terms.push(cap.sector);
      if (cap.name) {
        cap.name
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .forEach((w) => terms.push(w));
      }
      const tags = Array.isArray(cap.tags) ? (cap.tags as unknown[]) : [];
      for (const t of tags) {
        if (typeof t === 'string' && t.length > 3) terms.push(t);
      }
    }
    return terms;
  }

  private async findRelevantBills(
    issueCodes: string[],
    fallbackTerms: string[] = [],
  ) {
    // Resolve LDA issue codes → English issue names via lda_issue_code, then
    // match those names (whole-word) against congress_bill_subject.name. The
    // fallbackTerms come from client capabilities when LDA didn't match —
    // they're already English-language strings so they're appended after
    // resolution. Whole-word match (not substring) avoids false positives
    // like "Federal Defense Officers" matching any client with the word
    // "Defense" in their LDA issues.
    const issueNames: string[] = [];
    if (issueCodes.length) {
      const nameRows = await this.prisma.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM lda_issue_code WHERE code = ANY(${issueCodes}::text[])
      `;
      issueNames.push(...nameRows.map((r) => r.name));
    }
    const allTerms = [...issueNames, ...fallbackTerms];
    if (!allTerms.length) return { total: 0, bills: [] };

    const lowerTerms = allTerms.map((n) => n.toLowerCase());
    const wordPatterns = lowerTerms.map(
      (n) => `\\m${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`,
    );

    // Total is computed in its own COUNT(DISTINCT) so the UI's "Tracked
    // Bills" statistic reflects the real cardinality, not the LIMIT 25 cap
    // that bounds the rendered list. Prior implementation returned
    // `bills.length` which silently capped at 25 even when 200+ bills
    // matched.
    //
    // Match surfaces (the spec calls out "bill subjects/policy areas"):
    //   • congress_bill_subject.name   — granular topic tags from CRS.
    //   • congress_bill.policy_area    — single canonical area per bill
    //                                    (e.g. "Armed Forces and National
    //                                    Security"). Matching this catches
    //                                    bills tagged only at the broad
    //                                    policy level when no subject row
    //                                    has the matching keyword.
    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(DISTINCT cb.id)::bigint AS total
      FROM congress_bill cb
      LEFT JOIN congress_bill_subject cbs ON cbs.bill_id = cb.id
      WHERE LOWER(cbs.name) = ANY(${lowerTerms}::text[])
         OR LOWER(cbs.name) ~ ANY(${wordPatterns}::text[])
         OR LOWER(cb.policy_area) = ANY(${lowerTerms}::text[])
         OR LOWER(cb.policy_area) ~ ANY(${wordPatterns}::text[])
    `;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        congress: number;
        bill_type: string;
        bill_number: string;
        title: string;
        introduced_date: Date | null;
        sponsor_name: string | null;
        sponsor_party: string | null;
        sponsor_state: string | null;
        latest_action_text: string | null;
        latest_action_date: Date | null;
        policy_area: string | null;
        subjects: string[];
      }>
    >`
      SELECT * FROM (
        SELECT DISTINCT ON (cb.id)
          cb.id, cb.congress, cb.bill_type, cb.bill_number, cb.title,
          cb.introduced_date, cb.sponsor_name, cb.sponsor_party, cb.sponsor_state,
          cb.latest_action_text, cb.latest_action_date, cb.policy_area, cb.subjects
        FROM congress_bill cb
        LEFT JOIN congress_bill_subject cbs ON cbs.bill_id = cb.id
        WHERE LOWER(cbs.name) = ANY(${lowerTerms}::text[])
           OR LOWER(cbs.name) ~ ANY(${wordPatterns}::text[])
           OR LOWER(cb.policy_area) = ANY(${lowerTerms}::text[])
           OR LOWER(cb.policy_area) ~ ANY(${wordPatterns}::text[])
        ORDER BY cb.id
      ) q
      ORDER BY q.latest_action_date DESC NULLS LAST
      LIMIT 25
    `;

    const bills = rows.map((r) => ({
      id: r.id,
      congress: r.congress,
      billType: r.bill_type,
      billNumber: r.bill_number,
      title: r.title,
      introducedDate: r.introduced_date,
      sponsorName: r.sponsor_name,
      sponsorParty: r.sponsor_party,
      sponsorState: r.sponsor_state,
      latestActionText: r.latest_action_text,
      latestActionDate: r.latest_action_date,
      policyArea: r.policy_area,
      subjects: r.subjects ?? [],
    }));

    return { total: Number(countRows[0]?.total ?? 0), bills };
  }

  /**
   * Find active regulations with open comment periods that match this client's
   * LDA issue codes. Two-pass match: (1) topic array contains an LDA issue name
   * as a whole word, OR (2) the document title mentions one of the issue names.
   * The pure exact-equality variant we tried first was too strict — LDA issue
   * names like "Defense" rarely equal FR topic strings like "Defense department"
   * verbatim, so it returned zero rows even for clients with obvious matches.
   */
  private async findActiveRegulations(
    issueCodes: string[],
    fallbackTerms: string[] = [],
  ) {
    const issueNames: string[] = [];
    if (issueCodes.length) {
      const nameRows = await this.prisma.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM lda_issue_code WHERE code = ANY(${issueCodes}::text[])
      `;
      issueNames.push(...nameRows.map((r) => r.name));
    }
    const allTerms = [...issueNames, ...fallbackTerms];
    if (!allTerms.length) return { total: 0, documents: [] };

    const lowerTerms = allTerms.map((n) => n.toLowerCase());
    const wordPatterns = lowerTerms.map(
      (n) => `\\m${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`,
    );

    // Separate COUNT so total isn't truncated by the LIMIT 50 page.
    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM federal_register_document
      WHERE comment_end_date > NOW()
        AND (
          EXISTS (
            SELECT 1 FROM unnest(topics) t
            WHERE LOWER(t) ~ ANY(${wordPatterns}::text[])
          )
          OR LOWER(title) ~ ANY(${wordPatterns}::text[])
        )
    `;

    const docs = await this.prisma.$queryRaw<
      Array<{
        id: string;
        document_number: string;
        type: string;
        title: string;
        agency_names: string[];
        topics: string[];
        comment_end_date: Date | null;
        publication_date: Date;
        significant_rule: boolean;
        html_url: string | null;
      }>
    >`
      SELECT id, document_number, type, title, agency_names, topics,
             comment_end_date, publication_date, significant_rule, html_url
      FROM federal_register_document
      WHERE comment_end_date > NOW()
        AND (
          EXISTS (
            SELECT 1 FROM unnest(topics) t
            WHERE LOWER(t) ~ ANY(${wordPatterns}::text[])
          )
          OR LOWER(title) ~ ANY(${wordPatterns}::text[])
        )
      ORDER BY comment_end_date ASC
      LIMIT 50
    `;

    const documents = docs.map((d) => ({
      id: d.id,
      documentNumber: d.document_number,
      type: d.type,
      title: d.title,
      agencyNames: d.agency_names,
      topics: d.topics,
      commentEndDate: d.comment_end_date,
      publicationDate: d.publication_date,
      significantRule: d.significant_rule,
      htmlUrl: d.html_url,
    }));

    return { total: Number(countRows[0]?.total ?? 0), documents };
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

  /**
   * Get recent intelligence changes, scoped to the requesting tenant.
   *
   * Cross-tenant safety: `intelligence_change` is a GLOBAL table (no tenant_id).
   * Comment-period emitters write per-(doc × client) rows with descriptions
   * referencing the matched client by name. Returning those globally would
   * leak client names across tenants. We filter to:
   *   - Rows that explicitly touch one of this tenant's clients, OR
   *   - Tenant-neutral rows (empty `relatedClientIds`) which are general
   *     market signals like "5 new GAO reports detected in last 24h".
   *
   * Pass `tenantClientIds` from the caller — typically resolved once with
   * `withTenant(...).client.findMany({ select: { id: true } })`.
   */
  async getChanges(
    tenantId: string,
    since?: string,
    clientId?: string,
    source?: string,
  ) {
    const tenantClientIds = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findMany({ where: { status: { not: 'archived' } }, select: { id: true } }),
    );
    const ids = tenantClientIds.map((c) => c.id);

    // Validate the optional clientId query param is one of this tenant's clients.
    if (clientId && !ids.includes(clientId)) {
      return [];
    }

    const where: Record<string, unknown> = {};
    if (since) where.detectedAt = { gte: new Date(since) };
    if (source) where.source = source;

    if (clientId) {
      where.relatedClientIds = { has: clientId };
    } else {
      // Either touches one of this tenant's clients, or is tenant-neutral
      // (no related clients at all = general market signal).
      where.OR = [
        { relatedClientIds: { hasSome: ids } },
        { relatedClientIds: { isEmpty: true } },
      ];
    }

    return this.prisma.intelligenceChange.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
      take: 50,
    });
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
    const client = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findFirst({ where: { id: clientId } }),
    );
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
      FROM lobby_intel_mv WHERE similarity(name, ${clientName}) > 0.3
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

  /** Mark an intelligence change as consumed/unconsumed */
  async markChangeConsumed(id: string, consumed: boolean) {
    return this.prisma.intelligenceChange.update({
      where: { id },
      data: { consumed },
    });
  }

  /** Count non-consumed changes detected in the last 7 days */
  async getUnreadChangesCount() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const count = await this.prisma.intelligenceChange.count({
      where: { consumed: false, detectedAt: { gte: sevenDaysAgo } },
    });
    return { count };
  }

  /** Lobbying $ vs Contract $ ROI for a client via confirmed mappings */
  async getLobbyingRoi(clientId: string) {
    const [ldaMapping, contractingMapping] = await Promise.all([
      this.prisma.clientIntelMapping.findFirst({
        where: { clientId, source: 'lda', confirmed: true },
      }),
      this.prisma.clientIntelMapping.findFirst({
        where: { clientId, source: 'contracting', confirmed: true },
      }),
    ]);

    let lobbySpend = 0;
    let contractWins = 0;

    if (ldaMapping) {
      const rows = await this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COALESCE(SUM(income), 0)::float AS total
        FROM lda_filing
        WHERE client_id = ${Number(ldaMapping.externalId)}
      `;
      lobbySpend = rows[0]?.total ?? 0;
    }

    if (contractingMapping) {
      const rows = await this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COALESCE(total_contracts, 0)::float AS total
        FROM federal_contractor
        WHERE id = ${contractingMapping.externalId}::uuid
      `;
      contractWins = rows[0]?.total ?? 0;
    }

    const roi = lobbySpend > 0 ? contractWins / lobbySpend : null;
    return { lobbySpend, contractWins, roi };
  }

  /** Competitor surge detector: other registrants lobbying on same issue codes in last 90 days */
  async getCompetitorBoard(clientId: string) {
    const ldaMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'lda', confirmed: true },
    });
    if (!ldaMapping) return { competitors: [], leaderboards: [] };

    const ldaClientId = Number(ldaMapping.externalId);

    const clientRows = await this.prisma.$queryRaw<Array<{ issue_codes: string[] }>>`
      SELECT COALESCE(issue_codes, '{}') AS issue_codes FROM lda_client WHERE id = ${ldaClientId}
    `;
    const issueCodes = clientRows[0]?.issue_codes ?? [];
    if (!issueCodes.length) return { competitors: [], leaderboards: [] };

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [rows, leaderboards] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          registrant_name: string;
          filing_count: number;
          all_time_first: Date | null;
          shared_issues: string[];
        }>
      >`
        SELECT
          f.registrant_name,
          COUNT(*)::int AS filing_count,
          (SELECT MIN(f2.dt_posted) FROM lda_filing f2 WHERE f2.registrant_name = f.registrant_name) AS all_time_first,
          array_agg(DISTINCT ic) FILTER (WHERE ic IS NOT NULL) AS shared_issues
        FROM lda_filing f,
             LATERAL unnest(f.issue_codes) ic
        WHERE f.dt_posted >= ${ninetyDaysAgo}
          AND f.client_id != ${ldaClientId}
          AND f.issue_codes && ${issueCodes}::text[]
          AND ic = ANY(${issueCodes}::text[])
        GROUP BY f.registrant_name
        ORDER BY filing_count DESC
        LIMIT 20
      `,
      Promise.all(issueCodes.slice(0, 5).map((code) => this.getIssueLeaderboard(code))),
    ]);

    return {
      competitors: rows.map((r) => ({
        registrantName: r.registrant_name,
        filingCount: r.filing_count,
        isNewEntrant: r.all_time_first !== null && r.all_time_first >= ninetyDaysAgo,
        issueOverlap: r.shared_issues ?? [],
      })),
      leaderboards,
    };
  }

  /** Ex-staffers: lobbyists on this client's filings who have covered government positions */
  async getExStaffers(clientId: string) {
    const ldaMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'lda', confirmed: true },
    });
    if (!ldaMapping) return { lobbyists: [] };

    const ldaClientId = Number(ldaMapping.externalId);

    const regRows = await this.prisma.$queryRaw<Array<{ registrant_id: number }>>`
      SELECT DISTINCT registrant_id FROM lda_filing
      WHERE client_id = ${ldaClientId} AND registrant_id IS NOT NULL
    `;
    const registrantIds = regRows.map((r) => r.registrant_id);
    if (!registrantIds.length) return { lobbyists: [] };

    const lobbyists = await this.prisma.$queryRaw<
      Array<{
        id: number;
        first_name: string;
        last_name: string;
        covered_positions: unknown;
      }>
    >`
      SELECT id, first_name, last_name, covered_positions
      FROM lda_lobbyist
      WHERE registrant_ids && ${registrantIds}::int[]
        AND covered_positions::text != '[]'
      ORDER BY last_name, first_name
      LIMIT 50
    `;

    return {
      lobbyists: lobbyists.map((l) => ({
        name: `${l.first_name} ${l.last_name}`.trim(),
        coveredPositions: Array.isArray(l.covered_positions) ? l.covered_positions : [],
      })),
    };
  }

  /** Relevant bills for a client, derived from their confirmed LDA issue codes */
  async getClientBills(clientId: string) {
    const ldaMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'lda', confirmed: true },
    });

    let issueCodes: string[] = [];
    if (ldaMapping) {
      const clientRows = await this.prisma.$queryRaw<Array<{ issue_codes: string[] }>>`
        SELECT COALESCE(issue_codes, '{}') AS issue_codes FROM lda_client WHERE id = ${Number(ldaMapping.externalId)}
      `;
      issueCodes = clientRows[0]?.issue_codes ?? [];
    }

    return this.findRelevantBills(issueCodes);
  }

  /** Auto-matched bills per client based on LDA issue codes ↔ CongressBillSubject name overlap */
  async getTrackedBills(clientId: string, tenantId?: string) {
    const ldaMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'lda', confirmed: true },
    });

    let issueCodes: string[] = [];
    let issueNames: string[] = [];

    if (ldaMapping) {
      const codeRows = await this.prisma.$queryRaw<Array<{ issue_codes: string[] }>>`
        SELECT COALESCE(issue_codes, '{}') AS issue_codes FROM lda_client WHERE id = ${Number(ldaMapping.externalId)}
      `;
      issueCodes = codeRows[0]?.issue_codes ?? [];

      if (issueCodes.length) {
        const nameRows = await this.prisma.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM lda_issue_code WHERE code = ANY(${issueCodes}::text[])
        `;
        issueNames = nameRows.map((r) => r.name);
      }
    }

    // Also pull capability keywords if tenantId provided
    const capKeywords: string[] = [];
    if (tenantId && issueCodes.length === 0) {
      const caps = await this.prisma.withTenant(tenantId, (tx) =>
        tx.clientCapability.findMany({
          where: { clientId },
          select: { sector: true, name: true, tags: true },
        }),
      );
      for (const cap of caps) {
        if (cap.sector) capKeywords.push(cap.sector);
        if (cap.name) cap.name.split(/\s+/).filter((w) => w.length > 3).forEach((w) => capKeywords.push(w));
        const tags = Array.isArray(cap.tags) ? (cap.tags as unknown[]) : [];
        for (const t of tags) {
          if (typeof t === 'string' && t.length > 3) capKeywords.push(t);
        }
      }
    }

    const allTerms = [...issueNames, ...capKeywords];
    if (!allTerms.length) return { total: 0, bills: [], issueCodes };

    // Require subject-name OVERLAP — exact equality OR the subject contains the
    // whole-term as a regex word boundary. Substring ILIKE was returning
    // false positives like "9/11 Memorial and Museum Act" for any client with
    // "Defense" in their issues (subject "Federal Defense Officers" matched).
    const lowerTerms = allTerms.map((n) => n.toLowerCase());
    const wordPatterns = lowerTerms.map((n) => `\\m${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`);

    // Separate COUNT so the UI's "Tracked Bills" stat reports the real
    // cardinality rather than the LIMIT 50 cap on the rendered table.
    //
    // Match surfaces: subject names (granular CRS tags) OR policy_area
    // (canonical area per bill). Adding policy_area catches bills that are
    // only tagged at the broad level — important for clients whose LDA
    // issues / capability sectors map to the policy-area vocabulary more
    // cleanly than to subject vocabulary.
    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(DISTINCT cb.id)::bigint AS total
      FROM congress_bill cb
      LEFT JOIN congress_bill_subject cbs ON cbs.bill_id = cb.id
      WHERE LOWER(cbs.name) = ANY(${lowerTerms}::text[])
         OR LOWER(cbs.name) ~ ANY(${wordPatterns}::text[])
         OR LOWER(cb.policy_area) = ANY(${lowerTerms}::text[])
         OR LOWER(cb.policy_area) ~ ANY(${wordPatterns}::text[])
    `;

    const bills = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        latest_action_date: Date | null;
        latest_action_text: string | null;
        sponsor_name: string | null;
        sponsor_party: string | null;
        subjects: string[];
        policy_area: string | null;
      }>
    >`
      SELECT * FROM (
        SELECT DISTINCT ON (cb.id) cb.id, cb.title, cb.latest_action_date, cb.latest_action_text,
               cb.sponsor_name, cb.sponsor_party, cb.subjects, cb.policy_area
        FROM congress_bill cb
        LEFT JOIN congress_bill_subject cbs ON cbs.bill_id = cb.id
        WHERE LOWER(cbs.name) = ANY(${lowerTerms}::text[])
           OR LOWER(cbs.name) ~ ANY(${wordPatterns}::text[])
           OR LOWER(cb.policy_area) = ANY(${lowerTerms}::text[])
           OR LOWER(cb.policy_area) ~ ANY(${wordPatterns}::text[])
        ORDER BY cb.id
      ) q
      ORDER BY q.latest_action_date DESC NULLS LAST
      LIMIT 50
    `;

    return {
      total: Number(countRows[0]?.total ?? 0),
      issueCodes,
      bills: bills.map((b) => ({
        identifier: b.id,
        title: b.title,
        latestActionDate: b.latest_action_date,
        latestActionText: b.latest_action_text,
        sponsorName: b.sponsor_name,
        sponsorParty: b.sponsor_party,
        subjectNames: b.subjects ?? [],
      })),
    };
  }

  /** Live competitor leaderboard per LDA issue code with new-entrant and shared-lobbyist signals */
  async getIssueLeaderboard(issueCode: string) {
    const issueRows = await this.prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM lda_issue_code WHERE code = ${issueCode}
    `;
    const issueName = issueRows[0]?.name ?? issueCode;

    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [totalRows, registrantRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COUNT(*)::text AS total FROM lda_filing
        WHERE dt_posted >= ${twoYearsAgo} AND ${issueCode} = ANY(issue_codes)
      `,
      this.prisma.$queryRaw<
        Array<{
          registrant_id: number | null;
          registrant_name: string;
          filing_count: number;
          total_income: number | null;
          first_filing_date: Date | null;
        }>
      >`
        SELECT
          registrant_id,
          registrant_name,
          COUNT(*)::int AS filing_count,
          COALESCE(SUM(income), 0)::float AS total_income,
          MIN(dt_posted) AS first_filing_date
        FROM lda_filing
        WHERE dt_posted >= ${twoYearsAgo}
          AND ${issueCode} = ANY(issue_codes)
          AND registrant_name != ''
        GROUP BY registrant_id, registrant_name
        ORDER BY filing_count DESC, total_income DESC
        LIMIT 20
      `,
    ]);

    const totalFilings = parseInt(totalRows[0]?.total ?? '0', 10);

    // Find lobbyists who work for multiple registrants on this issue (potential conflicts)
    const registrantIds = registrantRows
      .map((r) => r.registrant_id)
      .filter((id): id is number => id !== null);

    const sharedByRegistrantId = new Map<number, string[]>();

    if (registrantIds.length > 1) {
      const sharedRows = await this.prisma.$queryRaw<
        Array<{ lobbyist_name: string; shared_registrant_ids: number[] }>
      >`
        SELECT
          TRIM(CONCAT(first_name, ' ', last_name)) AS lobbyist_name,
          ARRAY(
            SELECT r FROM unnest(registrant_ids) r WHERE r = ANY(${registrantIds}::int[])
          ) AS shared_registrant_ids
        FROM lda_lobbyist
        WHERE registrant_ids && ${registrantIds}::int[]
          AND (
            SELECT COUNT(*) FROM unnest(registrant_ids) r WHERE r = ANY(${registrantIds}::int[])
          ) > 1
        ORDER BY (
          SELECT COUNT(*) FROM unnest(registrant_ids) r WHERE r = ANY(${registrantIds}::int[])
        ) DESC
        LIMIT 30
      `;

      for (const row of sharedRows) {
        for (const regId of (row.shared_registrant_ids ?? [])) {
          if (!sharedByRegistrantId.has(regId)) sharedByRegistrantId.set(regId, []);
          sharedByRegistrantId.get(regId)!.push(row.lobbyist_name);
        }
      }
    }

    return {
      issueCode,
      issueName,
      totalFilings,
      registrants: registrantRows.map((r) => ({
        name: r.registrant_name,
        filingCount: r.filing_count,
        totalIncome: r.total_income ?? 0,
        isNewEntrant: r.first_filing_date !== null && r.first_filing_date >= ninetyDaysAgo,
        firstFilingDate: r.first_filing_date?.toISOString() ?? null,
        sharedLobbyists: r.registrant_id != null ? (sharedByRegistrantId.get(r.registrant_id) ?? []) : [],
      })),
    };
  }

  /** Engagement health score (0-100) per client, per 7-day window */
  async computeEngagementHealth(clientId: string, tenantId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const meetingWhere: Record<string, unknown> = { clientId, startsAt: { gte: sevenDaysAgo } };
    const mailWhere: Record<string, unknown> = { clientId, lastMessageAt: { gte: sevenDaysAgo } };
    const taskWhere: Record<string, unknown> = { clientId, status: EngagementTaskStatus.done, updatedAt: { gte: sevenDaysAgo } };
    const debriefWhere: Record<string, unknown> = { clientId, createdAt: { gte: sevenDaysAgo } };
    const outreachWhere: Record<string, unknown> = { clientId, sentAt: { gte: sevenDaysAgo } };

    const priorMeetingWhere: Record<string, unknown> = { clientId, startsAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } };
    const priorMailWhere: Record<string, unknown> = { clientId, lastMessageAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } };
    const priorTaskWhere: Record<string, unknown> = { clientId, status: EngagementTaskStatus.done, updatedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } };
    const priorDebriefWhere: Record<string, unknown> = { clientId, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } };
    const priorOutreachWhere: Record<string, unknown> = { clientId, sentAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } };

    const [meetings, emails, tasksCompleted, debriefs, outreachSent, priorMeetings, priorEmails, priorTasks, priorDebriefs, priorOutreach] =
      await Promise.all([
        this.prisma.withTenant(tenantId, (tx) => tx.meeting.count({ where: meetingWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.mailThread.count({ where: mailWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.engagementTask.count({ where: taskWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.meetingDebrief.count({ where: debriefWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.outreachRecord.count({ where: outreachWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.meeting.count({ where: priorMeetingWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.mailThread.count({ where: priorMailWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.engagementTask.count({ where: priorTaskWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.meetingDebrief.count({ where: priorDebriefWhere })),
        this.prisma.withTenant(tenantId, (tx) => tx.outreachRecord.count({ where: priorOutreachWhere })),
      ]);

    const expectedWeeklyPace = 100;
    const score = Math.min(100, Math.round(
      (meetings * 15 + emails * 2 + tasksCompleted * 10 + debriefs * 20 + outreachSent * 5) / expectedWeeklyPace * 100,
    ));
    const priorScore = Math.min(100, Math.round(
      (priorMeetings * 15 + priorEmails * 2 + priorTasks * 10 + priorDebriefs * 20 + priorOutreach * 5) / expectedWeeklyPace * 100,
    ));

    const trend: 'improving' | 'stable' | 'declining' =
      score > priorScore + 5 ? 'improving' : score < priorScore - 5 ? 'declining' : 'stable';

    return {
      score,
      breakdown: { meetings, emails, tasksCompleted, debriefs, outreachSent },
      trend,
      period: '7d',
    };
  }

  /** Comment-period urgency alerts: upcoming FederalRegisterDocument deadlines matched to tenant clients */
  async getCommentPeriodAlerts(tenantId: string) {
    const now = new Date();
    const fourteenDaysOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [clientsWithCaps, docs] = await Promise.all([
      this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findMany({
          where: { profileStatus: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            sectorTag: true,
            capabilities: { select: { sector: true, tags: true, name: true } },
          },
        }),
      ),
      this.prisma.federalRegisterDocument.findMany({
        where: {
          type: { in: ['PROPOSED_RULE', 'RULE'] },
          commentEndDate: { gt: now, lte: fourteenDaysOut },
        },
        orderBy: { commentEndDate: 'asc' },
      }),
    ]);

    if (!docs.length || !clientsWithCaps.length) return { alerts: [] };

    const alerts: Array<{
      documentId: string;
      title: string;
      type: string;
      commentEndDate: Date;
      daysToDeadline: number;
      severity: string;
      agencies: string[];
      clientId: string;
      clientName: string;
      relevanceScore: number;
    }> = [];

    const changesToCreate: Array<{
      source: string;
      changeType: string;
      severity: string;
      title: string;
      description: string;
      relatedClientIds: string[];
      relatedIssues: string[];
      data: object;
    }> = [];

    for (const doc of docs) {
      const daysToDeadline = Math.ceil((doc.commentEndDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const urgencyMultiplier = daysToDeadline < 3 ? 2.0 : daysToDeadline <= 7 ? 1.5 : 1.0;
      const severity = daysToDeadline < 3 ? 'critical' : daysToDeadline <= 7 ? 'notable' : 'info';
      const agencies = doc.agencyNames as string[];

      // Determine which sectors this document touches via agency mapping
      const docSectors = new Set<SectorTag>();
      for (const agency of agencies) {
        for (const sector of AGENCY_SECTOR_MAP[agency] ?? []) {
          docSectors.add(sector);
        }
      }
      // LDA codes derived from doc sectors — feeds IntelligenceChange.relatedIssues
      // so the hasSome branch in getCommentPeriodAlerts / generateClientBriefing
      // can surface this change for clients lobbying on the same codes.
      const docLdaCodes = ldaCodesForSectors([...docSectors]);

      for (const client of clientsWithCaps) {
        let baseRelevance = 0;
        const matchedSectors = new Set<SectorTag>();

        // Agency-sector match against client sectorTag (already controlled enum)
        if (client.sectorTag && docSectors.has(client.sectorTag as SectorTag)) {
          baseRelevance = Math.max(baseRelevance, 0.5);
          matchedSectors.add(client.sectorTag as SectorTag);
        }

        // Agency-sector match against capability sectors. cap.sector is free text
        // in legacy data; normalize through the shared taxonomy before comparing.
        for (const cap of client.capabilities) {
          const normalized = normalizeSector(cap.sector);
          if (normalized && docSectors.has(normalized)) {
            baseRelevance = Math.max(baseRelevance, 0.5);
            matchedSectors.add(normalized);
          }
        }

        // Topic match against capability keywords
        if (baseRelevance < 0.7) {
          const capKeywords = new Set<string>();
          for (const cap of client.capabilities) {
            if (cap.sector) capKeywords.add(cap.sector.toLowerCase());
            if (cap.name) cap.name.split(/\s+/).filter((w) => w.length > 3).forEach((w) => capKeywords.add(w.toLowerCase()));
            const tags = Array.isArray(cap.tags) ? (cap.tags as unknown[]) : [];
            for (const t of tags) {
              if (typeof t === 'string' && t.length > 3) capKeywords.add(t.toLowerCase());
            }
          }

          for (const topic of (doc.topics as string[])) {
            const topicLower = topic.toLowerCase();
            for (const kw of capKeywords) {
              if (topicLower.includes(kw) || kw.includes(topicLower)) {
                baseRelevance = Math.max(baseRelevance, 0.7);
                break;
              }
            }
          }
        }

        const finalScore = baseRelevance * urgencyMultiplier;
        if (finalScore <= 0.3) continue;

        alerts.push({
          documentId: doc.id,
          title: doc.title,
          type: doc.type,
          commentEndDate: doc.commentEndDate!,
          daysToDeadline,
          severity,
          agencies,
          clientId: client.id,
          clientName: client.name,
          relevanceScore: Math.round(finalScore * 100) / 100,
        });

        const matchedLdaCodes = matchedSectors.size
          ? ldaCodesForSectors([...matchedSectors])
          : docLdaCodes;
        changesToCreate.push({
          source: 'federal_register',
          changeType: 'comment_deadline_approaching',
          severity,
          title: `Comment period closing in ${daysToDeadline}d: ${doc.title.slice(0, 80)}`,
          description: `${doc.type} from ${agencies.slice(0, 2).join('/')} has a comment deadline in ${daysToDeadline} days. Relevant to ${client.name}.`,
          relatedClientIds: [client.id],
          relatedIssues: matchedLdaCodes,
          data: { documentId: doc.id, daysToDeadline, relevanceScore: finalScore },
        });
      }
    }

    // Emit changes (fire-and-forget errors)
    await Promise.all(
      changesToCreate.map((c) =>
        this.prisma.intelligenceChange.create({ data: c }).catch((err) => {
          this.logger.warn(`Failed to emit comment-period change: ${err.message}`);
        }),
      ),
    );

    alerts.sort((a, b) => a.daysToDeadline - b.daysToDeadline);
    return { alerts };
  }

  /** Knowledge graph nodes + edges for hub-and-spoke visualization */
  async getKnowledgeGraph(clientId: string, tenantId: string) {
    const [client, mappings] = await Promise.all([
      this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findFirst({
          where: { id: clientId },
          select: { id: true, name: true, sectorTag: true },
        }),
      ),
      this.prisma.clientIntelMapping.findMany({
        where: { clientId },
        orderBy: { confidence: 'desc' },
      }),
    ]);

    const clientLabel = client?.name ?? clientId;
    const nodes: Array<{ id: string; type: string; label: string; metadata: Record<string, unknown> }> = [];
    const edges: Array<{ source: string; target: string; type: string; label: string }> = [];

    const centerNodeId = `client:${clientId}`;
    nodes.push({
      id: centerNodeId,
      type: 'client',
      label: clientLabel,
      metadata: { sectorTag: client?.sectorTag ?? null },
    });

    const ldaMapping = mappings.find((m) => m.source === 'lda' && m.confirmed);
    const contractingMapping = mappings.find((m) => m.source === 'contracting' && m.confirmed);

    if (ldaMapping) {
      const ldaClientId = Number(ldaMapping.externalId);

      // Registrant nodes
      const registrants = await this.prisma.$queryRaw<
        Array<{ registrant_id: number | null; registrant_name: string; filing_count: number }>
      >`
        SELECT registrant_id, registrant_name, COUNT(*)::int AS filing_count
        FROM lda_filing WHERE client_id = ${ldaClientId} AND registrant_name != ''
        GROUP BY registrant_id, registrant_name
        ORDER BY filing_count DESC LIMIT 10
      `;

      for (const reg of registrants) {
        const regNodeId = `registrant:${reg.registrant_id ?? reg.registrant_name}`;
        nodes.push({
          id: regNodeId,
          type: 'registrant',
          label: reg.registrant_name,
          metadata: { registrantId: reg.registrant_id, filingCount: reg.filing_count },
        });
        edges.push({
          source: centerNodeId,
          target: regNodeId,
          type: 'lda_match',
          label: `LDA: ${Math.round((ldaMapping.confidence ?? 0) * 100)}%`,
        });

        // Lobbyists for this registrant (top 5)
        if (reg.registrant_id) {
          const lobbyists = await this.prisma.$queryRaw<
            Array<{ id: number; first_name: string; last_name: string; covered_positions: unknown }>
          >`
            SELECT id, first_name, last_name, covered_positions
            FROM lda_lobbyist WHERE ${reg.registrant_id} = ANY(registrant_ids)
            LIMIT 5
          `;
          for (const l of lobbyists) {
            const positions = Array.isArray(l.covered_positions) ? l.covered_positions : [];
            const lobbyistNodeId = `lobbyist:${l.id}`;
            nodes.push({
              id: lobbyistNodeId,
              type: 'lobbyist',
              label: `${l.first_name} ${l.last_name}`.trim(),
              metadata: { coveredPositions: (positions as unknown[]).slice(0, 3) },
            });
            edges.push({ source: regNodeId, target: lobbyistNodeId, type: 'employs', label: 'employs' });
          }
        }
      }

      // Bills derived from issue codes
      const codeRows = await this.prisma.$queryRaw<Array<{ issue_codes: string[] }>>`
        SELECT COALESCE(issue_codes, '{}') AS issue_codes FROM lda_client WHERE id = ${ldaClientId}
      `;
      const issueCodes = codeRows[0]?.issue_codes ?? [];
      if (issueCodes.length) {
        const nameRows = await this.prisma.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM lda_issue_code WHERE code = ANY(${issueCodes}::text[])
        `;
        if (nameRows.length) {
          const patterns = nameRows.map((r) => `%${r.name.toLowerCase()}%`);
          const bills = await this.prisma.$queryRaw<
            Array<{ id: string; title: string; latest_action_date: Date | null }>
          >`
            SELECT DISTINCT cb.id, cb.title, cb.latest_action_date
            FROM congress_bill cb
            JOIN congress_bill_subject cbs ON cbs.bill_id = cb.id
            WHERE LOWER(cbs.name) ILIKE ANY(${patterns}::text[])
            ORDER BY latest_action_date DESC NULLS LAST
            LIMIT 10
          `;
          for (const bill of bills) {
            const billNodeId = `bill:${bill.id}`;
            nodes.push({
              id: billNodeId,
              type: 'bill',
              label: bill.id,
              metadata: { title: bill.title.slice(0, 80), latestActionDate: bill.latest_action_date },
            });
            edges.push({ source: centerNodeId, target: billNodeId, type: 'tracks', label: 'tracks' });
          }
        }
      }
    }

    if (contractingMapping) {
      const contractorNodeId = `contractor:${contractingMapping.externalId}`;
      nodes.push({
        id: contractorNodeId,
        type: 'contractor',
        label: contractingMapping.externalName,
        metadata: {},
      });
      edges.push({
        source: centerNodeId,
        target: contractorNodeId,
        type: 'contracting_match',
        label: 'contractor match',
      });

      // Top agencies for contractor
      const agencyRows = await this.prisma.$queryRaw<Array<{ name: string; amount: number }>>`
        SELECT (agency->>'name') AS name, (agency->>'amount')::float AS amount
        FROM federal_contractor,
             LATERAL jsonb_array_elements(COALESCE(top_agencies_jsonb, '[]'::jsonb)) AS agency
        WHERE id = ${contractingMapping.externalId}::uuid
        LIMIT 5
      `;
      for (const agency of agencyRows) {
        const agencyNodeId = `agency:${agency.name}`;
        if (!nodes.find((n) => n.id === agencyNodeId)) {
          nodes.push({
            id: agencyNodeId,
            type: 'agency',
            label: agency.name,
            metadata: { amount: agency.amount },
          });
        }
        edges.push({
          source: contractorNodeId,
          target: agencyNodeId,
          type: 'awarded_by',
          label: agency.amount ? `$${(agency.amount / 1e9).toFixed(1)}B` : 'awarded by',
        });
      }
    }

    const confirmedMappings = mappings.filter((m) => m.confirmed);
    const avgConfidence =
      confirmedMappings.length > 0
        ? confirmedMappings.reduce((s, m) => s + (m.confidence ?? 0), 0) / confirmedMappings.length
        : 0;

    return {
      nodes,
      edges,
      resolutionQuality: {
        avgConfidence: Math.round(avgConfidence * 100),
        confirmedCount: confirmedMappings.length,
        unconfirmedCount: mappings.filter((m) => !m.confirmed).length,
      },
    };
  }

  /** Outreach intelligence context — formatted text block for AI prompt injection */
  async getOutreachContext(
    clientId: string,
    tenantId: string,
    recipientOffice?: string,
  ) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const ldaMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'lda', confirmed: true },
    });

    let issueCodes: string[] = [];
    if (ldaMapping) {
      const codeRows = await this.prisma.$queryRaw<Array<{ issue_codes: string[] }>>`
        SELECT COALESCE(issue_codes, '{}') AS issue_codes
        FROM lda_client WHERE id = ${Number(ldaMapping.externalId)}
      `;
      issueCodes = codeRows[0]?.issue_codes ?? [];
    }

    // Tracked bills + upcoming hearings + recent changes + comment deadlines in parallel.
    // Comment-period emitters now populate `relatedIssues` via SECTOR_TO_LDA_CODES;
    // other sync emitters (emit-changes, compute-health-scores) still leave it empty,
    // so the hasSome branch surfaces sector-mapped events but not source-summary rows.
    const changeOrConditions: Record<string, unknown>[] = [{ relatedClientIds: { has: clientId } }];
    if (issueCodes.length) changeOrConditions.push({ relatedIssues: { hasSome: issueCodes } });

    const [trackedBills, hearings, recentChanges, commentPeriods, healthScore] = await Promise.all([
      this.getTrackedBills(clientId, tenantId),
      this.prisma.committeeHearing.findMany({
        where: { date: { gte: now, lte: fourteenDaysOut } },
        orderBy: { date: 'asc' },
        take: 5,
      }),
      this.prisma.intelligenceChange.findMany({
        where: { OR: changeOrConditions, detectedAt: { gte: sevenDaysAgo } },
        orderBy: { detectedAt: 'desc' },
        take: 5,
      }),
      this.prisma.federalRegisterDocument.findMany({
        where: {
          type: { in: ['PROPOSED_RULE', 'RULE'] },
          commentEndDate: { gt: now, lte: fourteenDaysOut },
        },
        orderBy: { commentEndDate: 'asc' },
        take: 5,
        select: { title: true, commentEndDate: true, agencyNames: true },
      }),
      this.computeEngagementHealth(clientId, tenantId),
    ]);

    const parts: string[] = [];

    if (trackedBills.bills.length) {
      const billList = trackedBills.bills
        .slice(0, 5)
        .map(
          (b) =>
            `- ${b.identifier}: ${b.title.slice(0, 60)}${b.latestActionText ? ` [${b.latestActionText.slice(0, 40)}]` : ''}`,
        )
        .join('\n');
      parts.push(`TRACKED BILLS:\n${billList}`);
    }

    if (hearings.length) {
      const hearingList = hearings
        .map((h) => {
          const daysOut = Math.ceil((new Date(h.date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return `- ${h.committeeName}: "${h.title.slice(0, 60)}" (in ${daysOut}d, ${h.chamber})`;
        })
        .join('\n');
      parts.push(`UPCOMING HEARINGS (14d):\n${hearingList}`);
    }

    if (recentChanges.length) {
      const changeList = recentChanges
        .map((c) => `- [${c.changeType}] ${c.title}`)
        .join('\n');
      parts.push(`RECENT INTELLIGENCE (7d):\n${changeList}`);
    }

    if (commentPeriods.length) {
      const deadlineList = commentPeriods
        .map((d) => {
          const days = Math.ceil((d.commentEndDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return `- "${d.title.slice(0, 60)}" — ${days}d left (${(d.agencyNames as string[]).slice(0, 2).join('/')})`;
        })
        .join('\n');
      parts.push(`COMMENT PERIOD DEADLINES:\n${deadlineList}`);
    }

    // Lobbyist coverage check for recipientOffice
    if (recipientOffice && ldaMapping) {
      const ldaClientId = Number(ldaMapping.externalId);
      const regRows = await this.prisma.$queryRaw<Array<{ registrant_id: number }>>`
        SELECT DISTINCT registrant_id FROM lda_filing
        WHERE client_id = ${ldaClientId} AND registrant_id IS NOT NULL
      `;
      const registrantIds = regRows.map((r) => r.registrant_id);
      if (registrantIds.length) {
        const lobbyists = await this.prisma.$queryRaw<
          Array<{ first_name: string; last_name: string; covered_positions: unknown }>
        >`
          SELECT first_name, last_name, covered_positions FROM lda_lobbyist
          WHERE registrant_ids && ${registrantIds}::int[]
            AND covered_positions::text != '[]'
          LIMIT 20
        `;
        const officeLower = recipientOffice.toLowerCase();
        const matched = lobbyists.filter((l) => {
          const positions = Array.isArray(l.covered_positions) ? l.covered_positions : [];
          return (positions as unknown[]).some((p) => {
            const pos =
              p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
            const posTitle = typeof pos.position === 'string' ? pos.position.toLowerCase() : '';
            const posDept = typeof pos.department === 'string' ? pos.department.toLowerCase() : '';
            return posTitle.includes(officeLower) || posDept.includes(officeLower);
          });
        });
        if (matched.length) {
          const names = matched.slice(0, 3).map((l) => `${l.first_name} ${l.last_name}`.trim());
          parts.push(
            `LOBBYIST CONNECTIONS TO "${recipientOffice}":\n${names.map((n) => `- ${n}`).join('\n')}`,
          );
        }
      }
    }

    parts.push(`ENGAGEMENT HEALTH: ${healthScore.score}/100 (${healthScore.trend})`);

    return { context: parts.join('\n\n') };
  }

  /** Get all ClientIntelMappings for a tenant as a flat array with clientName included */
  async getAllMappingsForTenant(tenantId: string) {
    const clients = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findMany({ select: { id: true, name: true } }),
    );

    const clientIds = clients.map((c) => c.id);
    if (!clientIds.length) return [];

    const mappings = await this.prisma.clientIntelMapping.findMany({
      where: { clientId: { in: clientIds } },
      orderBy: { confidence: 'desc' },
    });

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    return mappings.map((m) => ({ ...m, clientName: clientMap.get(m.clientId) ?? '' }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2 cross-references
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Phase 2.3 — Capability → District Nexus.
   * Parses each client capability's districtNexus free-text field for state-district
   * codes (e.g. "CA-52", "TX 3", "FL-AL"), then joins the latest CensusDistrict row
   * for each. Produces "jobs in your district" talking-point data.
   */
  async getDistrictNexus(clientId: string, tenantId: string) {
    const caps = await this.prisma.withTenant(tenantId, (tx) =>
      tx.clientCapability.findMany({
        where: { clientId },
        select: {
          id: true,
          name: true,
          sector: true,
          districtNexus: true,
          existingContracts: true,
        },
      }),
    );

    // State-district pattern: 2-letter state code + (1-3 digits or "AL" for at-large),
    // separated by "-", "/", whitespace, or "CD". Examples: "CA-52", "TX 3", "FL-AL".
    const pattern = /\b([A-Z]{2})[\s\-\/]+(?:CD[\s\-]?)?(\d{1,3}|AL)\b/g;
    const allKeys = new Set<string>();
    const capDistricts = caps.map((cap) => {
      const text = cap.districtNexus ?? '';
      const matches = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text.toUpperCase())) !== null) {
        const state = m[1];
        const raw = m[2];
        if (!state || !raw) continue;
        const district = raw === 'AL' ? 'AL' : String(parseInt(raw, 10));
        const key = `${state}-${district}`;
        matches.add(key);
        allKeys.add(key);
      }
      return { cap, districtKeys: [...matches] };
    });

    if (!allKeys.size) {
      return {
        capabilities: caps.map((c) => ({
          capabilityId: c.id,
          capabilityName: c.name,
          capabilitySector: c.sector,
          districtNexus: c.districtNexus,
          districts: [],
        })),
      };
    }

    // Pull the latest CensusDistrict per (state, district) — highest congress wins.
    const districtRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        congress: number;
        state: string;
        district: string;
        total_population: number | null;
        median_household_income: number | null;
        labor_force_size: number | null;
        unemployment_rate: number | null;
        percent_veteran: number | null;
        top_industries: unknown;
        data_year: number;
      }>
    >`
      SELECT DISTINCT ON (state, district)
        id, congress, state, district, total_population, median_household_income,
        labor_force_size, unemployment_rate, percent_veteran, top_industries, data_year
      FROM census_district
      WHERE state || '-' || district = ANY(${[...allKeys]}::text[])
      ORDER BY state, district, congress DESC
    `;

    const districtMap = new Map(districtRows.map((r) => [`${r.state}-${r.district}`, r]));

    return {
      capabilities: capDistricts.map(({ cap, districtKeys }) => ({
        capabilityId: cap.id,
        capabilityName: cap.name,
        capabilitySector: cap.sector,
        districtNexus: cap.districtNexus,
        districts: districtKeys
          .map((key) => districtMap.get(key))
          .filter((d): d is NonNullable<typeof d> => Boolean(d))
          .map((d) => ({
            id: d.id,
            congress: d.congress,
            state: d.state,
            district: d.district,
            totalPopulation: d.total_population,
            medianHouseholdIncome: d.median_household_income,
            laborForceSize: d.labor_force_size,
            unemploymentRate: d.unemployment_rate,
            percentVeteran: d.percent_veteran,
            topIndustries: Array.isArray(d.top_industries) ? d.top_industries : [],
            dataYear: d.data_year,
          })),
      })),
    };
  }

  /**
   * Phase 2.5 — Bill → Regulation lifecycle.
   * For each of the client's tracked bills, find FederalRegisterDocuments whose
   * `topics` array overlaps the bill's subjects, OR whose title/abstract references
   * the bill's identifier (e.g. "H.R. 1234"). Surfaces "the agency just published
   * a rule for a bill you track."
   */
  async getBillRegulationLinks(clientId: string, tenantId: string) {
    const tracked = await this.getTrackedBills(clientId, tenantId);
    if (!tracked.bills.length) {
      return { links: [], totalBills: 0, totalRegulations: 0 };
    }

    // Collect all subjects + identifier search terms across bills.
    const allSubjects = new Set<string>();
    const identifierTerms: string[] = [];
    for (const b of tracked.bills) {
      for (const s of b.subjectNames) allSubjects.add(s);
      // Build identifier variants from "119-hr-1234"
      const parts = b.identifier.split('-');
      if (parts.length === 3 && parts[1] && parts[2]) {
        const upper = parts[1].toUpperCase();
        const billNumber = parts[2];
        identifierTerms.push(`%${upper} ${billNumber}%`);
        identifierTerms.push(`%${upper}${billNumber}%`);
      }
    }
    const subjects = [...allSubjects];

    const regulations = await this.prisma.$queryRaw<
      Array<{
        id: string;
        document_number: string;
        type: string;
        title: string;
        agency_names: string[];
        topics: string[];
        comment_end_date: Date | null;
        publication_date: Date;
        significant_rule: boolean;
        html_url: string | null;
      }>
    >`
      SELECT id, document_number, type, title, agency_names, topics,
             comment_end_date, publication_date, significant_rule, html_url
      FROM federal_register_document
      WHERE topics && ${subjects}::text[]
         OR title ILIKE ANY(${identifierTerms}::text[])
         OR abstract ILIKE ANY(${identifierTerms}::text[])
      ORDER BY publication_date DESC
      LIMIT 200
    `;

    // Group regulations back to bills by topic overlap or identifier mention.
    const links = tracked.bills.map((bill) => {
      const billSubjects = new Set(bill.subjectNames);
      const billIdentVariants = (() => {
        const parts = bill.identifier.split('-');
        if (parts.length !== 3 || !parts[1] || !parts[2]) return [];
        const upper = parts[1].toUpperCase();
        const num = parts[2];
        return [`${upper} ${num}`, `${upper}${num}`];
      })().map((s) => s.toLowerCase());

      const matched = regulations.filter((r) => {
        if (r.topics.some((t) => billSubjects.has(t))) return true;
        const haystack = r.title.toLowerCase();
        return billIdentVariants.some((v) => haystack.includes(v));
      });

      return {
        bill: {
          identifier: bill.identifier,
          title: bill.title,
          latestActionDate: bill.latestActionDate,
        },
        regulations: matched.slice(0, 10).map((r) => ({
          documentNumber: r.document_number,
          type: r.type,
          title: r.title,
          agencyNames: r.agency_names,
          publicationDate: r.publication_date,
          commentEndDate: r.comment_end_date,
          significantRule: r.significant_rule,
          htmlUrl: r.html_url,
          matchedTopics: r.topics.filter((t) => billSubjects.has(t)),
        })),
      };
    }).filter((l) => l.regulations.length > 0);

    return {
      links,
      totalBills: tracked.bills.length,
      totalRegulations: regulations.length,
    };
  }

  /**
   * Phase 2.6 — GAO/CRS → Bill attachment.
   * For each tracked bill, find GAO and CRS reports whose `topics` array overlaps
   * the bill's subjects. Provides authoritative analysis to attach to in-flight
   * bills — feeds RAG grounding and meeting prep.
   */
  async getBillResearchAttachments(clientId: string, tenantId: string) {
    const tracked = await this.getTrackedBills(clientId, tenantId);
    if (!tracked.bills.length) {
      return { attachments: [], totalBills: 0, totalReports: 0 };
    }

    const allSubjects = new Set<string>();
    for (const b of tracked.bills) for (const s of b.subjectNames) allSubjects.add(s);
    const subjects = [...allSubjects];
    if (!subjects.length) {
      return { attachments: [], totalBills: tracked.bills.length, totalReports: 0 };
    }

    const [gaoRows, crsRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          title: string;
          publish_date: Date | null;
          topics: string[];
          report_type: string | null;
          recommendations: number | null;
          url: string | null;
        }>
      >`
        SELECT id, title, publish_date, topics, report_type, recommendations, url
        FROM gao_report
        WHERE topics && ${subjects}::text[]
        ORDER BY publish_date DESC NULLS LAST
        LIMIT 150
      `,
      this.prisma.$queryRaw<
        Array<{
          id: string;
          title: string;
          date: Date | null;
          topics: string[];
          authors: string[];
          html_url: string | null;
        }>
      >`
        SELECT id, title, date, topics, authors, html_url
        FROM crs_report
        WHERE topics && ${subjects}::text[]
          AND active = true
        ORDER BY date DESC NULLS LAST
        LIMIT 150
      `,
    ]);

    const attachments = tracked.bills.map((bill) => {
      const billSubjects = new Set(bill.subjectNames);
      const gao = gaoRows
        .filter((r) => r.topics.some((t) => billSubjects.has(t)))
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          title: r.title,
          publishDate: r.publish_date,
          topics: r.topics.filter((t) => billSubjects.has(t)),
          reportType: r.report_type,
          recommendations: r.recommendations,
          url: r.url,
        }));
      const crs = crsRows
        .filter((r) => r.topics.some((t) => billSubjects.has(t)))
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          title: r.title,
          date: r.date,
          topics: r.topics.filter((t) => billSubjects.has(t)),
          authors: r.authors,
          htmlUrl: r.html_url,
        }));
      return {
        bill: {
          identifier: bill.identifier,
          title: bill.title,
          latestActionDate: bill.latestActionDate,
        },
        gao,
        crs,
      };
    }).filter((a) => a.gao.length > 0 || a.crs.length > 0);

    return {
      attachments,
      totalBills: tracked.bills.length,
      totalReports: gaoRows.length + crsRows.length,
    };
  }

  /**
   * Today's calendar feed for the home dashboard. Aggregates:
   *  - Congressional hearings on date=today
   *  - Federal Register comment-period deadlines closing today (tenant-filtered)
   *  - Critical/notable intel changes detected in the last 24h that relate to tenant clients
   * Returns chronologically sorted events with severity counts.
   */
  async getTodayTimeline(tenantId: string) {
    const now = new Date();
    // ET day bounds for timestamp columns; UTC-midnight bounds for @db.Date columns.
    const { start: startOfDay, end: endOfDay } = dayBoundsInZone(now, 'America/New_York');
    const dateBounds = dateBoundsInZone(now, 'America/New_York');
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [hearings, deadlines, changes, clientIds] = await Promise.all([
      this.prisma.committeeHearing.findMany({
        where: { date: { gte: dateBounds.start, lte: dateBounds.end } },
        orderBy: { time: 'asc' },
        take: 30,
      }),
      this.prisma.federalRegisterDocument.findMany({
        where: {
          type: { in: ['PROPOSED_RULE', 'RULE'] },
          commentEndDate: { gte: dateBounds.start, lte: dateBounds.end },
        },
        orderBy: { commentEndDate: 'asc' },
        take: 20,
      }),
      this.prisma.intelligenceChange.findMany({
        where: {
          detectedAt: { gte: last24h },
          severity: { in: ['critical', 'notable', 'info'] },
        },
        orderBy: { detectedAt: 'desc' },
        take: 30,
      }),
      this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findMany({ where: { status: { not: 'archived' } }, select: { id: true } }),
      ),
    ]);

    const tenantClientIds = new Set(clientIds.map((c) => c.id));

    type TimelineEvent = {
      id: string;
      kind: 'hearing' | 'deadline' | 'change' | 'brief';
      label: string;
      title: string;
      detail: string | null;
      severity: 'info' | 'notable' | 'critical';
      time: string | null;
      timestamp: string;
      href: string | null;
    };

    const events: TimelineEvent[] = [];

    for (const h of hearings) {
      const isMarkup = h.type === 'markup';
      events.push({
        id: `hearing-${h.id}`,
        kind: 'hearing',
        label: isMarkup ? 'MARKUP' : 'HEARING',
        title: `${h.committeeName} — ${h.title}`,
        detail: h.location ?? h.witnesses.slice(0, 3).join(', ') ?? null,
        severity: isMarkup ? 'notable' : 'info',
        time: h.time ?? null,
        timestamp: h.date.toISOString(),
        href: h.url ?? null,
      });
    }

    for (const d of deadlines) {
      events.push({
        id: `deadline-${d.id}`,
        kind: 'deadline',
        label: 'COMMENT DEADLINE',
        title: d.title,
        detail: d.agencyNames.slice(0, 2).join(' / '),
        severity: 'critical',
        time: 'before EOD',
        timestamp: (d.commentEndDate ?? endOfDay).toISOString(),
        href: d.htmlUrl ?? null,
      });
    }

    for (const c of changes) {
      // Three states:
      //   neutral     = relatedClientIds empty → general market signal, include
      //   tenantTouch = at least one related client belongs to this tenant → include
      //   foreign     = relatedClientIds only references other tenants → EXCLUDE
      //                 (descriptions can include the matched client's name)
      const isNeutral = c.relatedClientIds.length === 0;
      const touchesTenant =
        !isNeutral && c.relatedClientIds.some((id) => tenantClientIds.has(id));
      if (!isNeutral && !touchesTenant) continue;
      events.push({
        id: `change-${c.id}`,
        kind: 'change',
        label: c.source.toUpperCase().slice(0, 16),
        title: c.title,
        detail: c.description ? c.description.slice(0, 160) : null,
        severity: (c.severity as TimelineEvent['severity']) ?? 'info',
        time: null,
        timestamp: c.detectedAt.toISOString(),
        href: null,
      });
    }

    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const counts = { critical: 0, notable: 0, info: 0 };
    for (const e of events) counts[e.severity]++;

    return { events, counts, today: startOfDay.toISOString() };
  }

  /**
   * Live ticker: most recent intel changes for the right-rail feed.
   * Tenant-aware — prefers changes touching this tenant's clients, falls back
   * to TENANT-NEUTRAL recent changes (empty relatedClientIds) to keep the feed
   * populated. Never returns changes that touch other tenants' clients —
   * those rows include client names in their description and would leak across
   * tenants if returned.
   */
  async getLiveTicker(tenantId: string, limit = 12) {
    const clientIds = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findMany({ where: { status: { not: 'archived' } }, select: { id: true } }),
    );
    const tenantClientIds = clientIds.map((c) => c.id);

    const tenantChanges = tenantClientIds.length
      ? await this.prisma.intelligenceChange.findMany({
          where: { relatedClientIds: { hasSome: tenantClientIds } },
          orderBy: { detectedAt: 'desc' },
          take: limit,
        })
      : [];

    let items = tenantChanges;
    if (items.length < limit) {
      const fill = await this.prisma.intelligenceChange.findMany({
        where: {
          id: { notIn: items.map((i) => i.id) },
          relatedClientIds: { isEmpty: true },
        },
        orderBy: { detectedAt: 'desc' },
        take: limit - items.length,
      });
      items = [...items, ...fill];
    }

    return items.map((c) => ({
      id: c.id,
      source: c.source,
      title: c.title,
      severity: c.severity,
      detectedAt: c.detectedAt.toISOString(),
    }));
  }

  /**
   * Coming Up: next-7-day forward calendar for the home dashboard.
   * Aggregates hearings + comment-period closes opening tomorrow through +7d,
   * picks the 3 highest-leverage items. Sorted by date ascending.
   * Tomorrow is computed in ET to match the dashboard's "all times ET" framing.
   */
  async getComingUp(tenantId: string) {
    const now = new Date();
    // Both `hearing.date` and `comment_end_date` come back at UTC midnight;
    // bounds must also be UTC midnight to include rows on the boundary day.
    const tomorrowStart = addDateInZone(now, 1, 'America/New_York');
    const sevenDaysOut = new Date(tomorrowStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [hearings, deadlines, clientIds] = await Promise.all([
      this.prisma.committeeHearing.findMany({
        where: { date: { gte: tomorrowStart, lte: sevenDaysOut } },
        orderBy: { date: 'asc' },
        take: 30,
      }),
      this.prisma.federalRegisterDocument.findMany({
        where: {
          type: { in: ['PROPOSED_RULE', 'RULE'] },
          commentEndDate: { gte: tomorrowStart, lte: sevenDaysOut },
        },
        orderBy: { commentEndDate: 'asc' },
        take: 20,
      }),
      this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findMany({ where: { status: { not: 'archived' } }, select: { id: true } }),
      ),
    ]);
    // tenantClientIds reserved for future relevance ranking
    void clientIds;

    type ComingUpItem = {
      id: string;
      kind: 'hearing' | 'markup' | 'deadline';
      label: string;
      title: string;
      detail: string | null;
      severity: 'info' | 'notable' | 'critical';
      date: string;
      time: string | null;
      href: string | null;
    };

    const items: ComingUpItem[] = [];

    for (const h of hearings) {
      const isMarkup = h.type === 'markup';
      items.push({
        id: `hearing-${h.id}`,
        kind: isMarkup ? 'markup' : 'hearing',
        label: isMarkup ? 'MARKUP' : 'HEARING',
        title: `${h.committeeName} — ${h.title}`,
        detail: h.location ?? null,
        severity: isMarkup ? 'critical' : 'notable',
        date: h.date.toISOString(),
        time: h.time ?? null,
        href: h.url ?? null,
      });
    }

    for (const d of deadlines) {
      items.push({
        id: `deadline-${d.id}`,
        kind: 'deadline',
        label: 'DEADLINE',
        title: d.title,
        detail: d.agencyNames.slice(0, 2).join(' / '),
        severity: 'notable',
        date: (d.commentEndDate ?? sevenDaysOut).toISOString(),
        time: 'before EOD',
        href: d.htmlUrl ?? null,
      });
    }

    items.sort((a, b) => a.date.localeCompare(b.date));

    const SEVERITY_RANK: Record<ComingUpItem['severity'], number> = {
      critical: 3,
      notable: 2,
      info: 1,
    };
    const top = [...items]
      .sort((a, b) => {
        const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (sev !== 0) return sev;
        return a.date.localeCompare(b.date);
      })
      .slice(0, 3)
      .sort((a, b) => a.date.localeCompare(b.date));

    return { items: top, totalThisWeek: items.length };
  }

  /**
   * Portfolio summary — six numbers for the Portfolio list stat strip.
   * All cheap counts; LDA spend is summed across clients with confirmed
   * mappings using current-quarter filings.
   */
  async getPortfolioSummary(tenantId: string) {
    const now = new Date();
    const quarterStart = startOfQuarter(now);

    const [clients, mappings] = await Promise.all([
      this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findMany({
          where: { status: { not: 'archived' } },
          select: { id: true, profileStatus: true },
        }),
      ),
      this.prisma.clientIntelMapping.findMany({
        where: { confirmed: true, source: 'lda' },
        select: { clientId: true, externalId: true },
      }),
    ]);

    const tenantClientIds = new Set(clients.map((c) => c.id));
    const tenantLdaIds = mappings
      .filter((m) => tenantClientIds.has(m.clientId))
      .map((m) => Number(m.externalId))
      .filter((n) => Number.isFinite(n));

    const needAttention = clients.filter(
      (c) => c.profileStatus === 'PAUSED' || c.profileStatus === 'MONITORING',
    ).length;

    const [workflowsOpen, ldaSpendRows, billsTracked, regulationsTracked] = await Promise.all([
      // workflow_instance has no RLS policy; explicit tenantId filter required
      // even inside withTenant(). Mirrors workflows.service.ts list() pattern.
      this.prisma.workflowInstance.count({
        where: { tenantId, status: { notIn: ['complete', 'cancelled'] } },
      }),
      tenantLdaIds.length
        ? this.prisma.$queryRaw<Array<{ total: string | null }>>`
            SELECT COALESCE(SUM(income), 0)::text AS total
            FROM lda_filing
            WHERE client_id = ANY(${tenantLdaIds}::int[])
              AND dt_posted >= ${quarterStart}
          `
        : Promise.resolve([{ total: '0' }]),
      tenantLdaIds.length
        ? this.prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(DISTINCT b.id)::bigint AS count
            FROM congress_bill b
            JOIN congress_bill_subject s ON s.bill_id = b.id
            WHERE lower(b.latest_action_text) NOT LIKE '%became public law%'
              AND lower(b.latest_action_text) NOT LIKE '%vetoed%'
              AND s.name ILIKE ANY(
                ARRAY(
                  SELECT DISTINCT name FROM lda_issue_code
                  WHERE code = ANY(
                    SELECT DISTINCT unnest(issue_codes)
                    FROM lda_client
                    WHERE id = ANY(${tenantLdaIds}::int[])
                  )
                )
              )
          `
        : Promise.resolve([{ count: 0n }]),
      this.prisma.federalRegisterDocument.count({
        where: {
          type: { in: ['PROPOSED_RULE', 'RULE'] },
          commentEndDate: { gt: now },
        },
      }),
    ]);

    // LDA `income` is stored as Decimal dollars (not cents); SUM returns a
    // numeric string via the text cast, parsed back to a plain JS number.
    const ldaSpendDollars = Number(ldaSpendRows[0]?.total ?? '0');
    const billsTrackedCount = Number(billsTracked[0]?.count ?? 0n);

    return {
      activeClients: clients.length,
      openWorkflows: workflowsOpen,
      needAttention,
      ldaSpendQtd: ldaSpendDollars,
      billsTracked: billsTrackedCount,
      activeRegulations: regulationsTracked,
    };
  }
}

function startOfQuarter(now: Date): Date {
  const month = now.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  return new Date(now.getFullYear(), quarterStartMonth, 1);
}
