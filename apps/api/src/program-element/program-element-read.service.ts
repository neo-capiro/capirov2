import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import LRUCache = require('lru-cache');
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConferenceProbabilityService } from './models/conference-probability.service.js';

export interface ProgramElementListQuery {
  service?: string;
  budgetActivity?: string;
  q?: string;
  page?: number;
  limit?: number;
  mode?: 'markup-monitor';
  divergenceThreshold?: number;
  /** 'true' restricts to PEs with at least one data signal (year/award/bill). */
  hasData?: string;
}

@Injectable()
export class ProgramElementReadService {
  private readonly detailCache = new LRUCache<string, Record<string, unknown>>({
    ttl: 60_000,
    max: 500,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly conferenceProbabilityService: ConferenceProbabilityService,
  ) {}

  async listProgramElements(query: ProgramElementListQuery, ctx?: TenantContext) {
    if (query.mode === 'markup-monitor') {
      return this.listMarkupMonitor(query, ctx);
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));

    const service = query.service?.trim();
    const budgetActivity = query.budgetActivity?.trim();
    const q = query.q?.trim();
    const hasDataOnly = query.hasData === 'true';

    type ListRow = {
      peCode: string;
      title: string;
      service: string | null;
      budgetActivity: string | null;
      appropriationType: string | null;
      status: string | null;
      lastSyncedAt: Date;
      hasData: boolean;
      totalCount: number;
    };

    // A PE "has data" if it has at least one FY history row, a PE-linked federal
    // award, or a bill that references it. Computed once per row via EXISTS so the
    // finder can flag (and optionally hide) sparse PEs whose detail panels are empty.
    const hasDataExpr = Prisma.sql`(
      EXISTS (SELECT 1 FROM program_element_year y WHERE y.pe_code = pe.pe_code)
      OR EXISTS (SELECT 1 FROM federal_award fa WHERE fa.pe_code = pe.pe_code)
      OR EXISTS (SELECT 1 FROM congress_bill b WHERE pe.pe_code = ANY(b.pe_codes))
    )`;

    const rows = await this.prisma.$queryRaw<ListRow[]>(Prisma.sql`
      WITH filtered AS (
        SELECT
          pe.pe_code,
          pe.title,
          pe.service,
          pe.budget_activity,
          pe.appropriation_type,
          pe.status,
          pe.last_synced_at,
          ${hasDataExpr} AS has_data,
          CASE WHEN ${q ? 1 : 0} = 1 THEN GREATEST(similarity(pe.title, ${q ?? ''}), 0) ELSE 0 END AS score
        FROM program_element pe
        WHERE pe.retired_at IS NULL
          AND (${service ? Prisma.sql`pe.service ILIKE ${service}` : Prisma.sql`TRUE`})
          AND (${budgetActivity ? Prisma.sql`pe.budget_activity ILIKE ${budgetActivity}` : Prisma.sql`TRUE`})
          AND (${hasDataOnly ? hasDataExpr : Prisma.sql`TRUE`})
          AND (
            ${q ? Prisma.sql`pe.title ILIKE ${`%${q}%`} OR pe.pe_code ILIKE ${`%${q}%`} OR similarity(pe.title, ${q}) > 0.2` : Prisma.sql`TRUE`}
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
        has_data AS "hasData",
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

  private async listMarkupMonitor(query: ProgramElementListQuery, ctx?: TenantContext) {
    const service = query.service?.trim();
    const divergenceThreshold = query.divergenceThreshold ?? 0;

    if (!ctx?.tenantId) {
      return { data: [], total: 0, page: 1, limit: 0 };
    }

    type MarkupMonitorRow = {
      peCode: string;
      title: string;
      service: string | null;
      request: number | null;
      hascMark: number | null;
      sascMark: number | null;
      hacDMark: number | null;
      sacDMark: number | null;
      divergencePct: number;
      totalCount: number;
    };

    const rows = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.$queryRaw<MarkupMonitorRow[]>(Prisma.sql`
        WITH watched AS (
          SELECT DISTINCT pew.pe_code
          FROM program_element_watch pew
          WHERE pew.tenant_id = ${ctx.tenantId}::uuid
        ),
        current_cycle AS (
          SELECT DISTINCT ON (pey.pe_code)
            pey.pe_code,
            pey.fy,
            pey.request,
            pey.hasc_mark,
            pey.sasc_mark,
            pey.hac_d_mark,
            pey.sac_d_mark
          FROM program_element_year pey
          JOIN watched w ON w.pe_code = pey.pe_code
          ORDER BY pey.pe_code, pey.fy DESC
        ),
        enriched AS (
          SELECT
            pe.pe_code AS "peCode",
            pe.title,
            pe.service,
            cc.request::double precision AS request,
            cc.hasc_mark::double precision AS "hascMark",
            cc.sasc_mark::double precision AS "sascMark",
            cc.hac_d_mark::double precision AS "hacDMark",
            cc.sac_d_mark::double precision AS "sacDMark",
            CASE
              WHEN cc.request IS NULL OR cc.request = 0 THEN 0
              ELSE (
                (
                  GREATEST(
                    COALESCE(cc.hasc_mark, cc.request),
                    COALESCE(cc.sasc_mark, cc.request),
                    COALESCE(cc.hac_d_mark, cc.request),
                    COALESCE(cc.sac_d_mark, cc.request)
                  )
                  -
                  LEAST(
                    COALESCE(cc.hasc_mark, cc.request),
                    COALESCE(cc.sasc_mark, cc.request),
                    COALESCE(cc.hac_d_mark, cc.request),
                    COALESCE(cc.sac_d_mark, cc.request)
                  )
                ) / cc.request::double precision
              ) * 100
            END AS "divergencePct"
          FROM current_cycle cc
          JOIN program_element pe ON pe.pe_code = cc.pe_code
          WHERE pe.retired_at IS NULL
            AND (${service ? Prisma.sql`pe.service ILIKE ${service}` : Prisma.sql`TRUE`})
        )
        SELECT
          "peCode",
          title,
          service,
          request,
          "hascMark",
          "sascMark",
          "hacDMark",
          "sacDMark",
          "divergencePct",
          COUNT(*) OVER()::int AS "totalCount"
        FROM enriched
        WHERE "divergencePct" >= ${divergenceThreshold}
        ORDER BY "divergencePct" DESC, "peCode" ASC
      `),
    );

    const total = rows[0]?.totalCount ?? 0;
    return {
      data: rows.map(({ totalCount: _ignored, ...rest }) => rest),
      total,
      page: 1,
      limit: rows.length,
    };
  }

  async getProgramElement(peCode: string, ctx: TenantContext) {
    const cacheKey = peCode.toUpperCase();

    const watch = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM program_element_watch
        WHERE user_id = ${ctx.userId}::uuid
          AND pe_code = ${peCode}
        LIMIT 1
      `),
    );

    const cached = this.detailCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        currentUserIsWatching: Boolean(watch[0]),
      };
    }

    // The base Program Element row is authoritative for every field the detail
    // view renders — appropriation type, status, first-seen FY — AND it carries
    // the COMPLETE budget-year history. The FY timeline chart, the per-FY mark
    // drawer, and the win-rate calc all need every year, not just the latest, so
    // we always hydrate the full `years` relation here (ascending by FY).
    const programElement = await this.prisma.programElement.findUnique({
      where: { peCode },
      include: {
        years: {
          orderBy: { fy: 'asc' },
        },
      },
    });

    if (!programElement) {
      throw new NotFoundException(`Program element ${peCode} not found`);
    }

    // Best-effort enrichment from the detail materialized view: it precomputes
    // the (expensive) count of bills touching this PE. The MV can be absent or
    // stale on a fresh database, so a miss is non-fatal — the detail above still
    // renders fully from the authoritative base row.
    const mvRows = await this.prisma
      .$queryRaw<Array<{ billCount: number | null }>>(
        Prisma.sql`
        SELECT bill_count::int AS "billCount"
        FROM program_element_detail_mv
        WHERE pe_code = ${peCode}
        LIMIT 1
      `,
      )
      .catch(() => [] as Array<{ billCount: number | null }>);

    const detail: Record<string, unknown> = {
      ...programElement,
      billCount: mvRows[0]?.billCount ?? null,
    };

    this.detailCache.set(cacheKey, detail);

    return {
      ...detail,
      currentUserIsWatching: Boolean(watch[0]),
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

    const yearsWithConferenceProbability = await Promise.all(
      years.map(async (year) => {
        const prediction = await this.conferenceProbabilityService.predict(peCode, year.fy);
        return {
          ...year,
          conferenceProbability: prediction?.predicted ?? null,
          conferenceProbabilityCiLow: prediction?.ciLow ?? null,
          conferenceProbabilityCiHigh: prediction?.ciHigh ?? null,
          conferenceProbabilityConfidence: prediction?.confidence ?? null,
        };
      }),
    );

    return {
      peCode,
      years: yearsWithConferenceProbability,
      milestones,
    };
  }

  async getBills(peCode: string) {
    const exists = await this.prisma.programElement.findUnique({
      where: { peCode },
      select: { peCode: true },
    });
    if (!exists) throw new NotFoundException(`Program element ${peCode} not found`);

    const bills = await this.prisma.congressBill.findMany({
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
        sponsorName: true,
        committeeRefs: {
          select: { committeeName: true },
          take: 1,
        },
      },
    });

    // Flatten the sponsor + lead committee onto each bill so the "Bills touching
    // this PE" panel can show real attribution instead of "N/A". passageProbability
    // is intentionally omitted — Congress.gov gives us no such signal, so the UI
    // shows honest metadata (sponsor, committee, latest action) rather than a
    // fabricated score.
    return bills.map(({ committeeRefs, sponsorName, ...bill }) => ({
      ...bill,
      sponsor: sponsorName,
      committee: committeeRefs[0]?.committeeName ?? null,
    }));
  }

  async getContractors(peCode: string) {
    const exists = await this.prisma.programElement.findUnique({
      where: { peCode },
      select: { peCode: true },
    });
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

    type ContractorRow = { contractorName: string; amount: number; awards: number; source: string };
    // federal_award.amount is stored in raw obligated DOLLARS, but the UI renders
    // contractor totals in millions ($X.XM / $X.XB) — divide by 1e6 here so the
    // panel shows the right magnitude. The 24-month window keys off the action
    // date with awarded_at as a fallback, because USAspending often leaves
    // awarded_at null while action_date is always populated.
    //
    // Linkage is two-tier and labeled for honest provenance:
    //   (a) direct: federal_award.pe_code = this PE (explicit/legacy resolution).
    //   (b) program: awards whose DoD acquisition (MDAP) program code maps to this
    //       PE via the reviewed program_element_acquisition_program table. This is
    //       the production tier — USAspending carries no PE on contracts, but it
    //       always carries the program code, and the PE link is curated, so the
    //       attribution is defensible ("primes on this program") rather than empty
    //       or fabricated.
    // A contractor reached by BOTH tiers is counted once; an award is matched by
    // pe_code OR program code (DISTINCT award id) so dollars are never double-added.
    const rows = await this.prisma.$queryRaw<ContractorRow[]>(Prisma.sql`
      WITH linked_programs AS (
        SELECT acq_program_code
        FROM program_element_acquisition_program
        WHERE pe_code = ${peCode}
      ),
      matched AS (
        SELECT DISTINCT ON (fa.id)
          fa.id,
          fa.contractor_name,
          fa.amount,
          CASE WHEN fa.pe_code = ${peCode} THEN 'direct' ELSE 'program' END AS match_kind
        FROM federal_award fa
        WHERE fa.contractor_name IS NOT NULL
          AND COALESCE(fa.action_date, fa.awarded_at::date) >= (NOW() - INTERVAL '24 months')::date
          AND (
            fa.pe_code = ${peCode}
            OR fa.dod_acq_program_code IN (SELECT acq_program_code FROM linked_programs)
          )
      )
      SELECT
        contractor_name AS "contractorName",
        (COALESCE(SUM(amount), 0) / 1e6)::double precision AS amount,
        COUNT(*)::int AS awards,
        CASE WHEN bool_or(match_kind = 'direct') THEN 'direct' ELSE 'program' END AS source
      FROM matched
      GROUP BY contractor_name
      ORDER BY amount DESC
      LIMIT 10
    `);

    // Provenance the UI can render verbatim so users know HOW a contractor was
    // tied to this PE. 'program' = linked via the contract's DoD acquisition
    // program code; 'direct' = the award itself carried this PE code.
    const data = rows.map((r) => ({
      ...r,
      attribution:
        r.source === 'direct'
          ? 'Award attributed to this program element'
          : 'Linked via DoD Acquisition Program (USAspending)',
    }));

    return {
      data,
      todo: null,
    };
  }

  async setWatching(peCode: string, watching: boolean, ctx: TenantContext) {
    const programElement = await this.prisma.programElement.findUnique({
      where: { peCode },
      select: { peCode: true },
    });
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

  /**
   * Cross-source reconciliation review queue (Step 29 §4.1). Global table —
   * capiro_admin only (gated at the controller). Not tenant-scoped: it reflects
   * intel-data conflicts, not tenant data.
   */
  async listReconciliationQueue(status = 'open', page = 1, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;
    const where = status === 'all' ? {} : { status };
    const [rows, total] = await Promise.all([
      this.prisma.reconciliationReviewQueue.findMany({
        where,
        orderBy: { queuedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.reconciliationReviewQueue.count({ where }),
    ]);
    return { data: rows, total, page: Math.max(page, 1), limit: take };
  }
}
