import { Injectable, NotFoundException } from '@nestjs/common';
import { EngagementTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { InsightGeneratorService } from './insight-generator.service.js';

export interface ReportCardData {
  client: { id: string; name: string; sectorTag: string | null };
  tenant: { name: string; logoS3Key: string | null };
  period: { start: Date; end: Date; label: string };
  activity: {
    meetings: number;
    uniqueOffices: string[];
    outreachSent: number;
    outreachOpenRate: number;
    tasksCompleted: number;
    debriefsFiled: number;
    mailThreads: number;
  };
  intelligence: {
    billsTracked: number;
    billsByStatus: Record<string, number>;
    competitorCount: number;
    lobbySpend: number;
    contractWins: number;
  };
  outcomes: Array<{
    title: string;
    fiscalYear: string;
    outcomeType: string;
    capability: string | null;
    notes: string | null;
  }>;
  healthTrend: Array<{ week: string; score: number }>;
  aiForwardLook: string;
  generatedAt: string;
}

@Injectable()
export class ReportCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insightGen: InsightGeneratorService,
  ) {}

  async generateReportCard(
    clientId: string,
    tenantId: string,
    period: 'quarter' | 'year' = 'quarter',
  ): Promise<ReportCardData> {
    const days = period === 'quarter' ? 90 : 365;
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const [client, tenant] = await Promise.all([
      this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findFirst({
          where: { id: clientId },
          select: { id: true, name: true, sectorTag: true },
        }),
      ),
      this.prisma.tenant.findFirst({
        where: { id: tenantId },
        select: { name: true, logoS3Key: true },
      }),
    ]);

    if (!client) throw new NotFoundException('Client not found');

    const [meetings, outreachRecords, tasksCompleted, debriefs, mailThreads, submissions] =
      await Promise.all([
        this.prisma.withTenant(tenantId, (tx) =>
          tx.meeting.findMany({
            where: { clientId, startsAt: { gte: start } },
            include: { attendees: true },
          }),
        ),
        this.prisma.withTenant(tenantId, (tx) =>
          tx.outreachRecord.findMany({
            where: { clientId, sentAt: { gte: start }, deletedAt: null },
            select: { id: true, stats: true },
          }),
        ),
        this.prisma.withTenant(tenantId, (tx) =>
          tx.engagementTask.count({
            where: { clientId, status: EngagementTaskStatus.done, updatedAt: { gte: start } },
          }),
        ),
        this.prisma.withTenant(tenantId, (tx) =>
          tx.meetingDebrief.count({ where: { clientId, createdAt: { gte: start } } }),
        ),
        this.prisma.withTenant(tenantId, (tx) =>
          tx.mailThread.count({ where: { clientId, lastMessageAt: { gte: start } } }),
        ),
        this.prisma.withTenant(tenantId, (tx) =>
          tx.clientSubmissionHistory.findMany({
            where: { clientId, updatedAt: { gte: start } },
            include: { capability: { select: { name: true } } },
          }),
        ),
      ]);

    // Unique offices from attendee roles
    const uniqueOffices = new Set<string>();
    for (const meeting of meetings) {
      for (const attendee of meeting.attendees) {
        if (attendee.role) uniqueOffices.add(attendee.role);
      }
    }

    // Outreach open rate from stats JSON
    const outreachSent = outreachRecords.length;
    let totalOpens = 0;
    for (const rec of outreachRecords) {
      const stats = rec.stats as Record<string, unknown>;
      if (typeof stats?.opens === 'number') totalOpens += stats.opens;
    }
    const outreachOpenRate = outreachSent > 0 ? totalOpens / outreachSent : 0;

    // Intelligence metrics via confirmed mappings
    const [roi, trackedBillsCount, competitorCount] = await Promise.all([
      this.getLobbyRoi(clientId),
      this.getTrackedBillsCount(clientId),
      this.getCompetitorCount(clientId),
    ]);

    // Weekly engagement health trend
    const weekCount = Math.min(Math.floor(days / 7), 13);
    const healthTrendRows: Array<{ start: Date; end: Date }> = [];
    for (let i = weekCount - 1; i >= 0; i--) {
      const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      healthTrendRows.push({ start: weekStart, end: weekEnd });
    }

    const healthTrend: Array<{ week: string; score: number }> = await Promise.all(
      healthTrendRows.map(async (w) => {
        const [wMeet, wMail, wTask, wDebrief, wOutreach] = await Promise.all([
          this.prisma.withTenant(tenantId, (tx) =>
            tx.meeting.count({ where: { clientId, startsAt: { gte: w.start, lt: w.end } } }),
          ),
          this.prisma.withTenant(tenantId, (tx) =>
            tx.mailThread.count({ where: { clientId, lastMessageAt: { gte: w.start, lt: w.end } } }),
          ),
          this.prisma.withTenant(tenantId, (tx) =>
            tx.engagementTask.count({
              where: { clientId, status: EngagementTaskStatus.done, updatedAt: { gte: w.start, lt: w.end } },
            }),
          ),
          this.prisma.withTenant(tenantId, (tx) =>
            tx.meetingDebrief.count({ where: { clientId, createdAt: { gte: w.start, lt: w.end } } }),
          ),
          this.prisma.withTenant(tenantId, (tx) =>
            tx.outreachRecord.count({ where: { clientId, sentAt: { gte: w.start, lt: w.end } } }),
          ),
        ]);
        const score = Math.min(
          100,
          Math.round((wMeet * 15 + wMail * 2 + wTask * 10 + wDebrief * 20 + wOutreach * 5) / 100 * 100),
        );
        return { week: w.end.toISOString().split('T')[0]!, score };
      }),
    );

    // AI forward-look
    const contextLines = [
      `CLIENT: ${client.name}`,
      `PERIOD: ${start.toLocaleDateString()} – ${now.toLocaleDateString()} (${period === 'quarter' ? 'Q90d' : 'Annual'})`,
      `MEETINGS: ${meetings.length} (${uniqueOffices.size} unique offices met)`,
      `OUTREACH: ${outreachSent} sent, ${(outreachOpenRate * 100).toFixed(0)}% open rate`,
      `TASKS COMPLETED: ${tasksCompleted}`,
      `DEBRIEFS FILED: ${debriefs}`,
      `MAIL THREADS ACTIVE: ${mailThreads}`,
      `BILLS TRACKED: ${trackedBillsCount}`,
      `LOBBY SPEND (all-time): $${roi.lobbySpend.toLocaleString()}`,
      `CONTRACT WINS (all-time): $${roi.contractWins.toLocaleString()}`,
      `COMPETITOR COUNT: ${competitorCount}`,
      `SUBMISSIONS THIS PERIOD:`,
      ...submissions.map((s) => `  - ${s.title} (FY${s.fiscalYear}): ${s.outcomeType}`),
    ];

    const aiPrompt = `Based on this client's activity and intelligence data for the past ${period === 'quarter' ? 'quarter (90 days)' : 'year'}, write a 3-paragraph forward-looking assessment: (1) key accomplishments and wins, (2) emerging risks and opportunities, (3) recommended priorities for next period. Be specific and cite the data points provided.\n\n${contextLines.join('\n')}`;

    const aiForwardLook = await this.insightGen.generateFreeText(aiPrompt).catch(() => '');

    // Period label
    const quarterNum = Math.ceil((now.getMonth() + 1) / 3);
    const periodLabel =
      period === 'quarter' ? `Q${quarterNum} FY${now.getFullYear()}` : `FY${now.getFullYear()}`;

    return {
      client: { id: client.id, name: client.name, sectorTag: client.sectorTag ?? null },
      tenant: { name: tenant?.name ?? '', logoS3Key: tenant?.logoS3Key ?? null },
      period: { start, end: now, label: periodLabel },
      activity: {
        meetings: meetings.length,
        uniqueOffices: Array.from(uniqueOffices).slice(0, 20),
        outreachSent,
        outreachOpenRate,
        tasksCompleted,
        debriefsFiled: debriefs,
        mailThreads,
      },
      intelligence: {
        billsTracked: trackedBillsCount,
        billsByStatus: {},
        competitorCount,
        lobbySpend: roi.lobbySpend,
        contractWins: roi.contractWins,
      },
      outcomes: submissions.map((s) => ({
        title: s.title,
        fiscalYear: s.fiscalYear,
        outcomeType: s.outcomeType,
        capability: s.capability?.name ?? null,
        notes: s.notes ?? null,
      })),
      healthTrend,
      aiForwardLook,
      generatedAt: now.toISOString(),
    };
  }

  private async getLobbyRoi(clientId: string) {
    const [ldaMapping, contractingMapping] = await Promise.all([
      this.prisma.clientIntelMapping.findFirst({ where: { clientId, source: 'lda', confirmed: true } }),
      this.prisma.clientIntelMapping.findFirst({ where: { clientId, source: 'contracting', confirmed: true } }),
    ]);

    let lobbySpend = 0;
    let contractWins = 0;

    if (ldaMapping) {
      const rows = await this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COALESCE(SUM(income), 0)::float AS total
        FROM lda_filing WHERE client_id = ${Number(ldaMapping.externalId)}
      `;
      lobbySpend = rows[0]?.total ?? 0;
    }

    if (contractingMapping) {
      const rows = await this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COALESCE(total_contracts, 0)::float AS total
        FROM federal_contractor WHERE id = ${contractingMapping.externalId}::uuid
      `;
      contractWins = rows[0]?.total ?? 0;
    }

    return { lobbySpend, contractWins };
  }

  private async getTrackedBillsCount(clientId: string) {
    const ldaMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'lda', confirmed: true },
    });
    if (!ldaMapping) return 0;

    const codeRows = await this.prisma.$queryRaw<Array<{ issue_codes: string[] }>>`
      SELECT COALESCE(issue_codes, '{}') AS issue_codes
      FROM lda_client WHERE id = ${Number(ldaMapping.externalId)}
    `;
    const issueCodes = codeRows[0]?.issue_codes ?? [];
    if (!issueCodes.length) return 0;

    const nameRows = await this.prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM lda_issue_code WHERE code = ANY(${issueCodes}::text[])
    `;
    if (!nameRows.length) return 0;

    const patterns = nameRows.map((r) => `%${r.name.toLowerCase()}%`);
    const countRows = await this.prisma.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(DISTINCT cb.id)::text AS count
      FROM congress_bill cb
      JOIN congress_bill_subject cbs ON cbs.bill_id = cb.id
      WHERE LOWER(cbs.name) ILIKE ANY(${patterns}::text[])
    `;
    return parseInt(countRows[0]?.count ?? '0', 10);
  }

  private async getCompetitorCount(clientId: string) {
    const ldaMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'lda', confirmed: true },
    });
    if (!ldaMapping) return 0;

    const ldaClientId = Number(ldaMapping.externalId);
    const codeRows = await this.prisma.$queryRaw<Array<{ issue_codes: string[] }>>`
      SELECT COALESCE(issue_codes, '{}') AS issue_codes FROM lda_client WHERE id = ${ldaClientId}
    `;
    const issueCodes = codeRows[0]?.issue_codes ?? [];
    if (!issueCodes.length) return 0;

    const countRows = await this.prisma.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(DISTINCT id)::text AS count FROM lda_client
      WHERE issue_codes && ${issueCodes}::text[] AND id != ${ldaClientId}
    `;
    return parseInt(countRows[0]?.count ?? '0', 10);
  }
}
