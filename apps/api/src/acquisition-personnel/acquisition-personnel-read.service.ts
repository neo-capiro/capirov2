import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeName } from './normalization/name-normalizer.js';
import { ListPersonnelDto, type PersonnelListResponseDto } from './dto/list-personnel.dto.js';
import type { PersonDetailDto } from './dto/person-detail.dto.js';

type MergeDecision = 'merge' | 'keep_separate' | 'reject_a' | 'reject_b';

@Injectable()
export class AcquisitionPersonnelReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listPersonnel(query: ListPersonnelDto, ctx: TenantContext): Promise<PersonnelListResponseDto> {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);

    const where: Prisma.AcquisitionPersonnelWhereInput = {
      ...(query.service ? { service: query.service } : {}),
      ...(query.organization
        ? {
            organization: {
              contains: query.organization,
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.pe_code
        ? {
            OR: [{ pePrimary: query.pe_code }, { peSecondary: { has: query.pe_code } }],
          }
        : {}),
      ...(query.pe_aligned === 'aligned'
        ? { OR: [{ pePrimary: { not: null } }, { peSecondary: { isEmpty: false } }] }
        : {}),
      ...(query.pe_aligned === 'unaligned' ? { pePrimary: null, peSecondary: { isEmpty: true } } : {}),
    };

    // PE-aligned-first ordering (default for the DoW directory): rows with a confirmed
    // pePrimary sort ahead of unaligned ones. Postgres sorts NULLs last on ASC by
    // default, but to be explicit and stable we sort by a computed flag via raw is-null
    // ordering isn't expressible in Prisma orderBy, so we approximate with pePrimary
    // desc (non-null strings sort before NULL under 'desc' nulls-last) then confidence.
    const orderBy: Prisma.AcquisitionPersonnelOrderByWithRelationInput[] =
      query.sort === 'confidence'
        ? [{ confidence: 'desc' }, { updatedAt: 'desc' }]
        : [{ pePrimary: { sort: 'desc', nulls: 'last' } }, { confidence: 'desc' }, { updatedAt: 'desc' }];

    const { total, people } = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const trgmIds = query.q?.trim()
        ? await this.findIdsByFuzzyName(query.q.trim(), (page - 1) * limit, limit, tx)
        : null;

      const [count, rows] = await Promise.all([
        trgmIds
          ? Promise.resolve(trgmIds.length)
          : tx.acquisitionPersonnel.count({ where }),
        trgmIds
          ? tx.acquisitionPersonnel.findMany({
              where: {
                AND: [where, { id: { in: trgmIds } }],
              },
              include: {
                sources: {
                  select: { id: true },
                },
              },
            })
          : tx.acquisitionPersonnel.findMany({
              where,
              include: {
                sources: {
                  select: { id: true },
                },
              },
              orderBy,
              skip: (page - 1) * limit,
              take: limit,
            }),
      ]);

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'acquisition_personnel.list',
          entityType: 'acquisition_personnel',
          entityId: null,
          after: {
            filters: {
              service: query.service ?? null,
              organization: query.organization ?? null,
              role: query.role ?? null,
              peCode: query.pe_code ?? null,
              q: query.q ?? null,
            },
            page,
            limit,
            total: count,
          },
        },
      });

      const orderedRows = trgmIds ? this.orderByIds(rows, trgmIds) : rows;
      return { total: count, people: orderedRows, trgmIds };
    });

    return {
      data: people.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        service: p.service,
        organization: p.organization,
        title: p.title,
        role: p.role,
        pePrimary: p.pePrimary,
        peSecondary: p.peSecondary,
        emailDomain: p.emailDomain,
        publicProfileUrl: p.publicProfileUrl,
        headshotUrl:
          p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
            ? ((p.metadata as Record<string, unknown>).headshotUrl as string | undefined) ?? null
            : null,
        confidence: p.confidence,
        status: p.status,
        firstSeenAt: p.firstSeenAt.toISOString(),
        lastSeenAt: p.lastSeenAt.toISOString(),
        sourceCount: p.sources.length,
      })),
      total,
      page,
      limit,
    };
  }

  async getPersonDetail(id: string, ctx: TenantContext): Promise<PersonDetailDto> {
    const person = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const found = await tx.acquisitionPersonnel.findUnique({
        where: { id },
        include: {
          sources: {
            orderBy: { observedAt: 'desc' },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'acquisition_personnel.detail',
          entityType: 'acquisition_personnel',
          entityId: id,
          after: Prisma.JsonNull,
        },
      });

      return found;
    });

    if (!person) throw new NotFoundException(`Acquisition personnel ${id} not found`);

    return {
      id: person.id,
      fullName: person.fullName,
      nameKey: person.nameKey,
      service: person.service,
      organization: person.organization,
      title: person.title,
      role: person.role,
      programOfRecord: person.programOfRecord,
      pePrimary: person.pePrimary,
      peSecondary: person.peSecondary,
      emailDomain: person.emailDomain,
      publicProfileUrl: person.publicProfileUrl,
      confidence: person.confidence,
      status: person.status,
      firstSeenAt: person.firstSeenAt.toISOString(),
      lastSeenAt: person.lastSeenAt.toISOString(),
      metadata: person.metadata,
      sources: person.sources.map((s) => ({
        id: s.id,
        source: s.source,
        sourceUrl: s.sourceUrl,
        snippet: s.snippet,
        observedAt: s.observedAt.toISOString(),
        confidence: s.confidence,
        metadata: s.metadata,
      })),
    };
  }

  async getProgramElementPersonnel(peCode: string, ctx: TenantContext): Promise<PersonnelListResponseDto['data']> {
    const rows = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const found = await tx.acquisitionPersonnel.findMany({
        where: {
          OR: [{ pePrimary: peCode }, { peSecondary: { has: peCode } }],
        },
        include: {
          sources: {
            select: { id: true },
          },
        },
        orderBy: [{ confidence: 'desc' }, { lastSeenAt: 'desc' }],
        take: 10,
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program_element.personnel.list',
          entityType: 'program_element',
          entityId: peCode,
          after: { count: found.length },
        },
      });

      return found;
    });

    return rows.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      service: p.service,
      organization: p.organization,
      title: p.title,
      role: p.role,
      pePrimary: p.pePrimary,
      peSecondary: p.peSecondary,
      emailDomain: p.emailDomain,
      publicProfileUrl: p.publicProfileUrl,
      headshotUrl:
        p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
          ? ((p.metadata as Record<string, unknown>).headshotUrl as string | undefined) ?? null
          : null,
      confidence: p.confidence,
      status: p.status,
      firstSeenAt: p.firstSeenAt.toISOString(),
      lastSeenAt: p.lastSeenAt.toISOString(),
      sourceCount: p.sources.length,
    }));
  }

  async linkCrmContact(personId: string, engagementContactId: string, ctx: TenantContext): Promise<{ linked: true }> {
    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const [person, contact] = await Promise.all([
        this.prisma.acquisitionPersonnel.findUnique({ where: { id: personId }, select: { id: true } }),
        tx.engagementContact.findFirst({
          where: {
            id: engagementContactId,
            tenantId: ctx.tenantId,
          },
          select: { id: true, tenantId: true },
        }),
      ]);

      if (!person) throw new NotFoundException(`Acquisition personnel ${personId} not found`);
      if (!contact) throw new NotFoundException(`Engagement contact ${engagementContactId} not found`);

      const updated = await tx.engagementContact.update({
        where: { id: contact.id },
        data: { acquisitionPersonnelId: personId },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'acquisition_personnel.crm_link',
          entityType: 'engagement_contacts',
          entityId: updated.id,
          after: { acquisitionPersonnelId: personId },
        },
      });
    });

    return { linked: true };
  }

  async listMergeQueue(
    status: string | undefined,
    pageRaw: number | undefined,
    limitRaw: number | undefined,
    ctx: TenantContext,
  ) {
    const page = this.normalizePage(pageRaw);
    const limit = this.normalizeLimit(limitRaw);

    const where: Prisma.AcquisitionPersonnelMergeCandidateWhereInput = status
      ? { status }
      : {};

    const { total, rows } = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const [count, items] = await Promise.all([
        tx.acquisitionPersonnelMergeCandidate.count({ where }),
        tx.acquisitionPersonnelMergeCandidate.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'acquisition_personnel.merge_queue.list',
          entityType: 'acquisition_personnel_merge_candidate',
          entityId: null,
          after: { status: status ?? null, page, limit, total: count },
        },
      });

      return { total: count, rows: items };
    });

    // Hydrate each candidate with both persons' detail (name, organization,
    // title, role, status, sources) so the admin merge UI can render a
    // side-by-side comparison. AcquisitionPersonnel is a GLOBAL table, so this
    // read uses the base client (no tenant scoping).
    const personIds = Array.from(
      new Set(rows.flatMap((r) => [r.primaryPersonId, r.secondaryPersonId])),
    );
    const persons = personIds.length
      ? await this.prisma.acquisitionPersonnel.findMany({
          where: { id: { in: personIds } },
          select: {
            id: true,
            fullName: true,
            organization: true,
            title: true,
            role: true,
            service: true,
            status: true,
            confidence: true,
            sources: {
              select: { source: true, sourceUrl: true, observedAt: true },
              orderBy: { observedAt: 'desc' },
              take: 10,
            },
          },
        })
      : [];
    const personById = new Map(persons.map((p) => [p.id, p]));

    const data = rows.map((r) => ({
      ...r,
      primaryPerson: personById.get(r.primaryPersonId) ?? null,
      secondaryPerson: personById.get(r.secondaryPersonId) ?? null,
    }));

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async resolveMergeQueue(
    id: string,
    decision: MergeDecision,
    notes: string | undefined,
    ctx: TenantContext,
    mergePersons: (primaryId: string, secondaryId: string, userId: string) => Promise<void>,
  ): Promise<{ resolved: true }> {
    const candidate = await this.prisma.acquisitionPersonnelMergeCandidate.findUnique({
      where: { id },
    });

    if (!candidate) throw new NotFoundException(`Merge queue candidate ${id} not found`);

    if (decision === 'merge') {
      await mergePersons(candidate.primaryPersonId, candidate.secondaryPersonId, ctx.userId);
    }

    await this.prisma.acquisitionPersonnelMergeCandidate.update({
      where: { id },
      data: {
        status: decision === 'merge' ? 'merged' : decision,
        resolvedByUserId: ctx.userId,
        resolvedAt: new Date(),
        decisionNotes: notes ?? null,
      },
    });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'acquisition_personnel.merge_queue.resolve',
          entityType: 'acquisition_personnel_merge_candidate',
          entityId: id,
          after: { decision, notes: notes ?? null },
        },
      });
    });

    return { resolved: true };
  }

  // ── Phase 1b: person -> Program Element link candidate review queue ──────────
  // Candidates are proposed by the deterministic matcher (generate-pe-person-candidates).
  // Confirming one applies the link (sets pe_primary) AND records a citation source
  // so the link is defensible/auditable. Rejecting just closes the candidate.

  async listPersonCandidates(
    status: string,
    pageRaw: number | undefined,
    limitRaw: number | undefined,
    ctx: TenantContext,
  ) {
    const page = this.normalizePage(pageRaw);
    const limit = this.normalizeLimit(limitRaw);
    const where: Prisma.ProgramElementPersonCandidateWhereInput = status ? { status } : {};

    const [total, rows] = await Promise.all([
      this.prisma.programElementPersonCandidate.count({ where }),
      this.prisma.programElementPersonCandidate.findMany({
        where,
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Enrich with person + PE display fields for the reviewer UI.
    const personIds = Array.from(new Set(rows.map((r) => r.personId)));
    const peCodes = Array.from(new Set(rows.map((r) => r.peCode)));
    const [people, pes] = await Promise.all([
      this.prisma.acquisitionPersonnel.findMany({
        where: { id: { in: personIds } },
        select: { id: true, fullName: true, organization: true, title: true, pePrimary: true },
      }),
      this.prisma.programElement.findMany({
        where: { peCode: { in: peCodes } },
        select: { peCode: true, title: true, service: true },
      }),
    ]);
    const personById = new Map(people.map((p) => [p.id, p]));
    const peByCode = new Map(pes.map((p) => [p.peCode, p]));

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program_element.person_candidate.list',
          entityType: 'program_element_person_candidate',
          entityId: null,
          after: { status: status ?? null, page, limit, total },
        },
      });
    });

    return {
      data: rows.map((r) => ({
        ...r,
        person: personById.get(r.personId) ?? null,
        programElement: peByCode.get(r.peCode) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  async resolvePersonCandidate(
    id: string,
    decision: 'confirm' | 'reject',
    notes: string | undefined,
    ctx: TenantContext,
  ): Promise<{ resolved: true; linked: boolean }> {
    const candidate = await this.prisma.programElementPersonCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException(`Person-PE candidate ${id} not found`);

    let linked = false;

    if (decision === 'confirm') {
      // Look up an R-2 citation for this PE (if any) so the link carries provenance.
      const r2 = await this.prisma.programElementSource.findFirst({
        where: { peCode: candidate.peCode, exhibitType: { in: ['R-2', 'R-2A'] } },
        orderBy: [{ pageNumber: 'asc' }],
        select: { sourceUrl: true, pageNumber: true },
      });
      const citationUrl =
        r2?.sourceUrl && r2.pageNumber ? `${r2.sourceUrl}#page=${r2.pageNumber}` : r2?.sourceUrl ?? null;

      await this.prisma.$transaction(async (tx) => {
        // Apply the link only if the person isn't already mapped (don't clobber).
        await tx.acquisitionPersonnel.updateMany({
          where: { id: candidate.personId, pePrimary: null },
          data: { pePrimary: candidate.peCode },
        });
        // Record a citable source explaining WHY this link exists.
        await tx.acquisitionPersonnelSource.create({
          data: {
            personId: candidate.personId,
            source: 'pe_match_confirmed',
            sourceUrl: citationUrl,
            snippet: `Linked to PE ${candidate.peCode} (review-confirmed). Match basis: ${candidate.matchBasis ?? 'n/a'}.`,
            observedAt: new Date(),
            confidence: candidate.score,
            metadata: {
              candidateId: candidate.id,
              peCode: candidate.peCode,
              score: candidate.score,
              confirmedByUserId: ctx.userId,
            },
          },
        });
      });
      linked = true;
    }

    await this.prisma.programElementPersonCandidate.update({
      where: { id },
      data: {
        status: decision === 'confirm' ? 'confirmed' : 'rejected',
        resolvedByUserId: ctx.userId,
        resolvedAt: new Date(),
        decisionNotes: notes ?? null,
      },
    });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program_element.person_candidate.resolve',
          entityType: 'program_element_person_candidate',
          entityId: id,
          after: { decision, peCode: candidate.peCode, personId: candidate.personId, linked, notes: notes ?? null },
        },
      });
    });

    return { resolved: true, linked };
  }

  /**
   * user_admin suggestion: a tenant admin proposes a person they know for a PE.
   * Creates a low-confidence person (status=unknown, source=user_suggested) + an
   * OPEN candidate for capiro_admin review. Never auto-applies a link.
   */
  async suggestPersonForProgramElement(
    peCode: string,
    input: { fullName: string; roleTitle?: string; organization?: string; notes?: string },
    ctx: TenantContext,
  ): Promise<{ suggested: true; candidateId: string }> {
    const fullName = (input.fullName ?? '').trim();
    if (!fullName) throw new BadRequestException('fullName is required');

    const pe = await this.prisma.programElement.findUnique({ where: { peCode }, select: { peCode: true } });
    if (!pe) throw new NotFoundException(`Program Element ${peCode} not found`);

    const nameKey = normalizeName(fullName).nameKey;

    const result = await this.prisma.$transaction(async (tx) => {
      // Reuse an existing person by nameKey if present; otherwise create one.
      let person = await tx.acquisitionPersonnel.findFirst({ where: { nameKey }, select: { id: true } });
      if (!person) {
        person = await tx.acquisitionPersonnel.create({
          data: {
            fullName,
            nameKey,
            organization: input.organization ?? null,
            title: input.roleTitle ?? null,
            role: 'OTHER',
            confidence: 0.3,
            status: 'unknown',
            metadata: { suggestedByUserId: ctx.userId, suggestedForPe: peCode },
          },
          select: { id: true },
        });
        await tx.acquisitionPersonnelSource.create({
          data: {
            personId: person.id,
            source: 'user_suggested',
            sourceUrl: null,
            snippet: `Suggested for PE ${peCode} by tenant admin${input.notes ? `: ${input.notes}` : ''}`,
            observedAt: new Date(),
            confidence: 0.3,
            metadata: { suggestedByUserId: ctx.userId, tenantId: ctx.tenantId },
          },
        });
      }

      const candidate = await tx.programElementPersonCandidate.upsert({
        where: { personId_peCode: { personId: person.id, peCode } },
        create: {
          personId: person.id,
          peCode,
          score: 0.3,
          matchBasis: `user-suggested by tenant admin${input.roleTitle ? ` (${input.roleTitle})` : ''}`,
          scoreBreakdown: { source: 'user_suggested', notes: input.notes ?? null } as unknown as object,
          status: 'open',
        },
        update: {
          // Re-open if previously rejected, refresh basis; never clobber a confirmed link.
          matchBasis: `user-suggested by tenant admin${input.roleTitle ? ` (${input.roleTitle})` : ''}`,
        },
        select: { id: true },
      });

      return candidate.id;
    });

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program_element.person_candidate.suggest',
          entityType: 'program_element_person_candidate',
          entityId: result,
          after: { peCode, fullName, roleTitle: input.roleTitle ?? null, organization: input.organization ?? null },
        },
      });
    });

    return { suggested: true, candidateId: result };
  }

  private normalizePage(page?: number): number {
    const p = Number(page ?? 1);
    if (!Number.isFinite(p) || p < 1) return 1;
    return Math.floor(p);
  }

  private normalizeLimit(limit?: number): number {
    const l = Number(limit ?? 50);
    if (!Number.isFinite(l) || l < 1) return 50;
    return Math.min(100, Math.floor(l));
  }

  private async findIdsByFuzzyName(
    query: string,
    skip: number,
    take: number,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM acquisition_personnel
      WHERE similarity(name_key, ${query}) > 0.2
      ORDER BY similarity(name_key, ${query}) DESC, confidence DESC
      OFFSET ${skip}
      LIMIT ${take}
    `);
    return rows.map((r) => r.id);
  }

  private orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
    const map = new Map(rows.map((r) => [r.id, r] as const));
    const ordered: T[] = [];
    for (const id of ids) {
      const found = map.get(id);
      if (found) ordered.push(found);
    }
    return ordered;
  }
}
