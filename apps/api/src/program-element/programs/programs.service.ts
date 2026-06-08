import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { confidenceBand } from '../matching/program-match-thresholds.js';
import { PeProgramMatcherService } from '../matching/pe-program-matcher.service.js';

/** Decisions a reviewer can make on a PeProgramMatch (Step 2.1 review queue). */
export type ProgramMatchDecision = 'accept' | 'reject' | 'quarantine';

export interface ResolveProgramMatchInput {
  decision: ProgramMatchDecision;
  notes?: string;
}

/** Body for POST /programs/admin/:programId/aliases (Step 3.5 alias manager). */
export interface CreateAliasInput {
  alias: string;
  aliasType: string;
  source?: string;
}

/** Body for PATCH /programs/admin/aliases/:id (Step 3.5 alias manager). */
export interface UpdateAliasInput {
  alias?: string;
  aliasType?: string;
}

/** Body for POST /programs/admin/merge (Step 3.5 program merge). */
export interface MergeProgramsInput {
  keepProgramId: string;
  mergeProgramId: string;
}

/** Allowed aliasType values (mirrors the schema doc-comment on program_alias.aliasType). */
const ALIAS_TYPES = [
  'canonical',
  'acronym',
  'pe_title',
  'project_title',
  'p1_line_name',
  'mdap_name',
  'office_usage',
  'congressional',
  'sam_usage',
  'award_usage',
] as const;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: PeProgramMatcherService,
  ) {}

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

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3.5 — analyst console: alias manager + program merge (capiro_admin only,
  // gated at the controller). The program graph tables (program, program_alias,
  // and the FK tables re-pointed on merge) are GLOBAL reference data (no tenant_id
  // / RLS); AuditLog is TENANT-SCOPED so it is always written inside withTenant.
  // ───────────────────────────────────────────────────────────────────────────

  private assertAliasType(aliasType: string): void {
    if (!(ALIAS_TYPES as readonly string[]).includes(aliasType)) {
      throw new BadRequestException(
        `aliasType must be one of: ${ALIAS_TYPES.join(', ')} (got '${aliasType}').`,
      );
    }
  }

  /** GET /programs/admin/:programId/aliases — all aliases for a program. */
  async listAliases(programId: string) {
    const program = await this.prisma.program.findUnique({ where: { id: programId } });
    if (!program) throw new NotFoundException(`Program ${programId} not found`);
    const aliases = await this.prisma.programAlias.findMany({
      where: { programId },
      orderBy: [{ aliasType: 'asc' }, { confidence: 'desc' }, { alias: 'asc' }],
      select: {
        id: true,
        programId: true,
        alias: true,
        aliasNormalized: true,
        aliasType: true,
        source: true,
        sourceUrl: true,
        confidence: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { programId, data: aliases, total: aliases.length };
  }

  /**
   * POST /programs/admin/:programId/aliases — create an analyst-entered alias.
   * aliasNormalized is computed exactly the way the matcher does (reuse
   * normalizeAlias) so the new alias agrees with the pg_trgm index. Duplicates of
   * the (programId, aliasNormalized, aliasType) unique are rejected with a 400
   * (rather than surfacing a raw P2002). Writes an AuditLog inside withTenant.
   */
  async createAlias(programId: string, input: CreateAliasInput, ctx: TenantContext) {
    const aliasText = (input.alias ?? '').trim();
    if (!aliasText) throw new BadRequestException('alias is required.');
    this.assertAliasType(input.aliasType);

    const program = await this.prisma.program.findUnique({ where: { id: programId } });
    if (!program) throw new NotFoundException(`Program ${programId} not found`);

    const aliasNormalized = this.matcher.normalizeAlias(aliasText);
    if (!aliasNormalized) {
      throw new BadRequestException('alias normalizes to an empty string; provide alphanumeric text.');
    }

    const existing = await this.prisma.programAlias.findFirst({
      where: { programId, aliasNormalized, aliasType: input.aliasType },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        `An alias '${aliasNormalized}' of type '${input.aliasType}' already exists on this program.`,
      );
    }

    const source = (input.source ?? '').trim() || 'analyst_manual';
    const created = await this.prisma.programAlias.create({
      data: {
        programId,
        alias: aliasText,
        aliasNormalized,
        aliasType: input.aliasType,
        source,
        confidence: 1.0,
      },
    });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program.alias.create',
          entityType: 'program_alias',
          entityId: created.id,
          before: Prisma.JsonNull,
          after: {
            programId,
            alias: aliasText,
            aliasNormalized,
            aliasType: input.aliasType,
            source,
          },
        },
      });
    });

    return created;
  }

  /**
   * PATCH /programs/admin/aliases/:id — edit an alias text and/or type. The
   * aliasNormalized is always recomputed from the (new or existing) alias text via
   * the matcher's normalizeAlias. A change that would collide with another existing
   * (programId, aliasNormalized, aliasType) row is rejected with a 400. Writes an
   * AuditLog inside withTenant.
   */
  async updateAlias(id: string, input: UpdateAliasInput, ctx: TenantContext) {
    const alias = await this.prisma.programAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException(`ProgramAlias ${id} not found`);

    const nextAlias = input.alias !== undefined ? input.alias.trim() : alias.alias;
    if (!nextAlias) throw new BadRequestException('alias is required.');
    const nextType = input.aliasType !== undefined ? input.aliasType : alias.aliasType;
    if (input.aliasType !== undefined) this.assertAliasType(input.aliasType);

    const nextNormalized = this.matcher.normalizeAlias(nextAlias);
    if (!nextNormalized) {
      throw new BadRequestException('alias normalizes to an empty string; provide alphanumeric text.');
    }

    // Reject a collision with a DIFFERENT alias row on the same program.
    const collision = await this.prisma.programAlias.findFirst({
      where: {
        programId: alias.programId,
        aliasNormalized: nextNormalized,
        aliasType: nextType,
        id: { not: id },
      },
      select: { id: true },
    });
    if (collision) {
      throw new BadRequestException(
        `An alias '${nextNormalized}' of type '${nextType}' already exists on this program.`,
      );
    }

    const updated = await this.prisma.programAlias.update({
      where: { id },
      data: { alias: nextAlias, aliasNormalized: nextNormalized, aliasType: nextType },
    });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program.alias.update',
          entityType: 'program_alias',
          entityId: id,
          before: { alias: alias.alias, aliasNormalized: alias.aliasNormalized, aliasType: alias.aliasType },
          after: { alias: nextAlias, aliasNormalized: nextNormalized, aliasType: nextType },
        },
      });
    });

    return updated;
  }

  /**
   * DELETE /programs/admin/aliases/:id — remove an alias. Conservatively REFUSES to
   * delete a program's last remaining 'canonical' alias (which would orphan the
   * program's primary name) with a 400. Writes an AuditLog inside withTenant.
   */
  async deleteAlias(id: string, ctx: TenantContext) {
    const alias = await this.prisma.programAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException(`ProgramAlias ${id} not found`);

    if (alias.aliasType === 'canonical') {
      const remainingCanonical = await this.prisma.programAlias.count({
        where: { programId: alias.programId, aliasType: 'canonical', id: { not: id } },
      });
      if (remainingCanonical === 0) {
        throw new BadRequestException(
          "Refusing to delete a program's last 'canonical' alias (it would orphan the program).",
        );
      }
    }

    await this.prisma.programAlias.delete({ where: { id } });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program.alias.delete',
          entityType: 'program_alias',
          entityId: id,
          before: {
            programId: alias.programId,
            alias: alias.alias,
            aliasNormalized: alias.aliasNormalized,
            aliasType: alias.aliasType,
          },
          after: Prisma.JsonNull,
        },
      });
    });

    return { deleted: true as const, id };
  }

  /**
   * GET /programs/admin/duplicate-aliases — the §13 duplicate-alias detector: every
   * aliasNormalized that maps to MORE THAN ONE distinct program. Each entry lists
   * the colliding programs (canonicalName + the offending aliasId) so the analyst can
   * decide whether they are the same program (→ merge) or a true homonym.
   */
  async listDuplicateAliases() {
    const aliases = await this.prisma.programAlias.findMany({
      select: { id: true, programId: true, aliasNormalized: true },
      orderBy: { aliasNormalized: 'asc' },
    });

    // Group by aliasNormalized -> distinct programs.
    const byNorm = new Map<string, Map<string, string>>(); // norm -> (programId -> aliasId)
    for (const a of aliases) {
      let progs = byNorm.get(a.aliasNormalized);
      if (!progs) {
        progs = new Map();
        byNorm.set(a.aliasNormalized, progs);
      }
      // Keep the first aliasId seen for a (norm, program) pair.
      if (!progs.has(a.programId)) progs.set(a.programId, a.id);
    }

    const dupNorms = Array.from(byNorm.entries()).filter(([, progs]) => progs.size > 1);
    const programIds = Array.from(new Set(dupNorms.flatMap(([, progs]) => Array.from(progs.keys()))));
    const programs = programIds.length
      ? await this.prisma.program.findMany({
          where: { id: { in: programIds } },
          select: { id: true, canonicalName: true, status: true },
        })
      : [];
    const programById = new Map(programs.map((p) => [p.id, p]));

    const data = dupNorms.map(([aliasNormalized, progs]) => ({
      aliasNormalized,
      programs: Array.from(progs.entries()).map(([programId, aliasId]) => ({
        programId,
        canonicalName: programById.get(programId)?.canonicalName ?? null,
        status: programById.get(programId)?.status ?? null,
        aliasId,
      })),
    }));

    return { data, total: data.length };
  }

  /**
   * POST /programs/admin/merge — fold mergeProgramId INTO keepProgramId in one
   * $transaction (the graph tables are global, so no RLS context is needed for the
   * graph writes; the AuditLog is written separately inside withTenant, mirroring
   * resolveMatch). The loser is "retired" (status='merged', metadata.mergedInto /
   * mergedAt) rather than deleted, preserving its id for audit/back-reference.
   *
   * Each FK table that references programId is re-pointed loser -> keeper. For the
   * tables with a uniqueness constraint involving programId, a loser row whose
   * re-pointed key already exists on the keeper is DELETED instead of updated (it
   * would otherwise raise P2002):
   *   - pe_program_match           unique (peCode, coalesce(projectCode,''), programId)
   *   - program_office_program_link unique (officeId, programId)
   *   - provision_pe_link          unique (provisionId, coalesce(peCode,''), coalesce(programId::text,''))
   *   - person_role                NO unique on programId -> straight re-point.
   */
  async mergePrograms(input: MergeProgramsInput, ctx: TenantContext) {
    const { keepProgramId, mergeProgramId } = input;
    if (!keepProgramId || !mergeProgramId) {
      throw new BadRequestException('keepProgramId and mergeProgramId are both required.');
    }
    if (keepProgramId === mergeProgramId) {
      throw new BadRequestException('keepProgramId and mergeProgramId must differ.');
    }

    const [keep, loser] = await Promise.all([
      this.prisma.program.findUnique({ where: { id: keepProgramId } }),
      this.prisma.program.findUnique({ where: { id: mergeProgramId } }),
    ]);
    if (!keep) throw new NotFoundException(`Program ${keepProgramId} (keep) not found`);
    if (!loser) throw new NotFoundException(`Program ${mergeProgramId} (merge) not found`);
    if (loser.status === 'merged') {
      throw new BadRequestException(`Program ${mergeProgramId} is already merged.`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // ── pe_program_match: key on (peCode, projectCode ?? '') ──
      const loserMatches = await tx.peProgramMatch.findMany({
        where: { programId: mergeProgramId },
        select: { id: true, peCode: true, projectCode: true },
      });
      const keeperMatches = await tx.peProgramMatch.findMany({
        where: { programId: keepProgramId },
        select: { peCode: true, projectCode: true },
      });
      const keeperMatchKeys = new Set(keeperMatches.map((m) => `${m.peCode}::${m.projectCode ?? ''}`));
      let matchesRepointed = 0;
      let matchesDeleted = 0;
      for (const m of loserMatches) {
        const key = `${m.peCode}::${m.projectCode ?? ''}`;
        if (keeperMatchKeys.has(key)) {
          await tx.peProgramMatch.delete({ where: { id: m.id } });
          matchesDeleted++;
        } else {
          await tx.peProgramMatch.update({ where: { id: m.id }, data: { programId: keepProgramId } });
          keeperMatchKeys.add(key);
          matchesRepointed++;
        }
      }

      // ── person_role: no unique on programId -> straight re-point ──
      const roles = await tx.personRole.updateMany({
        where: { programId: mergeProgramId },
        data: { programId: keepProgramId },
      });
      const rolesRepointed = roles.count;

      // ── program_office_program_link: key on officeId ──
      const loserLinks = await tx.programOfficeProgramLink.findMany({
        where: { programId: mergeProgramId },
        select: { id: true, officeId: true },
      });
      const keeperLinks = await tx.programOfficeProgramLink.findMany({
        where: { programId: keepProgramId },
        select: { officeId: true },
      });
      const keeperOfficeIds = new Set(keeperLinks.map((l) => l.officeId));
      let officeLinksRepointed = 0;
      let officeLinksDeleted = 0;
      for (const l of loserLinks) {
        if (keeperOfficeIds.has(l.officeId)) {
          await tx.programOfficeProgramLink.delete({ where: { id: l.id } });
          officeLinksDeleted++;
        } else {
          await tx.programOfficeProgramLink.update({ where: { id: l.id }, data: { programId: keepProgramId } });
          keeperOfficeIds.add(l.officeId);
          officeLinksRepointed++;
        }
      }

      // ── provision_pe_link: key on (provisionId, peCode ?? '') ──
      const loserProvLinks = await tx.provisionPeLink.findMany({
        where: { programId: mergeProgramId },
        select: { id: true, provisionId: true, peCode: true },
      });
      const keeperProvLinks = await tx.provisionPeLink.findMany({
        where: { programId: keepProgramId },
        select: { provisionId: true, peCode: true },
      });
      const keeperProvKeys = new Set(keeperProvLinks.map((l) => `${l.provisionId}::${l.peCode ?? ''}`));
      let provisionLinksRepointed = 0;
      let provisionLinksDeleted = 0;
      for (const l of loserProvLinks) {
        const key = `${l.provisionId}::${l.peCode ?? ''}`;
        if (keeperProvKeys.has(key)) {
          await tx.provisionPeLink.delete({ where: { id: l.id } });
          provisionLinksDeleted++;
        } else {
          await tx.provisionPeLink.update({ where: { id: l.id }, data: { programId: keepProgramId } });
          keeperProvKeys.add(key);
          provisionLinksRepointed++;
        }
      }

      // ── aliases: copy the loser's aliases the keeper doesn't already have ──
      const loserAliases = await tx.programAlias.findMany({ where: { programId: mergeProgramId } });
      const keeperAliases = await tx.programAlias.findMany({
        where: { programId: keepProgramId },
        select: { aliasNormalized: true, aliasType: true },
      });
      const keeperAliasKeys = new Set(keeperAliases.map((a) => `${a.aliasNormalized}::${a.aliasType}`));
      let aliasesCopied = 0;
      for (const a of loserAliases) {
        const key = `${a.aliasNormalized}::${a.aliasType}`;
        if (keeperAliasKeys.has(key)) continue;
        await tx.programAlias.update({ where: { id: a.id }, data: { programId: keepProgramId } });
        keeperAliasKeys.add(key);
        aliasesCopied++;
      }

      // ── retire the loser ──
      const mergedAt = new Date();
      const priorMeta =
        loser.metadata && typeof loser.metadata === 'object' && !Array.isArray(loser.metadata)
          ? (loser.metadata as Prisma.JsonObject)
          : {};
      await tx.program.update({
        where: { id: mergeProgramId },
        data: {
          status: 'merged',
          metadata: { ...priorMeta, mergedInto: keepProgramId, mergedAt: mergedAt.toISOString() },
        },
      });

      return {
        repointed: {
          matches: matchesRepointed,
          roles: rolesRepointed,
          officeLinks: officeLinksRepointed,
          provisionLinks: provisionLinksRepointed,
        },
        deleted: {
          matches: matchesDeleted,
          officeLinks: officeLinksDeleted,
          provisionLinks: provisionLinksDeleted,
        },
        aliasesCopied,
        mergedAt,
      };
    });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program.merge',
          entityType: 'program',
          entityId: mergeProgramId,
          before: {
            mergeProgramId,
            mergeCanonicalName: loser.canonicalName,
            mergeStatus: loser.status,
          },
          after: {
            keepProgramId,
            keepCanonicalName: keep.canonicalName,
            status: 'merged',
            mergedInto: keepProgramId,
            mergedAt: result.mergedAt.toISOString(),
            repointed: result.repointed,
            deleted: result.deleted,
            aliasesCopied: result.aliasesCopied,
          },
        },
      });
    });

    return {
      merged: true as const,
      keepProgramId,
      mergeProgramId,
      repointed: result.repointed,
      aliasesCopied: result.aliasesCopied,
    };
  }
}
