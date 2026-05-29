import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
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
    };

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
              orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
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

    return {
      data: rows,
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
