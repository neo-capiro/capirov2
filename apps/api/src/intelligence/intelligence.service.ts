import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EngagementTaskStatus } from '@prisma/client';
import {
  AGENCY_SECTOR_MAP,
  ldaCodesForSectors,
  normalizeSector,
  type SectorTag,
} from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { EMBEDDING_MODEL, embedText, normalize, vectorLiteral } from '../embeddings/embedder.js';
import { classifyTrajectory } from './trajectory-classifier.model.js';
import { addDateInZone, dateBoundsInZone, dayBoundsInZone } from './time-bounds.js';
import { FEC_DISCLAIMER } from './fec-disclaimer.js';

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private asFinite(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private asFiniteOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private asIsoOrNull(value: unknown): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === 'string') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }

  private normalizeProfileV1Sections(sections: {
    snapshot: Record<string, any>;
    financialFootprint: Record<string, any>;
    legislativeRegulatory: Record<string, any>;
    relationships: Record<string, any>;
  }) {
    const snapshot = {
      ...sections.snapshot,
      changes7dCount: Math.max(0, Math.trunc(this.asFinite(sections.snapshot.changes7dCount, 0))),
      activity14d: Array.isArray(sections.snapshot.activity14d)
        ? [...sections.snapshot.activity14d].sort((a, b) => String(a?.date ?? '').localeCompare(String(b?.date ?? '')))
        : [],
      topAlerts: Array.isArray(sections.snapshot.topAlerts)
        ? sections.snapshot.topAlerts.map((a: Record<string, unknown>) => ({
            ...a,
            when: this.asIsoOrNull(a.when),
            countdownDays: this.asFiniteOrNull(a.countdownDays),
          }))
        : [],
    };

    const financialFootprint = {
      ...sections.financialFootprint,
      districtNexus: {
        ...(sections.financialFootprint.districtNexus ?? {}),
        topDistricts: Array.isArray(sections.financialFootprint?.districtNexus?.topDistricts)
          ? [...sections.financialFootprint.districtNexus.topDistricts]
              .sort((a, b) => this.asFinite(b?.jobs, 0) - this.asFinite(a?.jobs, 0))
              .slice(0, 5)
          : [],
      },
    };

    const stageOrder = ['introduced', 'committee', 'passed', 'enacted'];
    const legislativeRegulatory = {
      ...sections.legislativeRegulatory,
      kanban: {
        ...(sections.legislativeRegulatory.kanban ?? {}),
        columns: Array.isArray(sections.legislativeRegulatory?.kanban?.columns)
          ? [...sections.legislativeRegulatory.kanban.columns]
              .sort((a, b) => stageOrder.indexOf(String(a?.id)) - stageOrder.indexOf(String(b?.id)))
              .map((c) => ({
                ...c,
                count: Math.max(0, Math.trunc(this.asFinite(c?.count, 0))),
                bills: Array.isArray(c?.bills)
                  ? [...c.bills].sort((x, y) => this.asFinite(y?.probability, 0) - this.asFinite(x?.probability, 0))
                  : [],
              }))
          : [],
      },
      hearingsAndMarkups: Array.isArray(sections.legislativeRegulatory.hearingsAndMarkups)
        ? [...sections.legislativeRegulatory.hearingsAndMarkups]
            .map((h) => ({ ...h, date: this.asIsoOrNull(h?.date) }))
            .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
        : [],
    };

    const relationships = {
      ...sections.relationships,
      exStafferCount: Math.max(0, Math.trunc(this.asFinite(sections.relationships.exStafferCount, 0))),
      officeRecommender: Array.isArray(sections.relationships.officeRecommender)
        ? [...sections.relationships.officeRecommender]
            .sort((a, b) => this.asFinite(b?.score, 0) - this.asFinite(a?.score, 0))
            .slice(0, 12)
        : [],
    };

    return { snapshot, financialFootprint, legislativeRegulatory, relationships };
  }

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
    const existingMappings = await this.prisma.withTenant(tenantId, (tx) =>
      tx.clientIntelMapping.findMany({
        where: { clientId },
        orderBy: { confidence: 'desc' },
      }),
    );

    const confirmedBySource = new Map<string, string>(); // source → externalId
    for (const m of existingMappings) {
      if (m.confirmed && !confirmedBySource.has(m.source)) {
        confirmedBySource.set(m.source, m.externalId);
      }
    }

    // 3. Resolve each source, use confirmed mapping if present, else fuzzy match
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

  /**
   * Client Profile / Intel Tab, redesigned v1 aggregate payload.
   * Opinionated 4-section contract so the frontend can render a single
   * anchored surface without stitching 10+ calls client-side.
   */
  async getClientProfileV1(clientId: string, tenantId: string) {
    const client = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findFirst({
        where: { id: clientId },
        select: { id: true, name: true },
      }),
    );
    if (!client) throw new NotFoundException('Client not found');

    const now = new Date();
    const day14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const day21 = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const mappingRowsPromise = this.prisma.withTenant(tenantId, (tx) =>
      tx.clientIntelMapping.findMany({
        where: { clientId },
        select: { source: true, confirmed: true, externalId: true },
      }),
    );

    // Each source is resolved independently via allSettled so one failing
    // builder (a missing sync table, a tenant without a given mapping, a slow
    // query) degrades only its own section instead of rejecting the whole
    // aggregate and blanking every section at once. Failures are logged with
    // the source label so production issues are diagnosable.
    const settled = await Promise.allSettled([
      this.getClientProfile(clientId, tenantId),
      this.getLobbyingRoi(clientId, tenantId),
      this.getFecMoneyFlow(clientId, tenantId),
      this.getDistrictNexus(clientId, tenantId),
      this.getTrackedBills(clientId, tenantId),
      this.getBillRegulationLinks(clientId, tenantId),
      this.getKnowledgeGraph(clientId, tenantId),
      this.computeEngagementHealth(clientId, tenantId),
      this.getExStaffers(clientId, tenantId),
      this.getCommentPeriodAlerts(tenantId),
      this.getChanges(tenantId, day7.toISOString(), clientId),
      this.prisma.committeeHearing.findMany({
        where: { date: { gte: now, lte: day21 } },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: 40,
      }),
      this.prisma.withTenant(tenantId, (tx) =>
        tx.meeting.findMany({
          where: { clientId, startsAt: { gte: day14 } },
          select: { startsAt: true },
          orderBy: { startsAt: 'asc' },
        }),
      ),
      this.prisma.withTenant(tenantId, (tx) =>
        tx.mailThread.findMany({
          where: { clientId, lastMessageAt: { gte: day14 } },
          select: { lastMessageAt: true },
          orderBy: { lastMessageAt: 'asc' },
        }),
      ),
      this.prisma.withTenant(tenantId, (tx) =>
        tx.engagementTask.findMany({
          where: {
            clientId,
            status: EngagementTaskStatus.done,
            updatedAt: { gte: day14 },
          },
          select: { updatedAt: true },
          orderBy: { updatedAt: 'asc' },
        }),
      ),
      this.prisma.withTenant(tenantId, (tx) =>
        tx.meetingDebrief.findMany({
          where: { clientId, createdAt: { gte: day14 } },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      // Outreach sent per day, feeds the 5th Activity row in the snapshot
      // panel (Meetings / Outreach sent / Tasks done / Bills tracked /
      // Critical alerts). Mockup spec requires this row; previously only
      // surfaced as an aggregate inside computeEngagementHealth.
      this.prisma.withTenant(tenantId, (tx) =>
        tx.outreachRecord.findMany({
          where: { clientId, sentAt: { gte: day14 } },
          select: { sentAt: true },
          orderBy: { sentAt: 'asc' },
        }),
      ),
      mappingRowsPromise,
    ]);

    const settledSourceLabels = [
      'profile', 'lobbyingRoi', 'fecMoneyFlow', 'districtNexus', 'trackedBills',
      'billRegulationLinks', 'knowledgeGraph', 'engagementHealth', 'exStaffers',
      'commentAlerts', 'changes', 'hearings', 'meetings', 'mailThreads',
      'doneTasks', 'debriefs', 'outreachRecords', 'mappingRows',
    ] as const;

    const settle = <T,>(index: number, fallback: T): T => {
      const result = settled[index];
      if (result && result.status === 'fulfilled') return result.value as T;
      const reason = result && result.status === 'rejected' ? result.reason : 'unknown';
      this.logger.warn(
        `profile-v1 source "${settledSourceLabels[index]}" failed for client ${clientId}: ${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      );
      return fallback;
    };

    // `profile` is the spine of the response (drives identity + trajectory).
    // If it failed we can't build a coherent aggregate, so surface the error.
    if (settled[0].status === 'rejected') throw settled[0].reason;
    const profile = settled[0].value as Awaited<ReturnType<typeof this.getClientProfile>>;

    const roi = settle(1, { lobbySpend: 0, contractWins: 0, roi: null, gap: 0, mappedLdaClientId: null } as Awaited<ReturnType<typeof this.getLobbyingRoi>>);
    const fec = settle(2, { clientId, clientName: client.name, mappedEmployer: null, contributionType: 'individual_employer_linked' as const, summary: { totalContributions: 0, totalAmount: 0, committeeCount: 0, candidateCount: 0, memberCount: 0, billCount: 0 }, committees: [], pacGiving: { tracked: false, committees: [], summary: { totalAmount: 0, disbursementCount: 0, recipientCount: 0 } }, disclaimer: FEC_DISCLAIMER } as unknown as Awaited<ReturnType<typeof this.getFecMoneyFlow>>);
    const district = settle(3, { capabilities: [] } as unknown as Awaited<ReturnType<typeof this.getDistrictNexus>>);
    const trackedBills = settle(4, { total: 0, issueCodes: [], bills: [] } as Awaited<ReturnType<typeof this.getTrackedBills>>);
    const regLinks = settle(5, { totalBills: 0, totalRegulations: 0, rails: [] } as unknown as Awaited<ReturnType<typeof this.getBillRegulationLinks>>);
    const graph = settle(6, { nodes: [], edges: [], resolutionQuality: { avgConfidence: 0, confirmedCount: 0, unconfirmedCount: 0 } } as unknown as Awaited<ReturnType<typeof this.getKnowledgeGraph>>);
    const health = settle(7, null as unknown as Awaited<ReturnType<typeof this.computeEngagementHealth>>);
    const exStaffers = settle(8, { lobbyists: [] } as unknown as Awaited<ReturnType<typeof this.getExStaffers>>);
    const commentAlerts = settle(9, { alerts: [] } as Awaited<ReturnType<typeof this.getCommentPeriodAlerts>>);
    const changes = settle(10, [] as Awaited<ReturnType<typeof this.getChanges>>);
    const hearings = settle(11, [] as Awaited<ReturnType<typeof this.prisma.committeeHearing.findMany>>);
    const meetings = settle(12, [] as Array<{ startsAt: Date }>);
    const threads = settle(13, [] as Array<{ lastMessageAt: Date | null }>);
    const doneTasks = settle(14, [] as Array<{ updatedAt: Date }>);
    const debriefs = settle(15, [] as Array<{ createdAt: Date }>);
    const outreachRows = settle(16, [] as Array<{ sentAt: Date }>);
    const mappingRows = settle(17, [] as Array<{ source: string; confirmed: boolean; externalId: string | null }>);

    // Freshness + unresolved metadata derived from the tenant-scoped mapping query.
    // mappingRows is fetched via withTenant, clientId is guaranteed to belong to tenantId.
    const confirmedSources = new Set(mappingRows.filter((m) => m.confirmed).map((m) => m.source));
    const sourceCount = confirmedSources.size;
    const unresolvedMappings = mappingRows.filter((m) => !m.confirmed).length;

    const byDay = new Map<
      string,
      {
        date: string;
        meetings: number;
        emails: number;
        tasks: number;
        debriefs: number;
        outreach: number;
      }
    >();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { date: key, meetings: 0, emails: 0, tasks: 0, debriefs: 0, outreach: 0 });
    }
    for (const row of meetings) {
      const key = row.startsAt.toISOString().slice(0, 10);
      const slot = byDay.get(key);
      if (slot) slot.meetings += 1;
    }
    for (const row of threads) {
      if (!row.lastMessageAt) continue;
      const key = row.lastMessageAt.toISOString().slice(0, 10);
      const slot = byDay.get(key);
      if (slot) slot.emails += 1;
    }
    for (const row of doneTasks) {
      const key = row.updatedAt.toISOString().slice(0, 10);
      const slot = byDay.get(key);
      if (slot) slot.tasks += 1;
    }
    for (const row of debriefs) {
      const key = row.createdAt.toISOString().slice(0, 10);
      const slot = byDay.get(key);
      if (slot) slot.debriefs += 1;
    }
    for (const row of outreachRows) {
      if (!row.sentAt) continue;
      const key = row.sentAt.toISOString().slice(0, 10);
      const slot = byDay.get(key);
      if (slot) slot.outreach += 1;
    }

    const severityRank = (severity: string): number => {
      if (severity === 'critical') return 3;
      if (severity === 'notable') return 2;
      return 1;
    };

    const countdownLabel = (days: number | null): string | null => {
      if (days == null) return null;
      if (days < 0) return `Overdue ${Math.abs(days)}d`;
      if (days === 0) return 'Due today';
      if (days === 1) return '1d left';
      return `${days}d left`;
    };

    const recencyLabel = (whenIso: string): string => {
      const when = new Date(whenIso);
      const diffMs = now.getTime() - when.getTime();
      const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return '1d ago';
      return `${diffDays}d ago`;
    };

    const commentAlertsForClient = commentAlerts.alerts.filter((a) => a.clientId === clientId);

    const topAlerts = [
      ...commentAlertsForClient.map((a) => {
        const days = a.daysToDeadline ?? null;
        return {
          id: `comment:${a.documentId}`,
          type: 'comment_deadline',
          severity: a.severity,
          title: a.title,
          subtitle: a.agencies.slice(0, 2).join(' / '),
          when: a.commentEndDate.toISOString(),
          countdownDays: days,
          countdownLabel: countdownLabel(days),
          href: `/intelligence/changes?clientId=${encodeURIComponent(clientId)}&source=comment_deadline`,
          _urgencyScore: days == null ? 0 : 100 - Math.max(-30, Math.min(days, 100)),
          _typeRank: 2,
        };
      }),
      ...changes.map((c) => {
        const daysAgo = Math.max(0, Math.floor((now.getTime() - c.detectedAt.getTime()) / (1000 * 60 * 60 * 24)));
        return {
          id: `change:${c.id}`,
          type: c.changeType,
          severity: c.severity,
          title: c.title,
          subtitle: c.source,
          when: c.detectedAt.toISOString(),
          countdownDays: null as number | null,
          countdownLabel: recencyLabel(c.detectedAt.toISOString()),
          href: `/intelligence/changes?clientId=${encodeURIComponent(clientId)}&changeId=${encodeURIComponent(c.id)}`,
          _urgencyScore: 40 - Math.min(daysAgo, 40),
          _typeRank: 1,
        };
      }),
    ]
      .sort((a, b) => {
        const sev = severityRank(b.severity) - severityRank(a.severity);
        if (sev !== 0) return sev;
        const type = b._typeRank - a._typeRank;
        if (type !== 0) return type;
        const urgency = b._urgencyScore - a._urgencyScore;
        if (urgency !== 0) return urgency;
        return b.when.localeCompare(a.when);
      })
      .slice(0, 5)
      .map(({ _urgencyScore, _typeRank, ...alert }) => alert);

    const criticalDeadlines = commentAlertsForClient.filter((a) => (a.daysToDeadline ?? 999) <= 7).length;
    const briefingHighlights: Array<{
      label: string;
      value: string | number | null;
      tone: 'critical' | 'notable' | 'info' | 'neutral';
    }> = [];

    if (criticalDeadlines > 0) {
      briefingHighlights.push({
        label: 'Deadlines',
        value: `${criticalDeadlines} due ≤7d`,
        tone: 'critical',
      });
    }
    if (trackedBills.total > 0) {
      briefingHighlights.push({
        label: 'Bills tracked',
        value: trackedBills.total,
        tone: 'notable',
      });
    }
    if ((roi.lobbySpend ?? 0) > 0) {
      briefingHighlights.push({
        label: 'Lobbying TTM',
        value: Math.round(roi.lobbySpend),
        tone: 'info',
      });
    }
    if (changes.length > 0) {
      briefingHighlights.push({
        label: 'New events (7d)',
        value: changes.length,
        tone: 'info',
      });
    }

    if (briefingHighlights.length === 0) {
      briefingHighlights.push({
        label: 'Status',
        value: 'Monitoring for new intelligence signals',
        tone: 'neutral',
      });
    }

    const fallbackSummaryParts: string[] = [];
    if (criticalDeadlines > 0) {
      fallbackSummaryParts.push(`${criticalDeadlines} comment deadline${criticalDeadlines === 1 ? '' : 's'} due within 7 days.`);
    }
    if (trackedBills.total > 0) {
      fallbackSummaryParts.push(`${trackedBills.total} bill${trackedBills.total === 1 ? '' : 's'} currently tracked.`);
    }
    fallbackSummaryParts.push(
      changes.length > 0
        ? `${changes.length} intelligence change${changes.length === 1 ? '' : 's'} detected this week.`
        : 'No new intelligence changes detected this week.',
    );

    const aiSummaryRaw = (profile as { aiSummary?: string | null }).aiSummary;
    const aiSummary = typeof aiSummaryRaw === 'string' ? aiSummaryRaw.trim() : '';

    const briefingSummary =
      aiSummary ||
      fallbackSummaryParts.join(' ') ||
      `No intelligence updates available for ${client.name}.`;

    const changesInboxHref = `/intelligence/changes?clientId=${encodeURIComponent(clientId)}`;
    const dailyBriefing = {
      summary: briefingSummary,
      highlights: briefingHighlights.slice(0, 4),
      generatedAt: now.toISOString(),
      eventCount: changes.length,
      ctaHref: changesInboxHref,
    };

    const billStage = (latestActionText: string | null | undefined): 'introduced' | 'committee' | 'passed' | 'enacted' => {
      const txt = (latestActionText ?? '').toLowerCase();
      if (/signed|enacted|public law|pl\s+\d/.test(txt)) return 'enacted';
      if (/passed|agreed to/.test(txt)) return 'passed';
      if (/committee|referred|reported|markup/.test(txt)) return 'committee';
      return 'introduced';
    };
    const passageProbability = (latestActionText: string | null | undefined): number => {
      const stage = billStage(latestActionText);
      if (stage === 'enacted') return 0.98;
      if (stage === 'passed') return 0.72;
      if (stage === 'committee') return 0.46;
      return 0.24;
    };

    const kanbanColumns: Array<{
      id: 'introduced' | 'committee' | 'passed' | 'enacted';
      label: string;
      count: number;
      bills: Array<{
        identifier: string;
        title: string;
        latestActionDate: Date | null;
        latestActionText: string | null;
        probability: number;
      }>;
    }> = [
      { id: 'introduced', label: 'Introduced', count: 0, bills: [] },
      { id: 'committee', label: 'In Committee', count: 0, bills: [] },
      { id: 'passed', label: 'Passed Chamber', count: 0, bills: [] },
      { id: 'enacted', label: 'Enacted', count: 0, bills: [] },
    ];
    const columnById = new Map(kanbanColumns.map((c) => [c.id, c]));
    for (const bill of trackedBills.bills) {
      const stage = billStage(bill.latestActionText);
      const col = columnById.get(stage);
      if (!col) continue;
      col.count += 1;
      col.bills.push({
        identifier: bill.identifier,
        title: bill.title,
        latestActionDate: bill.latestActionDate ? new Date(bill.latestActionDate) : null,
        latestActionText: bill.latestActionText,
        probability: passageProbability(bill.latestActionText),
      });
    }
    for (const col of kanbanColumns) {
      col.bills.sort((a, b) => b.probability - a.probability);
      col.bills = col.bills.slice(0, 12);
    }

    const regDocByNumber = new Map<
      string,
      {
        documentNumber: string;
        title: string;
        agencyNames: string[];
        publicationDate: Date;
        commentEndDate: Date | null;
        linkedBills: string[];
      }
    >();
    for (const link of regLinks.links) {
      for (const reg of link.regulations) {
        const existing = regDocByNumber.get(reg.documentNumber);
        if (existing) {
          if (!existing.linkedBills.includes(link.bill.identifier)) {
            existing.linkedBills.push(link.bill.identifier);
          }
          continue;
        }
        regDocByNumber.set(reg.documentNumber, {
          documentNumber: reg.documentNumber,
          title: reg.title,
          agencyNames: reg.agencyNames,
          publicationDate: new Date(reg.publicationDate),
          commentEndDate: reg.commentEndDate ? new Date(reg.commentEndDate) : null,
          linkedBills: [link.bill.identifier],
        });
      }
    }
    const regulatoryRails = Array.from(regDocByNumber.values())
      .sort((a, b) => b.publicationDate.getTime() - a.publicationDate.getTime())
      .slice(0, 8)
      .map((reg) => ({
        documentNumber: reg.documentNumber,
        title: reg.title,
        agencyNames: reg.agencyNames,
        linkedBills: reg.linkedBills,
        currentStage: 'NPRM',
        deadline: reg.commentEndDate,
        stages: [
          { key: 'bill', label: 'Bill' },
          { key: 'anprm', label: 'ANPRM' },
          { key: 'nprm', label: 'NPRM' },
          { key: 'final', label: 'Final' },
          { key: 'effective', label: 'Effective' },
        ],
      }));

    const trackedBillIds = new Set(trackedBills.bills.map((b) => b.identifier.toLowerCase()));
    const hearingsList = hearings.map((h) => {
      const titleLower = h.title.toLowerCase();
      const linked = trackedBills.bills
        .filter((b) => titleLower.includes(b.identifier.toLowerCase()))
        .map((b) => b.identifier);
      return {
        id: h.id,
        committeeName: h.committeeName,
        chamber: h.chamber,
        title: h.title,
        date: h.date,
        time: h.time,
        type: h.type,
        linkedBills: linked,
        isTracked: linked.length > 0 || Array.from(trackedBillIds).some((id) => titleLower.includes(id)),
      };
    });

    const districtRows = district.capabilities
      .flatMap((cap) =>
        cap.districts.map((d) => ({
          district: `${d.state}-${d.district}`,
          jobs: cap.totalSupportedJobs ?? 0,
          capability: cap.capabilityName,
          dataYear: d.dataYear,
        })),
      )
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 5);

    const sponsorMembers = new Map<string, { name: string; billCount: number; exStaffer: boolean }>();
    for (const bill of trackedBills.bills) {
      const member = (bill.sponsorName ?? '').trim();
      if (!member) continue;
      const key = member.toLowerCase();
      if (!sponsorMembers.has(key)) {
        sponsorMembers.set(key, { name: member, billCount: 0, exStaffer: false });
      }
      sponsorMembers.get(key)!.billCount += 1;
    }
    const exStafferNames = exStaffers.lobbyists.map((l) => l.name.toLowerCase());
    for (const [key, value] of sponsorMembers.entries()) {
      const sponsorLast = key.split(' ').pop() ?? key;
      value.exStaffer = exStaffers.lobbyists.some((l) =>
        l.coveredPositions.some((p) => {
          const posTitle =
            p && typeof p === 'object' && typeof (p as Record<string, unknown>).position_title === 'string'
              ? ((p as Record<string, unknown>).position_title as string).toLowerCase()
              : '';
          return posTitle.includes(sponsorLast);
        }),
      );
    }

    const committeeNames = Array.from(new Set(hearingsList.map((h) => h.committeeName).filter(Boolean))).slice(0, 12);
    const topDistrictWeight = districtRows.length ? districtRows[0]!.jobs : 0;
    const hasFecSignal = (fec.summary?.totalAmount ?? 0) > 0;

    const sponsorRecommendations = Array.from(sponsorMembers.values())
      .map((member) => {
        const committeeWeight = Math.min(1, member.billCount / 4);
        const districtWeight = topDistrictWeight > 0 ? 0.2 : 0;
        const exStafferWeight = member.exStaffer ? 0.3 : 0;
        const fecWeight = hasFecSignal ? 0.15 : 0;
        const score = Math.min(1, 0.35 + committeeWeight * 0.35 + districtWeight + exStafferWeight + fecWeight);

        const tags = [
          { key: 'sponsor', on: true },
          { key: 'district', on: districtWeight > 0 },
          { key: 'ex-staffer', on: exStafferWeight > 0 },
          { key: 'fec', on: fecWeight > 0 },
        ]
          .filter((t) => t.on)
          .map((t) => t.key);

        return {
          office: member.name,
          score,
          tags,
          billCount: member.billCount,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    // Fallback signal: congress bill `sponsor_name` is not populated for most
    // synced bills, so the sponsor-based recommender returns nothing even for
    // clients tracking hundreds of bills. Committee-of-jurisdiction IS
    // populated (congress_bill_committee), so rank the committees that handle
    // the client's tracked bills — "which offices have jurisdiction over what
    // you track" is the actionable recommendation when sponsors are missing.
    let committeeRecommendations: Array<{ office: string; score: number; tags: string[]; billCount: number }> = [];
    if (sponsorRecommendations.length === 0) {
      const trackedBillIds = trackedBills.bills
        .map((b) => b.identifier)
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (trackedBillIds.length > 0) {
        try {
          const jurisdictionRows = await this.prisma.$queryRaw<
            Array<{ committee_name: string; chamber: string | null; bill_count: number }>
          >`
            SELECT cbc.committee_name,
                   MAX(cbc.chamber) AS chamber,
                   COUNT(DISTINCT cbc.bill_id)::int AS bill_count
            FROM congress_bill_committee cbc
            WHERE cbc.bill_id = ANY(${trackedBillIds}::text[])
              AND cbc.committee_name IS NOT NULL
              AND cbc.committee_name <> ''
            GROUP BY cbc.committee_name
            ORDER BY bill_count DESC, cbc.committee_name ASC
            LIMIT 6
          `;
          const maxBills = Number(jurisdictionRows[0]?.bill_count ?? 0);
          committeeRecommendations = jurisdictionRows.map((row) => {
            const count = Number(row.bill_count);
            const share = maxBills > 0 ? count / maxBills : 0;
            const tags = ['committee'];
            if (hasFecSignal) tags.push('fec');
            return {
              office: row.chamber ? `${row.committee_name} · ${row.chamber}` : row.committee_name,
              score: Math.min(1, 0.45 + share * 0.5),
              tags,
              billCount: count,
            };
          });
        } catch (err) {
          this.logger.warn(
            `office-recommender committee fallback failed for client ${clientId}: ${(err as Error).message}`,
          );
        }
      }
    }

    const officeRecommendations =
      sponsorRecommendations.length > 0 ? sponsorRecommendations : committeeRecommendations;

    const scopedGraph = {
      nodes: graph.nodes
        .filter((n) => ['lobbyist', 'agency', 'registrant'].includes(n.type) || n.id.startsWith('member:'))
        .slice(0, 40),
      edges: graph.edges.slice(0, 80),
      resolutionQuality: graph.resolutionQuality,
      meta: {
        lobbyistCount: exStaffers.lobbyists.length,
        memberCount: sponsorMembers.size,
        committeeCount: committeeNames.length,
      },
      hints: {
        exStafferNames,
      },
    };

    const hasLobbyingTtm = (roi.lobbySpend ?? 0) > 0;
    const hasObligationsTtm = (roi.contractWins ?? 0) > 0;
    const heroTruthState: 'normal' | 'zero_obligation' | 'no_activity' =
      hasLobbyingTtm && !hasObligationsTtm
        ? 'zero_obligation'
        : hasLobbyingTtm || hasObligationsTtm
          ? 'normal'
          : 'no_activity';

    const quarterRoiSeries = await this.buildRoiQuarterSeries({
      mappedLdaClientId: roi.mappedLdaClientId,
      lobbyingYearly: profile.lda.yearlySpend,
      obligationsYearly: profile.contracting.yearlySpend,
      now,
    });

    const trajectoryModel = classifyTrajectory({
      yearlySpend: profile.lda.yearlySpend,
      growthRate: profile.lobbyIntel.growthRate,
      totalSpending: profile.lobbyIntel.totalSpending,
      sourceLabel: profile.lobbyIntel.trajectory,
    });

    const sections = this.normalizeProfileV1Sections({
      snapshot: {
        trajectory: {
          label: trajectoryModel.label,
          growthRate: profile.lobbyIntel.growthRate,
          totalSpending: profile.lobbyIntel.totalSpending,
          yearlySpend: profile.lda.yearlySpend,
          model: {
            label: trajectoryModel.label,
            confidence: trajectoryModel.confidence,
            score: trajectoryModel.score,
            source: trajectoryModel.source,
          },
          fallback: {
            label: profile.lobbyIntel.trajectory,
          },
        },
        health,
        dailyBriefing,
        topAlerts,
        activity14d: Array.from(byDay.values()),
        changes7dCount: changes.length,
      },
      financialFootprint: {
        hero: {
          lobbyingTtm: roi.lobbySpend,
          obligationsTtm: roi.contractWins,
          returnRatio: roi.roi,
          gap: roi.gap,
          truthState: heroTruthState,
        },
        series: {
          lobbying: profile.lda.yearlySpend,
          obligations: profile.contracting.yearlySpend,
          quarterSeries: quarterRoiSeries,
        },
        fecMoneyFlow: fec,
        districtNexus: {
          topDistricts: districtRows,
          capabilities: district.capabilities,
        },
      },
      legislativeRegulatory: {
        kanban: {
          total: trackedBills.total,
          issueCodes: trackedBills.issueCodes,
          columns: kanbanColumns,
        },
        regulatoryLifecycle: {
          totalLinkedBills: regLinks.totalBills,
          totalRegulations: regLinks.totalRegulations,
          rails: regulatoryRails,
        },
        hearingsAndMarkups: hearingsList,
      },
      relationships: {
        scopedGraph,
        officeRecommender: officeRecommendations,
        exStafferCount: exStaffers.lobbyists.length,
      },
    });

    const primaryIssueCode = trackedBills.issueCodes.find((code) => typeof code === 'string' && code.trim().length > 0)?.trim();
    const competitorIssueHref = primaryIssueCode
      ? `/intelligence/issues/${encodeURIComponent(primaryIssueCode)}`
      : '';

    return {
      client: { id: client.id, name: client.name },
      generatedAt: now.toISOString(),
      meta: {
        schema: 'client-profile-v1',
        sectionOrder: ['snapshot', 'financialFootprint', 'legislativeRegulatory', 'relationships'],
        hasSnapshot: true,
        hasFinancialFootprint: true,
        hasLegislativeRegulatory: true,
        hasRelationships: true,
        generatedAt: now.toISOString(),
        sourceCount,
        unresolvedMappings,
      },
      links: {
        changesInbox: changesInboxHref,
        mappingsAdmin: '/settings/intelligence-mappings',
        competitorIssuePage: competitorIssueHref,
        billDetailBase: '/explorer',
        entityResolutionQueue: '/settings/intelligence-mappings',
      },
      actionTargets: {
        snapshot: {
          seeAllChanges: {
            route: '/intelligence/changes',
            params: { clientId },
            href: changesInboxHref,
          },
          viewAllAlerts: {
            route: '/intelligence/changes',
            params: { clientId },
            href: changesInboxHref,
          },
          mappingsHelp: {
            route: '/settings/intelligence-mappings',
            params: {},
            href: '/settings/intelligence-mappings',
          },
        },
        financial: {
          runFecEnrichment: {
            route: '/settings/intelligence-mappings',
            params: { clientId, source: 'fec_employer' },
            href: '/settings/intelligence-mappings',
          },
          districtSupport: {
            route: '/settings/intelligence-mappings',
            params: { clientId, focus: 'district_nexus' },
            href: '/settings/intelligence-mappings',
          },
        },
        legislative: {
          billDrill: {
            route: '/explorer',
            params: { billIdentifierParam: ':bill' },
            hrefTemplate: '/explorer?bill=:bill',
          },
          syncCalendar: {
            route: '/engagement',
            params: { clientId },
            href: '/engagement',
          },
          setAlerts: {
            route: '/intelligence/changes',
            params: { clientId },
            href: changesInboxHref,
          },
        },
        relationships: {
          officeAll: {
            route: '/intelligence/issues',
            params: { clientId },
            href: '/intelligence/issues',
          },
          officeDrill: {
            route: '/intelligence/issues',
            params: { officeParam: ':office' },
            hrefTemplate: '/intelligence/issues?office=:office',
          },
          graphNodeDrill: {
            route: '/intelligence/issues',
            params: { nodeParam: ':node' },
            hrefTemplate: '/intelligence/issues?node=:node',
          },
        },
      },
      sections,
      movedOut: {
        changesInbox: true,
        entityResolutionQueue: true,
        competitorLeaderboard: true,
        billEnrichment: true,
      },
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
    // Resolve LDA issue codes -> English issue names once, then run
    // embeddings-first bill retrieval with transparent keyword fallback.
    const issueNames: string[] = [];
    if (issueCodes.length) {
      const nameRows = await this.prisma.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM lda_issue_code WHERE code = ANY(${issueCodes}::text[])
      `;
      issueNames.push(...nameRows.map((r) => r.name));
    }

    const allTerms = [...issueNames, ...fallbackTerms]
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter((t) => t.length > 0);
    if (!allTerms.length) return { total: 0, bills: [] };

    const embedded = await this.findRelevantBillsByEmbeddings(allTerms);
    if (embedded) return embedded;

    return this.findRelevantBillsByKeyword(allTerms);
  }

  private async findRelevantBillsByEmbeddings(
    allTerms: string[],
  ): Promise<
    | {
        total: number;
        bills: Array<{
          id: string;
          congress: number;
          billType: string;
          billNumber: string;
          title: string;
          introducedDate: Date | null;
          sponsorName: string | null;
          sponsorParty: string | null;
          sponsorState: string | null;
          latestActionText: string | null;
          latestActionDate: Date | null;
          policyArea: string | null;
          subjects: string[];
        }>;
      }
    | null
  > {
    const query = normalize(`Issue-bill linker query: ${allTerms.join(' ; ')}`);
    if (query.length < 10) return null;

    try {
      const vector = await embedText(query);
      const vecLiteral = vectorLiteral(vector);
      // Relevance floor (cosine similarity): drop weakly-related bills so the
      // linker doesn't surface tangential matches. Mirrors the tracked-bills floor.
      const SIMILARITY_FLOOR = 0.65;
      const candidateRows = await this.prisma.$queryRawUnsafe<Array<{ source_id: string; score: number }>>(
        `SELECT ce.source_id,
                (1 - (ce.embedding <=> $1::vector))::float8 AS score
           FROM context_embeddings ce
          WHERE ce.source_type = 'bill'
            AND ce.model = $2
            AND ce.embedding IS NOT NULL
            AND (1 - (ce.embedding <=> $1::vector)) >= $3
          ORDER BY ce.embedding <=> $1::vector
          LIMIT 150`,
        vecLiteral,
        EMBEDDING_MODEL,
        SIMILARITY_FLOOR,
      );

      const candidateIds = Array.from(
        new Set(
          candidateRows
            .filter((r) => typeof r.source_id === 'string' && r.source_id.trim().length > 0)
            .map((r) => r.source_id.trim()),
        ),
      );
      if (!candidateIds.length) return null;

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
        SELECT cb.id, cb.congress, cb.bill_type, cb.bill_number, cb.title,
               cb.introduced_date, cb.sponsor_name, cb.sponsor_party, cb.sponsor_state,
               cb.latest_action_text, cb.latest_action_date, cb.policy_area, cb.subjects
        FROM congress_bill cb
        WHERE cb.id = ANY(${candidateIds}::text[])
        ORDER BY cb.latest_action_date DESC NULLS LAST
        LIMIT 25
      `;

      if (!rows.length) return null;

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

      return { total: candidateIds.length, bills };
    } catch (error) {
      this.logger.warn(
        `Issue-bill embeddings lookup failed, falling back to keyword matcher: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async findRelevantBillsByKeyword(allTerms: string[]) {
    // Whole-word keyword fallback (legacy source). Keeps behavior stable when
    // embeddings are unavailable or backfill has not populated bill vectors.
    const lowerTerms = allTerms.map((n) => n.toLowerCase());
    const wordPatterns = lowerTerms.map(
      (n) => `\\m${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`,
    );

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
   * The pure exact-equality variant we tried first was too strict, LDA issue
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
   * Pass `tenantClientIds` from the caller, typically resolved once with
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
  async getLobbyingRoi(clientId: string, tenantId: string) {
    const client = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findFirst({ where: { id: clientId }, select: { id: true, name: true } }),
    );
    if (!client) {
      return {
        clientId,
        clientName: null,
        mappedLdaClientId: null,
        mappedContractorId: null,
        lobbySpend: 0,
        contractWins: 0,
        roi: null,
        gap: 0,
      };
    }

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
    return {
      clientId,
      clientName: client.name,
      mappedLdaClientId: ldaMapping?.externalId ?? null,
      mappedContractorId: contractingMapping?.externalId ?? null,
      lobbySpend,
      contractWins,
      roi,
      gap: contractWins - lobbySpend,
    };
  }

  /**
   * Client's OWN PAC giving (Schedule B): disbursements BY committees mapped to
   * this client (confirmed source='fec_committee') TO candidates. Returns
   * tracked:false when no committee is mapped yet, so the UI distinguishes
   * "no PAC mapped" from "PAC mapped, no giving". Read-only, tenant-scoped via mapping.
   */
  private async getPacGiving(clientId: string): Promise<{
    tracked: boolean;
    committees: Array<{
      committeeId: string;
      committeeName: string | null;
      totalAmount: number;
      disbursementCount: number;
      recipients: Array<{ recipientName: string; candidateName: string | null; totalAmount: number }>;
    }>;
    summary: { totalAmount: number; disbursementCount: number; recipientCount: number };
  }> {
    const committeeMappings = await this.prisma.clientIntelMapping.findMany({
      where: { clientId, source: 'fec_committee', confirmed: true },
      select: { externalId: true },
    });
    const committeeIds = Array.from(new Set(committeeMappings.map((m) => m.externalId.trim()).filter(Boolean)));
    if (committeeIds.length === 0) {
      return { tracked: false, committees: [], summary: { totalAmount: 0, disbursementCount: 0, recipientCount: 0 } };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        committee_id: string;
        committee_name: string | null;
        recipient_name: string | null;
        candidate_name: string | null;
        total_amount: number;
        disbursement_count: number;
      }>
    >`
      SELECT
        committee_id,
        MAX(committee_name) AS committee_name,
        recipient_name,
        MAX(candidate_name) AS candidate_name,
        COALESCE(SUM(amount), 0)::float AS total_amount,
        COUNT(*)::int AS disbursement_count
      FROM fec_pac_contribution
      WHERE committee_id = ANY(${committeeIds}::text[])
      GROUP BY committee_id, recipient_name
      ORDER BY total_amount DESC
      LIMIT 500
    `;

    const grouped = new Map<
      string,
      {
        committeeId: string;
        committeeName: string | null;
        totalAmount: number;
        disbursementCount: number;
        recipients: Array<{ recipientName: string; candidateName: string | null; totalAmount: number }>;
      }
    >();
    for (const r of rows) {
      const g = grouped.get(r.committee_id) ?? {
        committeeId: r.committee_id,
        committeeName: r.committee_name,
        totalAmount: 0,
        disbursementCount: 0,
        recipients: [],
      };
      g.totalAmount += r.total_amount;
      g.disbursementCount += r.disbursement_count;
      if (r.recipient_name) {
        g.recipients.push({ recipientName: r.recipient_name, candidateName: r.candidate_name, totalAmount: r.total_amount });
      }
      grouped.set(r.committee_id, g);
    }
    const committees = Array.from(grouped.values()).sort((a, b) => b.totalAmount - a.totalAmount);
    return {
      tracked: true,
      committees,
      summary: {
        totalAmount: committees.reduce((s, c) => s + c.totalAmount, 0),
        disbursementCount: committees.reduce((s, c) => s + c.disbursementCount, 0),
        recipientCount: committees.reduce((s, c) => s + c.recipients.length, 0),
      },
    };
  }

  /**
   * Phase 2.2, FEC money flow trace.
   * contributor_employer (mapped client) → committee → candidate → sponsoring member → committee → bill
   */
  async getFecMoneyFlow(clientId: string, tenantId: string) {
    const client = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findFirst({ where: { id: clientId }, select: { id: true, name: true } }),
    );
    if (!client) {
      return {
        clientId,
        clientName: null,
        mappedEmployer: null,
        summary: {
          totalContributions: 0,
          totalAmount: 0,
          committeeCount: 0,
          candidateCount: 0,
          memberCount: 0,
          billCount: 0,
        },
        contributionType: 'individual_employer_linked' as const,
        committees: [],
        pacGiving: { tracked: false as const, committees: [] as never[] },
        disclaimer: FEC_DISCLAIMER,
      };
    }

    // Client's own PAC giving (Schedule B) — computed once, used in all paths below.
    const pacGiving = await this.getPacGiving(clientId);

    const fecMapping = await this.prisma.clientIntelMapping.findFirst({
      where: { clientId, source: 'fec_employer', confirmed: true },
      orderBy: { confidence: 'desc' },
    });

    const employer = fecMapping?.externalName?.trim() ?? null;
    if (!employer) {
      return {
        clientId,
        clientName: client.name,
        mappedEmployer: null,
        summary: {
          totalContributions: 0,
          totalAmount: 0,
          committeeCount: 0,
          candidateCount: 0,
          memberCount: 0,
          billCount: 0,
        },
        contributionType: 'individual_employer_linked' as const,
        committees: [],
        pacGiving,
        disclaimer: FEC_DISCLAIMER,
      };
    }

    const flowRows = await this.prisma.$queryRaw<
      Array<{
        committee_id: string;
        committee_name: string | null;
        candidate_id: string | null;
        candidate_name: string | null;
        contribution_count: number;
        total_amount: number;
        latest_contribution_date: Date | null;
      }>
    >`
      SELECT
        fc.committee_id,
        MAX(fc.committee_name) AS committee_name,
        fc.candidate_id,
        fc.candidate_name,
        COUNT(*)::int AS contribution_count,
        COALESCE(SUM(fc.amount), 0)::float AS total_amount,
        MAX(fc.contribution_date) AS latest_contribution_date
      FROM fec_contribution fc
      WHERE LOWER(fc.contributor_employer) = LOWER(${employer})
      GROUP BY fc.committee_id, fc.candidate_id, fc.candidate_name
      ORDER BY total_amount DESC
      LIMIT 250
    `;

    const committeeIds = Array.from(new Set(flowRows.map((r) => r.committee_id).filter(Boolean)));
    const candidateNames = Array.from(new Set(flowRows.map((r) => r.candidate_name).filter((v): v is string => Boolean(v))));

    const memberRows = candidateNames.length
      ? await this.prisma.$queryRaw<Array<{ candidate_name: string; member_name: string; bill_count: number }>>`
          SELECT
            x.candidate_name,
            cb.sponsor_name AS member_name,
            COUNT(DISTINCT cb.id)::int AS bill_count
          FROM (
            SELECT UNNEST(${candidateNames}::text[]) AS candidate_name
          ) x
          JOIN congress_bill cb
            ON LOWER(cb.sponsor_name) = LOWER(x.candidate_name)
          GROUP BY x.candidate_name, cb.sponsor_name
        `
      : [];

    const committeeBillRows = committeeIds.length
      ? await this.prisma.$queryRaw<Array<{ committee_id: string; bill_id: string; bill_title: string; sponsor_name: string | null }>>`
          SELECT
            cbc.committee_code AS committee_id,
            cb.id AS bill_id,
            cb.title AS bill_title,
            cb.sponsor_name
          FROM congress_bill_committee cbc
          JOIN congress_bill cb ON cb.id = cbc.bill_id
          WHERE cbc.committee_code = ANY(${committeeIds}::text[])
          ORDER BY cb.latest_action_date DESC NULLS LAST
          LIMIT 500
        `
      : [];

    const memberByCandidate = new Map<string, Array<{ memberName: string; billCount: number }>>();
    for (const r of memberRows) {
      const key = r.candidate_name.toLowerCase();
      const arr = memberByCandidate.get(key) ?? [];
      arr.push({ memberName: r.member_name, billCount: r.bill_count });
      memberByCandidate.set(key, arr);
    }

    const billsByCommittee = new Map<string, Array<{ billId: string; billTitle: string; sponsorName: string | null }>>();
    for (const r of committeeBillRows) {
      const arr = billsByCommittee.get(r.committee_id) ?? [];
      arr.push({ billId: r.bill_id, billTitle: r.bill_title, sponsorName: r.sponsor_name });
      billsByCommittee.set(r.committee_id, arr);
    }

    const grouped = new Map<
      string,
      {
        committeeId: string;
        committeeName: string;
        totalAmount: number;
        contributionCount: number;
        latestContributionDate: Date | null;
        candidates: Array<{
          candidateId: string | null;
          candidateName: string;
          totalAmount: number;
          contributionCount: number;
          linkedMembers: Array<{ memberName: string; billCount: number }>;
        }>;
      }
    >();

    for (const row of flowRows) {
      const committeeName = row.committee_name ?? row.committee_id;
      const candidateName = row.candidate_name ?? 'Unknown candidate';
      if (!grouped.has(row.committee_id)) {
        grouped.set(row.committee_id, {
          committeeId: row.committee_id,
          committeeName,
          totalAmount: 0,
          contributionCount: 0,
          latestContributionDate: row.latest_contribution_date,
          candidates: [],
        });
      }

      const g = grouped.get(row.committee_id)!;
      g.totalAmount += row.total_amount;
      g.contributionCount += row.contribution_count;
      if (
        row.latest_contribution_date &&
        (!g.latestContributionDate || row.latest_contribution_date > g.latestContributionDate)
      ) {
        g.latestContributionDate = row.latest_contribution_date;
      }

      g.candidates.push({
        candidateId: row.candidate_id,
        candidateName,
        totalAmount: row.total_amount,
        contributionCount: row.contribution_count,
        linkedMembers: memberByCandidate.get(candidateName.toLowerCase()) ?? [],
      });
    }

    const committees = Array.from(grouped.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .map((g) => ({
        ...g,
        candidates: g.candidates.sort((a, b) => b.totalAmount - a.totalAmount),
        bills: (billsByCommittee.get(g.committeeId) ?? []).slice(0, 15),
      }));

    const uniqueCandidates = new Set<string>();
    const uniqueMembers = new Set<string>();
    const uniqueBills = new Set<string>();
    for (const c of committees) {
      for (const cand of c.candidates) {
        uniqueCandidates.add(cand.candidateName.toLowerCase());
        for (const m of cand.linkedMembers) uniqueMembers.add(m.memberName.toLowerCase());
      }
      for (const b of c.bills) uniqueBills.add(b.billId);
    }

    const totalAmount = committees.reduce((sum, c) => sum + c.totalAmount, 0);
    const totalContributions = committees.reduce((sum, c) => sum + c.contributionCount, 0);

    return {
      clientId,
      clientName: client.name,
      mappedEmployer: employer,
      // Everything in `committees` is Schedule A (received-by-committee) data keyed by
      // contributor EMPLOYER — i.e. individual filers who list this employer. It is
      // legally distinct from the organization's / its PAC's own giving.
      contributionType: 'individual_employer_linked' as const,
      summary: {
        totalContributions,
        totalAmount,
        committeeCount: committees.length,
        candidateCount: uniqueCandidates.size,
        memberCount: uniqueMembers.size,
        billCount: uniqueBills.size,
      },
      committees,
      // The client's OWN PAC giving (Schedule B committee → candidate disbursements),
      // ingested for committees mapped via confirmed ClientIntelMapping(fec_committee).
      // Kept strictly separate from the individual employer-linked data above.
      pacGiving,
      disclaimer: FEC_DISCLAIMER,
    };
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
  async getExStaffers(clientId: string, tenantId?: string) {
    // Scope: when tenantId is provided (profile-v1 path), verify clientId belongs to
    // that tenant before reading the global client_intel_mapping table (no RLS).
    if (tenantId) {
      const belongs = await this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findFirst({ where: { id: clientId }, select: { id: true } }),
      );
      if (!belongs) return { lobbyists: [] };
    }

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

    const allTerms = [...issueNames, ...capKeywords]
      .map((n) => (typeof n === 'string' ? n.trim() : ''))
      .filter((n) => n.length > 0);
    if (!allTerms.length) return { total: 0, bills: [], issueCodes };

    const embedded = await this.findTrackedBillsByEmbeddings(allTerms);
    if (embedded) {
      return {
        total: embedded.total,
        issueCodes,
        bills: embedded.bills,
      };
    }

    const keyword = await this.findTrackedBillsByKeyword(allTerms);
    return {
      total: keyword.total,
      issueCodes,
      bills: keyword.bills,
    };
  }

  private async findTrackedBillsByEmbeddings(
    allTerms: string[],
  ): Promise<
    | {
        total: number;
        bills: Array<{
          identifier: string;
          title: string;
          latestActionDate: Date | null;
          latestActionText: string | null;
          sponsorName: string | null;
          sponsorParty: string | null;
          subjectNames: string[];
        }>;
      }
    | null
  > {
    const query = normalize(`Issue-bill tracker query: ${allTerms.join(' ; ')}`);
    if (query.length < 10) return null;

    try {
      const vector = await embedText(query);
      const vecLiteral = vectorLiteral(vector);
      // Relevance floor: cosine similarity (1 - distance) must clear this to count
      // as a tracked bill. Without it the vector search returns its top-N nearest
      // regardless of how weakly related, inflating the "tracked" count with noise.
      // 0.65 keeps genuinely on-topic bills while dropping tangential matches;
      // tune here if precision/recall needs shifting.
      const SIMILARITY_FLOOR = 0.65;
      const candidateRows = await this.prisma.$queryRawUnsafe<Array<{ source_id: string; score: number }>>(
        `SELECT ce.source_id,
                (1 - (ce.embedding <=> $1::vector))::float8 AS score
           FROM context_embeddings ce
          WHERE ce.source_type = 'bill'
            AND ce.model = $2
            AND ce.embedding IS NOT NULL
            AND (1 - (ce.embedding <=> $1::vector)) >= $3
          ORDER BY ce.embedding <=> $1::vector
          LIMIT 200`,
        vecLiteral,
        EMBEDDING_MODEL,
        SIMILARITY_FLOOR,
      );

      const rankedIds = Array.from(
        new Set(
          candidateRows
            .filter((r) => typeof r.source_id === 'string' && r.source_id.trim().length > 0)
            .map((r) => r.source_id.trim()),
        ),
      );
      if (!rankedIds.length) return null;

      const bills = await this.prisma.$queryRaw<
        Array<{
          id: string;
          title: string;
          latest_action_date: Date | null;
          latest_action_text: string | null;
          sponsor_name: string | null;
          sponsor_party: string | null;
          subjects: string[];
        }>
      >`
        SELECT cb.id, cb.title, cb.latest_action_date, cb.latest_action_text,
               cb.sponsor_name, cb.sponsor_party, cb.subjects
        FROM congress_bill cb
        WHERE cb.id = ANY(${rankedIds}::text[])
        ORDER BY cb.latest_action_date DESC NULLS LAST
        LIMIT 50
      `;
      if (!bills.length) return null;

      return {
        total: rankedIds.length,
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
    } catch (error) {
      this.logger.warn(
        `Tracked-bills embeddings lookup failed, falling back to keyword matcher: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async findTrackedBillsByKeyword(allTerms: string[]): Promise<{
    total: number;
    bills: Array<{
      identifier: string;
      title: string;
      latestActionDate: Date | null;
      latestActionText: string | null;
      sponsorName: string | null;
      sponsorParty: string | null;
      subjectNames: string[];
    }>;
  }> {
    const lowerTerms = allTerms.map((n) => n.toLowerCase());
    const wordPatterns = lowerTerms.map((n) => `\\m${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`);

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
      }>
    >`
      SELECT * FROM (
        SELECT DISTINCT ON (cb.id) cb.id, cb.title, cb.latest_action_date, cb.latest_action_text,
               cb.sponsor_name, cb.sponsor_party, cb.subjects
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
      // LDA codes derived from doc sectors, feeds IntelligenceChange.relatedIssues
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

  /** Knowledge graph nodes + edges for hub-and-spoke visualization (powered by kg_walk view/function layer) */
  async getKnowledgeGraph(clientId: string, tenantId: string) {
    const [client, mappings, walkRows] = await Promise.all([
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
      // kg_walk is a server-side graph-traversal function that fans out to
      // depth=2 with LIMIT 500. On warm Aurora it usually finishes in 1-2s
      // but cold-cache or large graphs push it to 5-8s, which used to blow
      // past the 5s default $transaction timeout and 500 the entire
      // /api/intelligence/client-profile-v1/:clientId endpoint. Give this
      // specific tenant transaction a 30s ceiling.
      this.prisma.withTenant(
        tenantId,
        (tx) =>
          tx.$queryRaw<
            Array<{
              depth: number;
              src_kind: string;
              src_id: string;
              dst_kind: string;
              dst_id: string;
              edge_type: string;
              confidence: number | null;
              source: string | null;
              observed_at: Date | null;
              tenant_id: string | null;
            }>
          >`
          SELECT depth, src_kind, src_id, dst_kind, dst_id, edge_type, confidence, source, observed_at, tenant_id
          FROM kg_walk('client', ${clientId}, 2, NULL)
          LIMIT 500
        `,
        { timeoutMs: 30_000 },
      ),
    ]);

    const clientLabel = client?.name ?? clientId;
    const centerNodeId = `client:${clientId}`;

    // Step 1, drop unconfirmed auto-match noise.
    //
    // The entity resolver writes a row to client_intel_mapping for EVERY
    // candidate LDA/FEC/contracting match it finds, then waits for a human
    // to confirm one. Until then those mappings have `confirmed = false`
    // and our view emits one client→lda_client edge per candidate, which
    // is what produced the 68-node "all AGENCY" mess in the screenshot.
    //
    // The graph should reflect the *resolved* state, not the candidate
    // pool. We drop edges where source='auto_matched' (the marker we set
    // in kg_tenant_edges for unconfirmed mappings) so only manually
    // confirmed bridges + canonical edges remain.
    const filteredWalkRows = walkRows.filter((r) => r.source !== 'auto_matched');

    // Step 2, batch-resolve human labels for ID-keyed kinds.
    //
    // Many node kinds use opaque numeric IDs (LDA client = int, LDA
    // registrant = int, LDA lobbyist = int, FEC committee = string code)
    // or UUIDs (federal_contractor, capability). Without a name lookup
    // the graph rendered "189497" / "67101" / raw UUIDs as labels.
    // Collect the ids per kind across the filtered walk, then do one
    // SELECT per kind to build a kind:id → name map.
    const idsByKind = new Map<string, Set<string>>();
    const collect = (kind: string, id: string) => {
      const set = idsByKind.get(kind) ?? new Set<string>();
      set.add(id);
      idsByKind.set(kind, set);
    };
    for (const row of filteredWalkRows) {
      collect(row.src_kind, row.src_id);
      collect(row.dst_kind, row.dst_id);
    }
    const labelByNodeKey = new Map<string, string>();
    const lookups: Array<Promise<void>> = [];

    const ldaClientIds = Array.from(idsByKind.get('lda_client') ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (ldaClientIds.length) {
      lookups.push(
        this.prisma
          .$queryRaw<Array<{ id: number; name: string }>>`
            SELECT id, name FROM lda_client WHERE id = ANY(${ldaClientIds}::int[])
          `
          .then((rows) => {
            for (const r of rows) labelByNodeKey.set(`lda_client:${r.id}`, r.name);
          }),
      );
    }

    const ldaRegistrantIds = Array.from(idsByKind.get('lda_registrant') ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (ldaRegistrantIds.length) {
      lookups.push(
        this.prisma
          .$queryRaw<Array<{ id: number; name: string }>>`
            SELECT id, name FROM lda_registrant WHERE id = ANY(${ldaRegistrantIds}::int[])
          `
          .then((rows) => {
            for (const r of rows) labelByNodeKey.set(`lda_registrant:${r.id}`, r.name);
          }),
      );
    }

    const ldaLobbyistIds = Array.from(idsByKind.get('lda_lobbyist') ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (ldaLobbyistIds.length) {
      lookups.push(
        this.prisma
          .$queryRaw<Array<{ id: number; first_name: string; last_name: string }>>`
            SELECT id, first_name, last_name FROM lda_lobbyist WHERE id = ANY(${ldaLobbyistIds}::int[])
          `
          .then((rows) => {
            for (const r of rows) {
              const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
              labelByNodeKey.set(`lda_lobbyist:${r.id}`, name || `Lobbyist ${r.id}`);
            }
          }),
      );
    }

    const contractorIds = Array.from(idsByKind.get('federal_contractor') ?? []);
    if (contractorIds.length) {
      lookups.push(
        this.prisma
          .$queryRaw<Array<{ id: string; name: string }>>`
            SELECT id, name FROM federal_contractor WHERE id::text = ANY(${contractorIds}::text[])
          `
          .then((rows) => {
            for (const r of rows) labelByNodeKey.set(`federal_contractor:${r.id}`, r.name);
          }),
      );
    }

    const fecCommitteeIds = Array.from(idsByKind.get('fec_committee') ?? []);
    if (fecCommitteeIds.length) {
      lookups.push(
        this.prisma
          .$queryRaw<Array<{ committee_id: string; committee_name: string | null }>>`
            SELECT DISTINCT committee_id, committee_name
            FROM fec_contribution
            WHERE committee_id = ANY(${fecCommitteeIds}::text[])
              AND committee_name IS NOT NULL
          `
          .then((rows) => {
            for (const r of rows) {
              if (r.committee_name) labelByNodeKey.set(`fec_committee:${r.committee_id}`, r.committee_name);
            }
          }),
      );
    }

    const capabilityIds = Array.from(idsByKind.get('capability') ?? []);
    if (capabilityIds.length) {
      lookups.push(
        this.prisma
          .withTenant(tenantId, (tx) =>
            tx.clientCapability.findMany({
              where: { id: { in: capabilityIds }, tenantId },
              select: { id: true, name: true },
            }),
          )
          .then((rows) => {
            for (const r of rows) labelByNodeKey.set(`capability:${r.id}`, r.name);
          }),
      );
    }

    await Promise.all(lookups);

    // Step 3, expand kindToUiType so distinct kinds get distinct visual
    // treatment instead of all collapsing onto "AGENCY".
    const kindToUiType = (kind: string): 'client' | 'registrant' | 'lobbyist' | 'contractor' | 'bill' | 'pac' | 'agency' => {
      switch (kind) {
        case 'client':
          return 'client';
        case 'lda_client':
        case 'lda_registrant':
        case 'registrant':
          // LDA clients/registrants are both org-like; render with the
          // registrant chrome since they share the "lobbying firm" feel.
          return 'registrant';
        case 'lda_lobbyist':
        case 'lobbyist':
        case 'member':
        case 'candidate':
          // People, legislators, candidates, registered lobbyists.
          return 'lobbyist';
        case 'federal_contractor':
        case 'contractor':
          return 'contractor';
        case 'bill':
        case 'congress_bill':
        case 'subject':
        case 'policy_area':
        case 'lda_issue_code':
          // Bill-adjacent topical nodes share the bill chrome.
          return 'bill';
        case 'fec_committee':
        case 'fec_contribution':
        case 'employer':
        case 'pac':
          return 'pac';
        case 'capability':
        case 'program_element':
        case 'committee':
        case 'hearing':
        case 'agency':
        case 'docket':
        case 'fr_document':
        default:
          return 'agency';
      }
    };

    const prettyLabel = (kind: string, id: string) => {
      if (kind === 'client') return clientLabel;
      // Use the batch-resolved name if we have one.
      const resolved = labelByNodeKey.get(`${kind}:${id}`);
      if (resolved) {
        return resolved.length > 96 ? `${resolved.slice(0, 96)}…` : resolved;
      }
      // Some kinds carry meaningful values as their id (bill numbers,
      // committee codes, issue code names), let those pass through
      // verbatim.
      if (
        kind === 'bill' ||
        kind === 'subject' ||
        kind === 'policy_area' ||
        kind === 'committee' ||
        kind === 'agency' ||
        kind === 'employer' ||
        kind === 'candidate' ||
        kind === 'member' ||
        kind === 'program_element' ||
        kind === 'foreign_principal' ||
        kind === 'sec_company'
      ) {
        return id.length > 96 ? `${id.slice(0, 96)}…` : id;
      }
      // Last resort, opaque ID. Prefix with kind so it's at least
      // legible as "(lda_client) 189497" rather than a naked number.
      return `(${kind.replace(/_/g, ' ')}) ${id.length > 24 ? id.slice(0, 24) + '…' : id}`;
    };

    const nodeMap = new Map<string, { id: string; type: string; label: string; metadata: Record<string, unknown> }>();
    const edgeMap = new Map<string, { source: string; target: string; type: string; label: string }>();

    nodeMap.set(centerNodeId, {
      id: centerNodeId,
      type: 'client',
      label: clientLabel,
      metadata: { sectorTag: client?.sectorTag ?? null },
    });

    const upsertNode = (kind: string, id: string, extras: Record<string, unknown> = {}) => {
      const nodeId = `${kind}:${id}`;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          id: nodeId,
          type: kindToUiType(kind),
          label: prettyLabel(kind, id),
          metadata: { kind, rawId: id, ...extras },
        });
      }
      return nodeId;
    };

    for (const row of filteredWalkRows) {
      const srcNodeId = upsertNode(row.src_kind, row.src_id, {
        source: row.source,
        observedAt: row.observed_at,
      });
      const dstNodeId = upsertNode(row.dst_kind, row.dst_id, {
        source: row.source,
        observedAt: row.observed_at,
      });

      const edgeKey = `${srcNodeId}->${dstNodeId}:${row.edge_type}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, {
          source: srcNodeId,
          target: dstNodeId,
          type: row.edge_type,
          label: row.edge_type.replace(/_/g, ' '),
        });
      }
    }

    const confirmedMappings = mappings.filter((m) => m.confirmed);
    const avgConfidence =
      confirmedMappings.length > 0
        ? confirmedMappings.reduce((s, m) => s + (m.confidence ?? 0), 0) / confirmedMappings.length
        : 0;

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
      resolutionQuality: {
        avgConfidence: Math.round(avgConfidence * 100),
        confirmedCount: confirmedMappings.length,
        unconfirmedCount: mappings.filter((m) => !m.confirmed).length,
      },
    };
  }

  /** Outreach intelligence context, formatted text block for AI prompt injection */
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
          return `- "${d.title.slice(0, 60)}", ${days}d left (${(d.agencyNames as string[]).slice(0, 2).join('/')})`;
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
   * Phase 2.3, Capability → District Nexus.
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

    const pattern = /\b([A-Z]{2})[\s\-\/]+(?:CD[\s\-]?)?(\d{1,3}|AL)\b/g;
    const allKeys: string[] = [];
    const capDistricts = caps.map((cap) => {
      const text = cap.districtNexus ?? '';
      const seen = new Set<string>();
      const districtKeys: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text.toUpperCase())) !== null) {
        const state = m[1];
        const raw = m[2];
        if (!state || !raw) continue;
        const district = raw === 'AL' ? 'AL' : String(parseInt(raw, 10));
        const key = `${state}-${district}`;
        if (!seen.has(key)) {
          seen.add(key);
          districtKeys.push(key);
          allKeys.push(key);
        }
      }
      return { cap, districtKeys };
    });

    if (!allKeys.length) {
      return {
        capabilities: caps.map((c) => ({
          capabilityId: c.id,
          capabilityName: c.name,
          capabilitySector: c.sector,
          districtNexus: c.districtNexus,
          districts: [],
          talkingPoints: [],
          totalSupportedJobs: null,
        })),
      };
    }

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
      WHERE state || '-' || district = ANY(${allKeys}::text[])
      ORDER BY state, district, congress DESC
    `;

    const districtMap = new Map(districtRows.map((r) => [`${r.state}-${r.district}`, r]));

    const extractJobs = (value: string | null): number | null => {
      if (!value) return null;
      const m = value.match(/(\d[\d,]*)\s*(jobs?|employees?|workers?)/i);
      if (!m?.[1]) return null;
      const n = Number(m[1].replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    return {
      capabilities: capDistricts.map(({ cap, districtKeys }) => {
        const districts = districtKeys
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
          }));

        const explicitJobs = extractJobs(cap.existingContracts ?? null) ?? extractJobs(cap.districtNexus ?? null);
        const jobsPerDistrict = explicitJobs != null
          ? Math.max(1, Math.round(explicitJobs / Math.max(districts.length, 1)))
          : null;
        const talkingPoints = districts.map((d) => {
          const headline = jobsPerDistrict != null
            ? `${cap.name} supports ~${jobsPerDistrict.toLocaleString()} jobs in ${d.state}-${d.district}.`
            : `${cap.name} has district nexus in ${d.state}-${d.district} with labor force ${d.laborForceSize ? d.laborForceSize.toLocaleString() : 'N/A'}.`;
          return {
            district: `${d.state}-${d.district}`,
            headline,
            evidence: {
              laborForceSize: d.laborForceSize,
              unemploymentRate: d.unemploymentRate,
              topIndustries: d.topIndustries,
              dataYear: d.dataYear,
            },
          };
        });

        return {
          capabilityId: cap.id,
          capabilityName: cap.name,
          capabilitySector: cap.sector,
          districtNexus: cap.districtNexus,
          districts,
          talkingPoints,
          totalSupportedJobs: jobsPerDistrict != null ? jobsPerDistrict * districts.length : null,
        };
      }),
    };
  }

  /**
   * Phase 2.5, Bill → Regulation lifecycle.
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
   * Phase 2.6, GAO/CRS → Bill attachment.
   * For each tracked bill, find GAO and CRS reports whose `topics` array overlaps
   * the bill's subjects. Provides authoritative analysis to attach to in-flight
   * bills, feeds RAG grounding and meeting prep.
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
        title: `${h.committeeName}, ${h.title}`,
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
   * Tenant-aware, prefers changes touching this tenant's clients, falls back
   * to TENANT-NEUTRAL recent changes (empty relatedClientIds) to keep the feed
   * populated. Never returns changes that touch other tenants' clients -
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

    // Meetings come from this tenant's connected calendar (Outlook sync) or
    // manually-created meetings. We pull the same tomorrow→+7d window. The
    // href is the in-app meeting detail route so clicking on the dashboard
    // card opens the meeting inside Capiro; the Outlook webLink (stored in
    // metadata) is reachable from there.
    const [hearings, deadlines, meetings, clientIds] = await Promise.all([
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
        tx.meeting.findMany({
          where: {
            startsAt: { gte: tomorrowStart, lte: sevenDaysOut },
            status: { not: 'cancelled' },
          },
          orderBy: { startsAt: 'asc' },
          take: 30,
          select: {
            id: true,
            subject: true,
            startsAt: true,
            location: true,
            organizerName: true,
            organizerEmail: true,
          },
        }),
      ),
      this.prisma.withTenant(tenantId, (tx) =>
        tx.client.findMany({ where: { status: { not: 'archived' } }, select: { id: true } }),
      ),
    ]);
    // tenantClientIds reserved for future relevance ranking
    void clientIds;

    type ComingUpItem = {
      id: string;
      kind: 'hearing' | 'markup' | 'deadline' | 'meeting';
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
        title: `${h.committeeName}, ${h.title}`,
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

    for (const m of meetings) {
      const startsAt = m.startsAt;
      // ET time string for the card. Falls back to null if formatting fails
      // (e.g. exotic timezone string the DB returned unexpectedly).
      let timeLabel: string | null = null;
      try {
        timeLabel = startsAt.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York',
        });
      } catch {
        timeLabel = null;
      }
      const organizer = m.organizerName ?? m.organizerEmail ?? null;
      items.push({
        id: `meeting-${m.id}`,
        kind: 'meeting',
        label: 'MEETING',
        title: m.subject,
        detail:
          [m.location, organizer ? `Organizer: ${organizer}` : null]
            .filter((v): v is string => Boolean(v))
            .join(' · ') || null,
        severity: 'info',
        date: startsAt.toISOString(),
        time: timeLabel,
        href: `/engagement/meetings/${m.id}`,
      });
    }

    items.sort((a, b) => a.date.localeCompare(b.date));

    // Meetings are always the user's own calendar, they should be visible
    // on the home dashboard even if there are higher-severity hearings or
    // deadlines competing for slots. Strategy:
    //   1. Include up to 4 meetings, soonest first.
    //   2. Fill remaining slots (up to 6 total) with the highest-severity
    //      non-meeting items, soonest first within the same severity.
    //   3. Sort the final list by date so the dashboard reads chronologically.
    const meetingItems = items
      .filter((i) => i.kind === 'meeting')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4);

    const SEVERITY_RANK: Record<ComingUpItem['severity'], number> = {
      critical: 3,
      notable: 2,
      info: 1,
    };
    const nonMeetingPicks = items
      .filter((i) => i.kind !== 'meeting')
      .sort((a, b) => {
        const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (sev !== 0) return sev;
        return a.date.localeCompare(b.date);
      })
      .slice(0, Math.max(0, 6 - meetingItems.length));

    const top = [...meetingItems, ...nonMeetingPicks].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return { items: top, totalThisWeek: items.length };
  }

  /**
   * Portfolio summary, six numbers for the Portfolio list stat strip.
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

  /**
   * Build 8-quarter ROI series for the quarter bar chart.
   * Lobbying values come from real LDA quarterly filings.
   * Obligations values are derived from annual contractor data (÷4 per quarter).
   */
  private async buildRoiQuarterSeries({
    mappedLdaClientId,
    lobbyingYearly,
    obligationsYearly,
    now,
  }: {
    mappedLdaClientId: string | null;
    lobbyingYearly: Array<{ year: number; amount: number }>;
    obligationsYearly: Array<{ year: number; amount: number }>;
    now: Date;
  }): Promise<Array<{ label: string; lobbying: number; obligations: number }>> {
    // ── Build list of 8 quarters ending at current quarter ──────────
    const quarters: Array<{ year: number; q: number; label: string }> = [];
    let y = now.getFullYear();
    let q = Math.floor(now.getMonth() / 3) + 1; // 1-4
    for (let i = 7; i >= 0; i--) {
      let qy = y;
      let qq = q - i;
      while (qq < 1) {
        qq += 4;
        qy -= 1;
      }
      quarters.push({ year: qy, q: qq, label: `Q${qq}'${String(qy).slice(2)}` });
    }

    // ── Fetch quarterly LDA lobbying spend if we have a confirmed mapping ──
    const PERIOD_MAP: Record<string, number> = {
      first_quarter: 1,
      second_quarter: 2,
      third_quarter: 3,
      fourth_quarter: 4,
      mid_year: 2,
      year_end: 4,
    };

    const lobbyByQuarter = new Map<string, number>(); // key = "YYYY-Q#"
    if (mappedLdaClientId) {
      const ldaId = Number(mappedLdaClientId);
      if (!Number.isNaN(ldaId)) {
        const rows = await this.prisma.$queryRaw<
          Array<{ filing_year: number; filing_period: string | null; amount: number }>
        >`
          SELECT filing_year,
                 filing_period,
                 COALESCE(SUM(income), 0)::float AS amount
          FROM lda_filing
          WHERE client_id = ${ldaId}
            AND filing_period IS NOT NULL
          GROUP BY filing_year, filing_period
        `;
        for (const row of rows) {
          const qNum = PERIOD_MAP[row.filing_period ?? ''];
          if (!qNum) continue;
          lobbyByQuarter.set(`${row.filing_year}-Q${qNum}`, row.amount);
        }
      }
    } else {
      // Fall back to distributing annual lobbying data evenly across quarters
      for (const { year, amount } of lobbyingYearly) {
        const qAmt = amount / 4;
        for (let q2 = 1; q2 <= 4; q2++) {
          lobbyByQuarter.set(`${year}-Q${q2}`, qAmt);
        }
      }
    }

    // ── Distribute annual obligations evenly across quarters ─────────
    const obligByQuarter = new Map<string, number>();
    for (const { year, amount } of obligationsYearly) {
      const qAmt = amount / 4;
      for (let q2 = 1; q2 <= 4; q2++) {
        obligByQuarter.set(`${year}-Q${q2}`, qAmt);
      }
    }

    return quarters.map(({ year, q: qn, label }) => ({
      label,
      lobbying: lobbyByQuarter.get(`${year}-Q${qn}`) ?? 0,
      obligations: obligByQuarter.get(`${year}-Q${qn}`) ?? 0,
    }));
  }
}

function startOfQuarter(now: Date): Date {
  const month = now.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  return new Date(now.getFullYear(), quarterStartMonth, 1);
}
