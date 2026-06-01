import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// ── Stage A/B raw row from SQL ───────────────────────────────────────────────
interface MatchRow {
  external_id: string;
  external_name: string;
  similarity: number;
  state?: string | null;
}

// ── Scored candidate after Stage B+C ────────────────────────────────────────
interface CandidateMatch {
  source: string;
  externalId: string;
  externalName: string;
  rawSimilarity: number;
  confidence: number;
}

export interface ResolutionSummary {
  totalClients: number;
  mappingsCreated: number;
  autoConfirmed: number;
  needsReview: number;
}

// Suffixes stripped during fingerprinting (word-boundary, case-insensitive).
const SUFFIX_RE =
  /\b(inc|llc|corp|ltd|co|lp|llp|pa|pc|pllc|group|holdings|international|associates|partners|consulting|services|solutions|technologies|enterprises)\b\.?/gi;

// Minimum confidence required to persist a candidate mapping. The per-source SQL
// uses a loose similarity > 0.3 to cast a wide net, but writing everything above
// that floods the review queue with generic-string noise (e.g. employer
// "services" fuzzy-matching dozens of clients). Only candidates clearing this
// floor are written; the rest are dropped before they reach the review queue.
const MIN_WRITE_CONFIDENCE = 0.4;

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Stage B: Fingerprint ──────────────────────────────────────────────────

  fingerprint(name: string): string {
    return name
      .toLowerCase()
      .replace(SUFFIX_RE, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Stage C: Score a candidate ────────────────────────────────────────────

  private scoreCandidate(
    clientFp: string,
    row: MatchRow,
  ): number {
    let confidence = row.similarity;

    // Fingerprint match boost: if raw similarity is in the ambiguous 0.3-0.6
    // band and fingerprints match exactly, treat it as a strong signal.
    if (confidence >= 0.3 && confidence < 0.6) {
      const externalFp = this.fingerprint(row.external_name);
      if (clientFp === externalFp) {
        confidence = Math.max(confidence, 0.70);
      }
    }

    return Math.min(confidence, 1.0);
  }

  // ── Stage A: Fuzzy match per source ──────────────────────────────────────

  private async matchLda(clientName: string): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT id::text AS external_id, name AS external_name,
             similarity(name, ${clientName}) AS similarity,
             state
      FROM lda_client
      WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 50
    `;
  }

  private async matchContractor(clientName: string): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT id::text AS external_id, name AS external_name,
             similarity(name, ${clientName}) AS similarity,
             NULL::text AS state
      FROM federal_contractor
      WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 50
    `;
  }

  private async matchSec(clientName: string): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT DISTINCT ON (cik) cik AS external_id, company_name AS external_name,
             similarity(company_name, ${clientName}) AS similarity,
             state_of_incorp AS state
      FROM sec_filing
      WHERE similarity(company_name, ${clientName}) > 0.3
      ORDER BY cik, similarity(company_name, ${clientName}) DESC
      LIMIT 50
    `;
  }

  private async matchFec(clientName: string): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT contributor_employer AS external_id,
             contributor_employer AS external_name,
             similarity(contributor_employer, ${clientName}) AS similarity,
             NULL::text AS state
      FROM (SELECT DISTINCT contributor_employer FROM fec_contribution WHERE contributor_employer IS NOT NULL) t
      WHERE similarity(contributor_employer, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 50
    `;
  }

  /**
   * Match a client to its OWN PAC committee (FecCommittee). PAC names are noisy
   * ("BOEING COMPANY PAC", "EMPLOYEES OF X POLITICAL ACTION COMMITTEE"), so we
   * strip PAC-specific noise words before scoring. Source 'fec_committee' powers
   * the Schedule B PAC-giving sync; because attributing an org's PAC is compliance-
   * sensitive, these are scored conservatively and NEVER auto-confirmed (see
   * scoreCommittee) — a human must confirm in the mappings review UI.
   */
  private async matchFecCommittee(clientName: string): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT id AS external_id,
             name AS external_name,
             similarity(
               regexp_replace(
                 lower(name),
                 '\\m(pac|political action committee|employees?|company|corp|inc|fund|for|of|the)\\M',
                 ' ', 'g'
               ),
               lower(${clientName})
             ) AS similarity,
             state
      FROM fec_committee
      WHERE committee_type IN ('Q', 'N', 'O', 'V', 'W')  -- PAC-type committees
        AND similarity(
              regexp_replace(
                lower(name),
                '\\m(pac|political action committee|employees?|company|corp|inc|fund|for|of|the)\\M',
                ' ', 'g'
              ),
              lower(${clientName})
            ) > 0.35
      ORDER BY similarity DESC
      LIMIT 25
    `;
  }

  private async matchFara(clientName: string): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT registration_number AS external_id, registrant_name AS external_name,
             similarity(registrant_name, ${clientName}) AS similarity,
             state
      FROM fara_registration
      WHERE similarity(registrant_name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 50
    `;
  }

  private async matchLobbyIntel(clientName: string): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT id::text AS external_id, name AS external_name,
             similarity(name, ${clientName}) AS similarity,
             state
      FROM lobby_intel_mv
      WHERE similarity(name, ${clientName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 50
    `;
  }

  // ── Public: resolve a single client ──────────────────────────────────────

  async resolveClient(clientId: string, clientName: string): Promise<void> {
    const clientFp = this.fingerprint(clientName);

    const [ldaRows, contractorRows, secRows, fecRows, fecCommitteeRows, faraRows, lobbyRows] =
      await Promise.all([
        this.matchLda(clientName),
        this.matchContractor(clientName),
        this.matchSec(clientName),
        this.matchFec(clientName),
        this.matchFecCommittee(clientName),
        this.matchFara(clientName),
        this.matchLobbyIntel(clientName),
      ]);

    const allCandidates: CandidateMatch[] = [
      ...ldaRows.map((r) => ({
        source: 'lda',
        externalId: r.external_id,
        externalName: r.external_name,
        rawSimilarity: r.similarity,
        confidence: this.scoreCandidate(clientFp, r),
      })),
      ...fecCommitteeRows.map((r) => ({
        source: 'fec_committee',
        externalId: r.external_id,
        externalName: r.external_name,
        rawSimilarity: r.similarity,
        confidence: this.scoreCandidate(clientFp, r),
      })),
      ...contractorRows.map((r) => ({
        source: 'contracting',
        externalId: r.external_id,
        externalName: r.external_name,
        rawSimilarity: r.similarity,
        confidence: this.scoreCandidate(clientFp, r),
      })),
      ...secRows.map((r) => ({
        source: 'sec',
        externalId: r.external_id,
        externalName: r.external_name,
        rawSimilarity: r.similarity,
        confidence: this.scoreCandidate(clientFp, r),
      })),
      ...fecRows.map((r) => ({
        source: 'fec_employer',
        externalId: r.external_id,
        externalName: r.external_name,
        rawSimilarity: r.similarity,
        confidence: this.scoreCandidate(clientFp, r),
      })),
      ...faraRows.map((r) => ({
        source: 'fara',
        externalId: r.external_id,
        externalName: r.external_name,
        rawSimilarity: r.similarity,
        confidence: this.scoreCandidate(clientFp, r),
      })),
      ...lobbyRows.map((r) => ({
        source: 'lobby_intel',
        externalId: r.external_id,
        externalName: r.external_name,
        rawSimilarity: r.similarity,
        confidence: this.scoreCandidate(clientFp, r),
      })),
    ];

    for (const candidate of allCandidates) {
      // Stage D thresholds. PAC committee attribution is compliance-sensitive:
      // never auto-confirm fec_committee — always route to human review.
      const autoConfirm = candidate.source !== 'fec_committee' && candidate.confidence >= 0.85;

      // Drop low-confidence candidates before they reach the review queue.
      if (candidate.confidence < MIN_WRITE_CONFIDENCE && !autoConfirm) continue;

      const updateData: {
        externalName: string;
        confidence: number;
        confirmed?: boolean;
      } = {
        externalName: candidate.externalName,
        confidence: candidate.confidence,
      };
      if (autoConfirm) updateData.confirmed = true;

      await this.prisma.clientIntelMapping.upsert({
        where: {
          clientId_source_externalId: {
            clientId,
            source: candidate.source,
            externalId: candidate.externalId,
          },
        },
        update: updateData,
        create: {
          clientId,
          source: candidate.source,
          externalId: candidate.externalId,
          externalName: candidate.externalName,
          confidence: candidate.confidence,
          confirmed: autoConfirm,
        },
      });
    }
  }

  // ── Public: resolve all clients for a tenant ──────────────────────────────

  async resolveAllForTenant(tenantId: string): Promise<ResolutionSummary> {
    const clients = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findMany({ select: { id: true, name: true } }),
    );

    let mappingsCreated = 0;
    let autoConfirmed = 0;
    let needsReview = 0;

    for (const client of clients) {
      const clientFp = this.fingerprint(client.name);
      const [ldaRows, contractorRows, secRows, fecRows, fecCommitteeRows, faraRows, lobbyRows] =
        await Promise.all([
          this.matchLda(client.name),
          this.matchContractor(client.name),
          this.matchSec(client.name),
          this.matchFec(client.name),
          this.matchFecCommittee(client.name),
          this.matchFara(client.name),
          this.matchLobbyIntel(client.name),
        ]);

      const sourceGroups: { source: string; rows: MatchRow[] }[] = [
        { source: 'lda', rows: ldaRows },
        { source: 'contracting', rows: contractorRows },
        { source: 'sec', rows: secRows },
        { source: 'fec_employer', rows: fecRows },
        { source: 'fec_committee', rows: fecCommitteeRows },
        { source: 'fara', rows: faraRows },
        { source: 'lobby_intel', rows: lobbyRows },
      ];

      for (const { source, rows } of sourceGroups) {
        for (const row of rows) {
          const confidence = this.scoreCandidate(clientFp, row);
          // PAC committee attribution is compliance-sensitive: never auto-confirm,
          // always route to human review regardless of score.
          const autoConfirm = source !== 'fec_committee' && confidence >= 0.85;

          // Drop low-confidence candidates before they reach the review queue.
          if (confidence < MIN_WRITE_CONFIDENCE && !autoConfirm) continue;

          const updateData: {
            externalName: string;
            confidence: number;
            confirmed?: boolean;
          } = {
            externalName: row.external_name,
            confidence,
          };
          if (autoConfirm) updateData.confirmed = true;

          await this.prisma.clientIntelMapping.upsert({
            where: {
              clientId_source_externalId: {
                clientId: client.id,
                source,
                externalId: row.external_id,
              },
            },
            update: updateData,
            create: {
              clientId: client.id,
              source,
              externalId: row.external_id,
              externalName: row.external_name,
              confidence,
              confirmed: autoConfirm,
            },
          });

          mappingsCreated++;
          if (autoConfirm) autoConfirmed++;
          else needsReview++;
        }
      }
    }

    this.logger.log(
      `resolveAllForTenant(${tenantId}): ${clients.length} clients, ${mappingsCreated} mappings, ${autoConfirmed} auto-confirmed`,
    );

    return {
      totalClients: clients.length,
      mappingsCreated,
      autoConfirmed,
      needsReview,
    };
  }
}
