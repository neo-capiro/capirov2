import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ProgramElementListQuery {
  service?: string;
  budgetActivity?: string;
  q?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ProgramElementReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listProgramElements(query: ProgramElementListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));

    const service = query.service?.trim();
    const budgetActivity = query.budgetActivity?.trim();
    const q = query.q?.trim();

    type ListRow = {
      peCode: string;
      title: string;
      service: string | null;
      budgetActivity: string | null;
      appropriationType: string | null;
      status: string | null;
      lastSyncedAt: Date;
      totalCount: number;
    };

    const rows = await this.prisma.$queryRaw<ListRow[]>(Prisma.sql`
      WITH filtered AS (
        SELECT
          pe_code,
          title,
          service,
          budget_activity,
          appropriation_type,
          status,
          last_synced_at,
          CASE WHEN ${q ? 1 : 0} = 1 THEN GREATEST(similarity(title, ${q ?? ''}), 0) ELSE 0 END AS score
        FROM program_element
        WHERE (${service ? Prisma.sql`service ILIKE ${service}` : Prisma.sql`TRUE`})
          AND (${budgetActivity ? Prisma.sql`budget_activity ILIKE ${budgetActivity}` : Prisma.sql`TRUE`})
          AND (
            ${q ? Prisma.sql`title ILIKE ${`%${q}%`} OR similarity(title, ${q}) > 0.2` : Prisma.sql`TRUE`}
          )
      )
      SELECT
        pe_code AS "peCode",
        title,
        service,
        budget_activity AS "budgetActivity",
        appropriation_type AS "appropriationType",
        status,
        last_synced_at AS "lastSyncedAt",
        COUNT(*) OVER()::int AS "totalCount"
      FROM filtered
      ORDER BY
        CASE WHEN ${q ? 1 : 0} = 1 THEN score ELSE NULL END DESC,
        service ASC NULLS LAST,
        pe_code ASC
      LIMIT ${limit}
      OFFSET ${(page - 1) * limit}
    `);

    const total = rows[0]?.totalCount ?? 0;
    return {
      data: rows.map(({ totalCount: _ignored, ...rest }) => rest),
      total,
      page,
      limit,
    };
  }

  async getProgramElement(peCode: string, ctx: TenantContext) {
    const programElement = await this.prisma.programElement.findUnique({
      where: { peCode },
      include: {
        years: {
          orderBy: { fy: 'desc' },
          take: 1,
        },
      },
    });

    if (!programElement) {
      throw new NotFoundException(`Program element ${peCode} not found`);
    }

    const watch = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM program_element_watch
        WHERE user_id = ${ctx.userId}::uuid
          AND pe_code = ${peCode}
        LIMIT 1
      `),
    );

    return {
      ...programElement,
      currentUserIsWatching: Boolean(watch),
    };
  }

  async getTimeline(peCode: string) {
    const programElement = await this.prisma.programElement.findUnique({
      where: { peCode },
      select: { peCode: true },
    });
    if (!programElement) throw new NotFoundException(`Program element ${peCode} not found`);

    const [years, milestones] = await Promise.all([
      this.prisma.programElementYear.findMany({
        where: { peCode },
        orderBy: { fy: 'asc' },
      }),
      this.prisma.programElementMilestone.findMany({
        where: { peCode },
        orderBy: [{ plannedDate: 'asc' }, { milestoneType: 'asc' }],
      }),
    ]);

    return {
      peCode,
      years: years.map((year) => ({
        ...year,
        conferenceProbability: null,
      })),
      milestones,
    };
  }

  async getBills(peCode: string) {
    const exists = await this.prisma.programElement.findUnique({ where: { peCode }, select: { peCode: true } });
    if (!exists) throw new NotFoundException(`Program element ${peCode} not found`);

    return this.prisma.congressBill.findMany({
      where: { peCodes: { has: peCode } },
      orderBy: [{ latestActionDate: 'desc' }, { introducedDate: 'desc' }],
      take: 100,
      select: {
        id: true,
        congress: true,
        billType: true,
        billNumber: true,
        title: true,
        policyArea: true,
        latestActionText: true,
        latestActionDate: true,
        url: true,
      },
    });
  }

  async getContractors(peCode: string) {
    const exists = await this.prisma.programElement.findUnique({ where: { peCode }, select: { peCode: true } });
    if (!exists) throw new NotFoundException(`Program element ${peCode} not found`);

    const tableExists = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'federal_award'
      ) AS "exists"
    `);

    if (!tableExists[0]?.exists) {
      return {
        data: [],
        todo: 'federal_award table not yet created (Step 28)',
      };
    }

    type ContractorRow = { contractorName: string; amount: number; awards: number };
    const rows = await this.prisma.$queryRaw<ContractorRow[]>(Prisma.sql`
      SELECT
        contractor_name AS "contractorName",
        COALESCE(SUM(amount), 0)::double precision AS amount,
        COUNT(*)::int AS awards
      FROM federal_award
      WHERE pe_code = ${peCode}
        AND awarded_at >= NOW() - INTERVAL '24 months'
      GROUP BY contractor_name
      ORDER BY amount DESC
      LIMIT 10
    `);

    return {
      data: rows,
      todo: null,
    };
  }

  async setWatching(peCode: string, watching: boolean, ctx: TenantContext) {
    const programElement = await this.prisma.programElement.findUnique({ where: { peCode }, select: { peCode: true } });
    if (!programElement) throw new NotFoundException(`Program element ${peCode} not found`);

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      if (watching) {
        const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO program_element_watch (user_id, tenant_id, pe_code)
          VALUES (${ctx.userId}::uuid, ${ctx.tenantId}::uuid, ${peCode})
          ON CONFLICT (user_id, pe_code)
          DO UPDATE SET tenant_id = EXCLUDED.tenant_id
          RETURNING id
        `);

        const watchId = inserted[0]?.id ?? null;

        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            actorRole: ctx.role,
            action: 'program_element.watch.set',
            entityType: 'program_element_watch',
            entityId: watchId,
            after: { peCode, watching: true },
          },
        });

        return { peCode, watching: true };
      }

      const removed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        DELETE FROM program_element_watch
        WHERE user_id = ${ctx.userId}::uuid
          AND pe_code = ${peCode}
        RETURNING id
      `);

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'program_element.watch.set',
          entityType: 'program_element_watch',
          entityId: removed[0]?.id ?? null,
          after: { peCode, watching: false },
        },
      });

      return { peCode, watching: false };
    });
  }
}
