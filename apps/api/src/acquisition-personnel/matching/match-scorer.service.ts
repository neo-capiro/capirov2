import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { normalizeName } from '../normalization/name-normalizer.js';
import { MatchResult } from '../types.js';

type CandidateRow = {
  id: string;
  nameKey: string;
  organization: string | null;
  title: string | null;
  emailDomain: string | null;
  programOfRecord: string | null;
  pePrimary: string | null;
  peSecondary: string[];
  nameSimilarity: number;
};

@Injectable()
export class MatchScorerService {
  constructor(private readonly prisma?: PrismaService) {}

  async findMatches(candidate: {
    fullName: string;
    organization?: string;
    title?: string;
    emailDomain?: string;
    programs?: string[];
    peCodesMentioned?: string[];
  }): Promise<MatchResult[]> {
    if (!this.prisma) return [];

    const nameKey = normalizeName(candidate.fullName).nameKey;
    if (!nameKey) return [];

    const rows = await this.prisma.$queryRawUnsafe<CandidateRow[]>(
      `
      SELECT
        id,
        name_key AS "nameKey",
        organization,
        title,
        email_domain AS "emailDomain",
        program_of_record AS "programOfRecord",
        pe_primary AS "pePrimary",
        pe_secondary AS "peSecondary",
        similarity(name_key, $1) AS "nameSimilarity"
      FROM acquisition_personnel
      WHERE name_key % $1
      ORDER BY similarity(name_key, $1) DESC
      LIMIT 40
      `,
      nameKey,
    );

    const results: MatchResult[] = rows
      .map((row) => {
        const orgSimilarity = this.orgSimilarity(candidate.organization, row.organization);
        const titleCompatibility = this.titleCompatibility(candidate.title, row.title);
        const emailDomainMatch = this.emailDomainMatch(candidate.emailDomain, row.emailDomain);
        const candidatePrograms = [...(candidate.programs ?? []), ...(candidate.peCodesMentioned ?? [])];
        const rowPrograms = [row.programOfRecord ?? '', row.pePrimary ?? '', ...(row.peSecondary ?? [])];
        const programOverlap = this.jaccardOverlap(candidatePrograms, rowPrograms);

        const score = this.capScore(
          row.nameSimilarity * 0.58 +
            orgSimilarity * 0.17 +
            titleCompatibility * 0.13 +
            emailDomainMatch * 0.07 +
            programOverlap * 0.05,
        );

        return {
          personId: row.id,
          score,
          breakdown: {
            nameSimilarity: this.capScore(row.nameSimilarity),
            orgSimilarity,
            titleCompatibility,
            emailDomainMatch,
            programOverlap,
          },
          reason: this.reason(score),
        } satisfies MatchResult;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return results;
  }

  jaccardOverlap(setA: Iterable<string>, setB: Iterable<string>): number {
    const a = new Set(Array.from(setA).map((v) => v.toLowerCase().trim()).filter(Boolean));
    const b = new Set(Array.from(setB).map((v) => v.toLowerCase().trim()).filter(Boolean));
    if (a.size === 0 || b.size === 0) return 0;
    const aVals = Array.from(a);
    const bVals = Array.from(b);
    const intersection = new Set(aVals.filter((x) => b.has(x))).size;
    const union = new Set([...aVals, ...bVals]).size;
    return union === 0 ? 0 : intersection / union;
  }

  async pgTrgmSimilarity(a: string, b: string): Promise<number> {
    if (!this.prisma) return 0;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ s: number }>>(
      `SELECT similarity($1, $2) AS s`,
      a,
      b,
    );
    return this.capScore(rows[0]?.s ?? 0);
  }

  private orgSimilarity(candidateOrg?: string, rowOrg?: string | null): number {
    if (!candidateOrg || !rowOrg) return 0;
    const left = this.normalizeToken(candidateOrg);
    const right = this.normalizeToken(rowOrg);
    if (!left || !right) return 0;
    if (left === right) return 1;
    const leftTokens = new Set(left.split(' ').filter(Boolean));
    const rightTokens = new Set(right.split(' ').filter(Boolean));
    return this.jaccardOverlap(leftTokens, rightTokens);
  }

  private titleCompatibility(candidateTitle?: string, rowTitle?: string | null): number {
    if (!candidateTitle || !rowTitle) return 0;
    const left = this.normalizeToken(candidateTitle);
    const right = this.normalizeToken(rowTitle);
    if (!left || !right) return 0;
    if (left === right) return 1;
    const leftTokens = new Set(left.split(' ').filter(Boolean));
    const rightTokens = new Set(right.split(' ').filter(Boolean));
    return this.jaccardOverlap(leftTokens, rightTokens);
  }

  private emailDomainMatch(candidateDomain?: string, rowDomain?: string | null): number {
    if (!candidateDomain || !rowDomain) return 0;
    return candidateDomain.trim().toLowerCase() === rowDomain.trim().toLowerCase() ? 1 : 0;
  }

  private normalizeToken(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private capScore(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private reason(score: number): string {
    if (score >= 0.92) return 'high-confidence duplicate';
    if (score >= 0.7) return 'review candidate';
    return 'low confidence';
  }
}
