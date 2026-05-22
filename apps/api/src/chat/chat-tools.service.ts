import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LobbyIntelService } from '../lobby-intel/lobby-intel.service.js';
import { FederalSpendingService } from '../federal-spending/federal-spending.service.js';
import { LdaIntelService } from '../lda-intel/lda-intel.service.js';
import type { ChatContextDto } from './dto/chat-context.dto.js';

@Injectable()
export class ChatToolsService {
  private readonly logger = new Logger(ChatToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lobbyIntel: LobbyIntelService,
    private readonly federalSpending: FederalSpendingService,
    private readonly ldaIntel: LdaIntelService,
  ) {}

  async gatherPageContext(tenantId: string, context?: ChatContextDto): Promise<string> {
    const parts: string[] = [];

    if (context?.page) {
      parts.push(`The user is currently viewing the "${context.page}" page.`);
    }

    if (context?.clientId) {
      try {
        const client = await this.prisma.withTenant(tenantId, (tx) =>
          tx.client.findFirst({
            where: { id: context.clientId },
            select: {
              name: true,
              description: true,
              productDescription: true,
              primaryContactName: true,
              primaryContactEmail: true,
            },
          }),
        );
        if (client) {
          parts.push(`Selected client: ${client.name}`);
          if (client.description) parts.push(`Client description: ${client.description}`);
          if (client.productDescription) parts.push(`Product/service: ${client.productDescription}`);
          if (client.primaryContactName) parts.push(`Primary contact: ${client.primaryContactName}`);
        }
      } catch (err) {
        this.logger.warn(`Client context fetch failed: ${(err as Error).message}`);
      }
    }

    if (context?.workflowInstanceId) {
      try {
        const instance = await this.prisma.withTenant(tenantId, (tx) =>
          tx.workflowInstance.findFirst({
            where: { id: context.workflowInstanceId },
            include: { template: true },
          }),
        );
        if (instance) {
          parts.push(
            `Active workflow: "${instance.title}" (template: ${instance.template?.name ?? 'unknown'}, status: ${instance.status})`,
          );
        }
      } catch (err) {
        this.logger.warn(`Workflow context fetch failed: ${(err as Error).message}`);
      }
    }

    return parts.join('\n');
  }

  async queryClients(tenantId: string): Promise<string> {
    const clients = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findMany({
        where: { status: { not: 'archived' } },
        select: { name: true, description: true, primaryContactName: true, status: true },
        take: 25,
        orderBy: { name: 'asc' },
      }),
    );

    if (!clients.length) return 'No clients found in the user\'s portfolio.';
    return `Portfolio clients (${clients.length}):\n${clients
      .map(
        (c) =>
          `- ${c.name}${c.primaryContactName ? ' (contact: ' + c.primaryContactName + ')' : ''}${c.description ? ': ' + c.description.slice(0, 120) : ''}`,
      )
      .join('\n')}`;
  }

  async queryMeetings(tenantId: string, clientId?: string): Promise<string> {
    const where: Record<string, unknown> = {};
    if (clientId) where.clientId = clientId;

    const meetings = await this.prisma.withTenant(tenantId, (tx) =>
      tx.meeting.findMany({
        where,
        select: {
          subject: true,
          startsAt: true,
          endsAt: true,
          status: true,
          location: true,
        },
        take: 15,
        orderBy: { startsAt: 'desc' },
      }),
    );

    if (!meetings.length) return 'No meetings found.';
    return `Recent meetings (${meetings.length}):\n${meetings
      .map(
        (m: Record<string, unknown>) =>
          `- ${m.subject} (${(m.startsAt as Date).toISOString().slice(0, 10)}${m.location ? ', ' + m.location : ''}) [${m.status ?? 'scheduled'}]`,
      )
      .join('\n')}`;
  }

  async queryEngagementOutreach(tenantId: string, clientId?: string): Promise<string> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (clientId) where.clientId = clientId;

    const records = await this.prisma.withTenant(tenantId, (tx) =>
      tx.outreachRecord.findMany({
        where,
        select: { title: true, type: true, status: true, subject: true, createdAt: true },
        take: 15,
        orderBy: { createdAt: 'desc' },
      }),
    );

    if (!records.length) return 'No outreach records found.';
    return `Recent outreach records (${records.length}):\n${records
      .map(
        (r: Record<string, unknown>) =>
          `- [${r.type}/${r.status}] ${r.title}${r.subject ? ' — "' + r.subject + '"' : ''}`,
      )
      .join('\n')}`;
  }

  async queryWorkflows(tenantId: string, clientId?: string): Promise<string> {
    const where: Record<string, unknown> = {};
    if (clientId) where.clientId = clientId;

    const instances = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowInstance.findMany({
        where,
        include: { template: true },
        take: 15,
        orderBy: { createdAt: 'desc' },
      }),
    );

    if (!instances.length) return 'No workflow instances found.';
    return `Workflow instances (${instances.length}):\n${instances
      .map(
        (i: Record<string, unknown>) =>
          `- [${i.status}] ${i.title} (${(i as Record<string, Record<string, unknown>>).template?.name ?? 'unknown template'}, created ${(i.createdAt as Date).toISOString().slice(0, 10)})`,
      )
      .join('\n')}`;
  }

  async queryIntelligence(clientName?: string): Promise<string> {
    const parts: string[] = [];

    // Lobby intel surging issues & trends
    try {
      const lobbyCtx = await this.lobbyIntel.getAiContext();
      if (lobbyCtx.surgingIssues.length) {
        const surge = lobbyCtx.surgingIssues
          .slice(0, 6)
          .map(
            (s) =>
              `${s.name}${s.surgePct != null ? ' (+' + Math.round(s.surgePct) + '% QoQ)' : ''}`,
          )
          .join(', ');
        parts.push(`Surging LDA lobbying issues: ${surge}`);
      }
      if (lobbyCtx.trendingTopics.length) {
        const trending = lobbyCtx.trendingTopics
          .slice(0, 8)
          .map((t) => t.word)
          .filter(Boolean)
          .join(', ');
        if (trending) parts.push(`Trending terms in lobbying filings: ${trending}`);
      }
      if (lobbyCtx.latestQuarter) parts.push(`Latest LDA quarter: ${lobbyCtx.latestQuarter}`);
    } catch (err) {
      this.logger.warn(`Lobby intel fetch failed: ${(err as Error).message}`);
    }

    // Congress bills — recent activity
    try {
      const bills = await this.ldaIntel.getCongressBills(
        undefined, // search
        undefined, // policyArea
        undefined, // congress
        1,         // page
        10,        // limit
      );
      const billsAny = bills as unknown as { data?: Array<Record<string, unknown>>; total?: number };
      if (billsAny.data && billsAny.data.length) {
        const billSummary = billsAny.data
          .slice(0, 8)
          .map(
            (b) =>
              `- ${b.billType ?? ''}${b.number ?? ''}: ${b.title ?? 'Untitled'} (${b.latestActionDate ?? 'no date'})`,
          )
          .join('\n');
        parts.push(`Recent congressional bills:\n${billSummary}`);
      }
    } catch (err) {
      this.logger.warn(`Congress bills fetch failed: ${(err as Error).message}`);
    }

    // Federal spending context (if client name provided)
    if (clientName) {
      try {
        const spend = await this.federalSpending.getAiContext(clientName);
        if (spend.matchedContractor) {
          const mc = spend.matchedContractor;
          const amt = mc.totalContracts != null ? `$${(mc.totalContracts / 1e9).toFixed(1)}B` : 'unknown';
          parts.push(
            `Federal contracting for ${mc.name}: ${amt} in contracts${mc.rankByContracts ? ' (rank #' + mc.rankByContracts + ' nationally)' : ''}`,
          );
          if (mc.topAgencies.length) {
            const agencies = mc.topAgencies
              .slice(0, 3)
              .map((a) => `${a.name} ($${Math.round(a.amount / 1e9)}B)`)
              .join(', ');
            parts.push(`Top awarding agencies: ${agencies}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Federal spending fetch failed: ${(err as Error).message}`);
      }
    }

    return parts.join('\n') || 'No intelligence data currently available.';
  }
}
