import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { confidenceBand } from '../matching/program-match-thresholds.js';

/** Decisions a reviewer can make on a PeProgramMatch (Step 2.1 review queue). */
export type ProgramMatchDecision = 'accept' | 'reject' | 'quarantine';

export interface ResolveProgramMatchInput {
  decision: ProgramMatchDecision;
  notes?: string;
}

/**
 * Build the "Why-shown" evidence summary line from the evidence jsonb, e.g.
 * "project title exact match + R-2A p.144 + P-1 line 027" (plan §7 UI criterion).
 */
function buildWhyShown(evidence: unknown): string {
  if (!Array.isArray(evidence)) return '';
  const parts: string[] = [];
  for (const item of evidence as Array<Record<string, unknown>>) {
    const kind = typeof item.kind === 'string' ? item.kind : '';
    const page = typeof item.pageNumber === 'number' ? ` p.${item.pageNumber}` : '';
    const quote = typeof item.quote === 'string' ? item.quote : '';
    if (kind === 'mdap_curated') parts.push('curated MDAP map');
    else if (kind === 'other_funding_link') parts.push(`shared P-1 line${page}`);
    else if (kind.startsWith('alias_trigram')) parts.push(quote || 'alias match');
    else if (quote) parts.push(`${quote}${page}`);
    else if (kind) parts.push(`${kind}${page}`);
  }
  return parts.join(' + ');
}

/**
 * Programs read + review API (Step 2.1). The Program graph tables (program,
 * program_alias, pe_program_match) are GLOBAL reference data (no tenant_id / RLS),
 * same as program_element. The review-queue list/resolve are capiro_admin only
 * (gated at the controller) and write an AuditLog inside withTenant (mirrors
 * resolvePersonCandidate / resolveReconciliation).
 */
@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /programs?q= — alias search (trigram), returns programs ranked by best alias similarity. */
  async searchPrograms(q: string | undefined, limitRaw?: number) {
    const limit = Math.min(Math.max(limitRaw ?? 25, 1), 100);
    const query = (q ?? '').trim();
    if (!query) {
      const rows = await this.prisma.program.findMany({
        orderBy: { canonicalName: 'asc' },
        take: limit,
        select: { id: true, canonicalName: true, component: true, mdapCode: true, status: true },
      });
      return { data: rows, total: rows.length, q: '' };
    }

    // Normalize to the alias_normalized form (upper, punctuation-stripped) so the
    // trigram operators hit the program_alias_normalized_trgm_idx GIN index.
    const norm = query
      .toUpperCase()
      .replace(/[‐-―−]/g, '-')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    type Row = {
      id: string;
      canonicalName: string;
      component: string | null;
      mdapCode: string | null;
      status: string;
      bestAlias: string;
      sim: number;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.id,
             p.canonical_name      AS "canonicalName",
             p.component,
             p.mdap_code           AS "mdapCode",
             p.status,
             a.alias               AS "bestAlias",
             MAX(similarity(a.alias_normalized, ${norm})) AS "sim"
      FROM program p
      JOIN program_alias a ON a.program_id = p.id
      WHERE a.alias_normalized % ${norm}
      GROUP BY p.id, p.canonical_name, p.component, p.mdap_code, p.status, a.alias
      ORDER BY "sim" DESC, p.canonical_name ASC
      LIMIT ${limit}
    `);

    // Collapse to one row per program (best-matching alias wins).
    const byProgram = new Map<string, Row>();
    for (const r of rows) {
      const prev = byProgram.get(r.id);
      if (!prev || r.sim > prev.sim) byProgram.set(r.id, r);
    }
    const data = Array.from(byProgram.values()).sort((x, y) => y.sim - x.sim);
    return { data, total: data.length, q: query };
  }

  /**
   * GET /programs/:id — program profile: aliases, accepted PE matches (+ titles),
   * awards via mdapCode, performers across linked PEs. Candidates are returned in a
   * separate bucket flagged for review; quarantined matches are NEVER surfaced.
   */
  async getProgram(id: string) {
    const program = await this.prisma.program.findUnique({ where: { id } });
    if (!program) throw new NotFoundException(`Program ${id} not found`);

    const [aliases, matches] = await Promise.all([
      this.prisma.programAlias.findMany({
        where: { programId: id },
        orderBy: [{ aliasType: 'asc' }, { confidence: 'desc' }],
        select: { id: true, alias: true, aliasType: true, source: true, sourceUrl: true, confidence: true },
      }),
      this.prisma.peProgramMatch.findMany({
        // Quarantined/rejected are never surfaced on the profile.
        where: { programId: id, status: { in: ['accepted', 'candidate'] } },
        orderBy: [{ status: 'asc' }, { score: 'desc' }],
      }),
    ]);

    const peCodes = Array.from(new Set(matches.map((m) => m.peCode)));
    const pes = await this.prisma.programElement.findMany({
      where: { peCode: { in: peCodes } },
      select: { peCode: true, title: true, service: true },
    });
    const peByCode = new Map(pes.map((p) => [p.peCode, p]));

    const decorate = (m: (typeof matches)[number]) => ({
      id: m.id,
      peCode: m.peCode,
      projectCode: m.projectCode,
      programElement: peByCode.get(m.peCode) ?? null,
      score: m.score,
      confidenceBand: confidenceBand(m.score),
      evidenceTier: m.evidenceTier,
      status: m.status,
      whyShown: buildWhyShown(m.evidence),
      evidence: m.evidence,
      resolvedAt: m.resolvedAt,
    });

    const accepted = matches.filter((m) => m.status === 'accepted').map(decorate);
    const candidates = matches.filter((m) => m.status === 'candidate').map(decorate);

    // Awards via the MDAP code (kept on program_element_acquisition_program / federal_award).
    const awards = program.mdapCode
      ? await this.prisma.federalAward.findMany({
          where: { dodAcqProgramCode: program.mdapCode },
          orderBy: { actionDate: 'desc' },
          take: 50,
          select: {
            id: true,
            contractorName: true,
            amount: true,
            piid: true,
            actionDate: true,
            awardingAgency: true,
            peCode: true,
          },
        })
      : [];

    // Named primes (R-3) across the accepted PEs.
    const acceptedPeCodes = accepted.map((m) => m.peCode);
    const performers = acceptedPeCodes.length
      ? await this.prisma.programElementPerformer.findMany({
          where: { peCode: { in: acceptedPeCodes }, isNamedCompany: true },
          orderBy: { totalCostM: 'desc' },
          take: 50,
          select: { id: true, peCode: true, performer: true, totalCostM: true, sourceUrl: true, pageNumber: true },
        })
      : [];

    return {
      id: program.id,
      canonicalName: program.canonicalName,
      component: program.component,
      capabilityArea: program.capabilityArea,
      acquisitionPathway: program.acquisitionPathway,
      mdapCode: program.mdapCode,
      description: program.description,
      status: program.status,
      aliases,
      acceptedMatches: accepted,
      candidateMatches: candidates,
      awards,
      performers,
    };
  }

  /**
   * Admin review queue: list candidate / quarantined PeProgramMatch rows with the PE
   * title + program name decorated for the reviewer, plus the Why-shown evidence line.
   * weakSignal (<0.50) rows are EXCLUDED — they are never surfaced.
   */
  async listMatchQueue(statusRaw: string | undefined, pageRaw?: number, limitRaw?: number) {
    const status = statusRaw ?? 'candidate';
    const page = Math.max(pageRaw ?? 1, 1);
    const limit = Math.min(Math.max(limitRaw ?? 50, 1), 200);

    const where: Prisma.PeProgramMatchWhereInput =
      status === 'all'
        ? { status: { in: ['candidate', 'quarantined'] }, weakSignal: false }
        : status === 'quarantined'
          ? { status: 'quarantined', weakSignal: false }
          : { status };

    const [total, rows] = await Promise.all([
      this.prisma.peProgramMatch.count({ where }),
      this.prisma.peProgramMatch.findMany({
        where,
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const peCodes = Array.from(new Set(rows.map((r) => r.peCode)));
    const programIds = Array.from(new Set(rows.map((r) => r.programId)));
    const [pes, programs] = await Promise.all([
      this.prisma.programElement.findMany({
        where: { peCode: { in: peCodes } },
        select: { peCode: true, title: true, service: true },
      }),
      this.prisma.program.findMany({
        where: { id: { in: programIds } },
        select: { id: true, canonicalName: true, component: true, mdapCode: true },
      }),
    ]);
    const peByCode = new Map(pes.map((p) => [p.peCode, p]));
    const programById = new Map(programs.map((p) => [p.id, p]));

    return {
      data: rows.map((r) => ({
        id: r.id,
        peCode: r.peCode,
        projectCode: r.projectCode,
        programId: r.programId,
        score: r.score,
        confidenceBand: confidenceBand(r.score),
        evidenceTier: r.evidenceTier,
        status: r.status,
        matchBasis: r.matchBasis,
        whyShown: buildWhyShown(r.evidence),
        evidence: r.evidence,
        programElement: peByCode.get(r.peCode) ?? null,
        program: programById.get(r.programId) ?? null,
        createdAt: r.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Resolve a PeProgramMatch (capiro_admin only — gated at the controller):
   *   - accept     -> status 'accepted'
   *   - reject     -> status 'rejected'
   *   - quarantine -> status 'quarantined'
   * Records resolvedByUserId / resolvedAt / decisionNotes and an AuditLog inside
   * withTenant (mirrors resolvePersonCandidate / resolveReconciliation). A curated
   * seed row (evidenceTier='mdap_curated') is protected from being rejected here —
   * reject the seed via the curation map, not the review queue.
   */
  async resolveMatch(id: string, input: ResolveProgramMatchInput, ctx: TenantContext) {
    const match = await this.prisma.peProgramMatch.findUnique({ where: { id } });
    if (!match) throw new NotFoundException(`PeProgramMatch ${id} not found`);

    const nextStatus =
      input.decision === 'accept' ? 'accepted' : input.decision === 'reject' ? 'rejected' : 'quarantined';

    if (match.evidenceTier === 'mdap_curated' && nextStatus !== 'accepted') {
      throw new BadRequestException(
        'Curated MDAP seed matches cannot be rejected/quarantined via the review queue; edit the curation map instead.',
      );
    }
    if (match.status === nextStatus) {
      // No-op transition (idempotent) — still record who confirmed it.
      // Fall through to write resolution metadata.
    }

    await this.prisma.peProgramMatch.update({
      where: { id },
      data: {
        status: nextStatus,
        // Accept clears the weak-signal flag (it is no longer "never surface"); the
        // reviewer has explicitly promoted it.
        weakSignal: nextStatus === 'accepted' ? false : match.weakSignal,
        resolvedByUserId: ctx.userId,
        resolvedAt: new Date(),
        decisionNotes: input.notes?.trim() || null,
      },
    });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program.match.resolve',
          entityType: 'pe_program_match',
          entityId: id,
          before: { status: match.status, score: match.score, evidenceTier: match.evidenceTier },
          after: {
            decision: input.decision,
            status: nextStatus,
            peCode: match.peCode,
            projectCode: match.projectCode,
            programId: match.programId,
            notes: input.notes ?? null,
          },
        },
      });
    });

    return { resolved: true as const, id, status: nextStatus, decision: input.decision };
  }
}
