import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngagementTaskStatus, MembershipStatus, Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { EngagementService } from '../engagement/engagement.service.js';
import { MicrosoftGraphSyncService } from '../engagement/microsoft/microsoft-graph-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PRODUCT_NAME = 'Clio';

const TOOL_DEFINITIONS = [
  {
    name: 'get_client_context',
    description: 'Load authorized Capiro client context, recent meetings, threads, contacts, and tasks.',
  },
  {
    name: 'search_research_sources',
    description: 'Search authorized Capiro clients, meetings, mail, notes, and directory notes.',
  },
  {
    name: 'create_meeting_brief',
    description: 'Create and persist a deterministic meeting brief artifact from authorized Capiro data.',
  },
  {
    name: 'draft_policy_memo',
    description: 'Create and persist a policy memo artifact from authorized Capiro client context.',
  },
  {
    name: 'save_note',
    description: 'Save a user-scoped Clio note and optionally an encrypted Capiro meeting note.',
  },
  {
    name: 'send_email',
    description: 'Send an email via the tenant\'s connected Microsoft 365 account on behalf of Clio.',
  },
  {
    name: 'list_emails',
    description: 'List recent email threads from the tenant\'s connected Microsoft 365 inbox, optionally filtered by client.',
  },
  {
    name: 'reply_email',
    description: 'Reply to an email thread via the tenant\'s connected Microsoft 365 account on behalf of Clio.',
  },
] as const;

type ClioToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

interface ToolArtifactInput {
  conversationId?: string | null;
  clientId?: string | null;
  title: string;
  kind: string;
  bodyText: string;
  metadata?: Prisma.InputJsonValue;
}

interface MeetingForBrief {
  clientId: string | null;
  subject: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  client: { id: string; name: string; website: string | null; productDescription: string | null } | null;
  attendees: Array<{ name: string | null; email: string | null }>;
  preps: Array<{ summary: string | null; talkingPoints: Prisma.JsonValue }>;
  tasks: Array<{ title: string; dueDate: Date | null }>;
}

@Injectable()
export class ClioToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly engagement: EngagementService,
    private readonly microsoftGraph: MicrosoftGraphSyncService,
  ) {}

  manifest() {
    return {
      brand: PRODUCT_NAME,
      tools: TOOL_DEFINITIONS,
    };
  }

  executeFromAuthenticatedUser(ctx: TenantContext, rawName: string, rawInput: unknown) {
    return this.execute(ctx, normalizeToolName(rawName), objectInput(rawInput));
  }

  async executeFromRuntime(rawAuthorization: string | undefined, rawName: string, rawInput: unknown) {
    this.assertRuntimeToolAuth(rawAuthorization);
    const input = objectInput(rawInput);
    const conversationId = requiredString(input, 'conversationId', 80);
    const ctx = await this.contextFromConversation(conversationId);
    return this.execute(ctx, normalizeToolName(rawName), input);
  }

  async execute(ctx: TenantContext, name: ClioToolName, input: Record<string, unknown>) {
    switch (name) {
      case 'get_client_context':
        return this.getClientContext(ctx, input);
      case 'search_research_sources':
        return this.searchResearchSources(ctx, input);
      case 'create_meeting_brief':
        return this.createMeetingBrief(ctx, input);
      case 'draft_policy_memo':
        return this.draftPolicyMemo(ctx, input);
      case 'save_note':
        return this.saveNote(ctx, input);
      case 'send_email':
        return this.sendEmail(ctx, input);
      case 'list_emails':
        return this.listEmails(ctx, input);
      case 'reply_email':
        return this.replyEmail(ctx, input);
      default:
        assertNever(name);
    }
  }

  private async getClientContext(ctx: TenantContext, input: Record<string, unknown>) {
    const clientId = requiredString(input, 'clientId', 80);
    await this.ensureClientVisible(ctx, clientId);
    const context = await this.engagement.clientContext(ctx, clientId);
    return {
      tool: 'get_client_context',
      generatedAt: new Date().toISOString(),
      context,
    };
  }

  private async searchResearchSources(ctx: TenantContext, input: Record<string, unknown>) {
    const query = requiredString(input, 'query', 240);
    const clientId = optionalString(input, 'clientId', 80);
    const limit = clampInt(input.limit, 1, 25, 8);
    if (clientId) await this.ensureClientVisible(ctx, clientId);

    const results = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const [clients, meetings, threads, messages, clioNotes, directoryNotes] = await Promise.all([
        tx.client.findMany({
          where: {
            tenantId: ctx.tenantId,
            status: { not: 'archived' },
            ...(clientId ? { id: clientId } : {}),
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { productDescription: { contains: query, mode: 'insensitive' } },
              { primaryContactName: { contains: query, mode: 'insensitive' } },
              { primaryContactEmail: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true, description: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        }),
        tx.meeting.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(clientId ? { clientId } : {}),
            ...ownMeetingWhere(ctx.userId),
            OR: [
              { subject: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { location: { contains: query, mode: 'insensitive' } },
              { organizerEmail: { contains: query, mode: 'insensitive' } },
              { organizerName: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            clientId: true,
            subject: true,
            description: true,
            startsAt: true,
            organizerEmail: true,
            organizerName: true,
          },
          orderBy: { startsAt: 'desc' },
          take: limit,
        }),
        tx.mailThread.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(clientId ? { clientId } : {}),
            ...ownMailThreadWhere(ctx.userId),
            OR: [
              { subject: { contains: query, mode: 'insensitive' } },
              { snippet: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            clientId: true,
            subject: true,
            snippet: true,
            lastMessageAt: true,
            updatedAt: true,
          },
          orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
          take: limit,
        }),
        tx.mailMessage.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...ownMailMessageWhere(ctx.userId),
            ...(clientId ? { thread: { clientId } } : {}),
            OR: [
              { subject: { contains: query, mode: 'insensitive' } },
              { bodyText: { contains: query, mode: 'insensitive' } },
              { fromEmail: { contains: query, mode: 'insensitive' } },
              { fromName: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            threadId: true,
            subject: true,
            bodyText: true,
            fromEmail: true,
            fromName: true,
            receivedAt: true,
            sentAt: true,
            thread: { select: { clientId: true, subject: true } },
          },
          orderBy: [{ receivedAt: 'desc' }, { sentAt: 'desc' }],
          take: limit,
        }),
        tx.clioNote.findMany({
          where: {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            ...(clientId ? { clientId } : {}),
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: { id: true, clientId: true, title: true, body: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        tx.directoryContactNote.findMany({
          where: {
            tenantId: ctx.tenantId,
            OR: [
              { body: { contains: query, mode: 'insensitive' } },
              { directoryContactName: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            directoryContactId: true,
            directoryContactName: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      ]);

      return [
        ...clients.map((client) => ({
          type: 'client',
          id: client.id,
          clientId: client.id,
          title: client.name,
          snippet: summarizeText(client.description, 360),
          occurredAt: client.updatedAt,
        })),
        ...meetings.map((meeting) => ({
          type: 'meeting',
          id: meeting.id,
          clientId: meeting.clientId,
          title: meeting.subject,
          snippet: summarizeText(meeting.description || meeting.organizerName || meeting.organizerEmail, 360),
          occurredAt: meeting.startsAt,
        })),
        ...threads.map((thread) => ({
          type: 'mail_thread',
          id: thread.id,
          clientId: thread.clientId,
          title: thread.subject,
          snippet: summarizeText(thread.snippet, 360),
          occurredAt: thread.lastMessageAt ?? thread.updatedAt,
        })),
        ...messages.map((message) => ({
          type: 'mail_message',
          id: message.id,
          clientId: message.thread.clientId,
          title: message.subject || message.thread.subject,
          snippet: summarizeText(message.bodyText || message.fromName || message.fromEmail, 360),
          occurredAt: message.receivedAt ?? message.sentAt,
          metadata: { threadId: message.threadId },
        })),
        ...clioNotes.map((note) => ({
          type: 'clio_note',
          id: note.id,
          clientId: note.clientId,
          title: note.title || 'Clio note',
          snippet: summarizeText(note.body, 360),
          occurredAt: note.createdAt,
        })),
        ...directoryNotes.map((note) => ({
          type: 'directory_contact_note',
          id: note.id,
          clientId: null,
          title: note.directoryContactName || note.directoryContactId,
          snippet: summarizeText(note.body, 360),
          occurredAt: note.createdAt,
          metadata: { directoryContactId: note.directoryContactId },
        })),
      ]
        .sort((left, right) => dateMillis(right.occurredAt) - dateMillis(left.occurredAt))
        .slice(0, limit * 3);
    });

    return {
      tool: 'search_research_sources',
      query,
      generatedAt: new Date().toISOString(),
      results,
    };
  }

  private async createMeetingBrief(ctx: TenantContext, input: Record<string, unknown>) {
    const meetingId = requiredString(input, 'meetingId', 80);
    const conversationId = optionalString(input, 'conversationId', 80);
    const titleOverride = optionalString(input, 'title', 160);
    const meeting = await this.meetingForTool(ctx, meetingId);
    const [notes, debriefs, recentThreads] = await Promise.all([
      this.engagement.listMeetingNotes(ctx, meetingId).catch(() => []),
      this.engagement.listMeetingDebriefs(ctx, meetingId).catch(() => []),
      this.recentThreadsForClient(ctx, meeting.clientId),
    ]);

    const bodyText = renderMeetingBrief({
      meeting,
      notes: notes.filter((note) => !note.restricted),
      debriefs: debriefs.filter((debrief) => !debrief.restricted),
      recentThreads,
    });
    const artifact = await this.persistArtifact(ctx, {
      conversationId,
      clientId: meeting.clientId,
      title: titleOverride || `Meeting brief - ${meeting.subject}`,
      kind: 'meeting_brief',
      bodyText,
      metadata: {
        source: 'clio_tool',
        tool: 'create_meeting_brief',
        meetingId,
        generatedAt: new Date().toISOString(),
      },
    });

    return {
      tool: 'create_meeting_brief',
      generatedAt: new Date().toISOString(),
      meetingId,
      artifact,
      bodyText,
    };
  }

  private async draftPolicyMemo(ctx: TenantContext, input: Record<string, unknown>) {
    const clientId = requiredString(input, 'clientId', 80);
    const conversationId = optionalString(input, 'conversationId', 80);
    const title = optionalString(input, 'title', 160) || 'Policy memo draft';
    const objective = optionalString(input, 'objective', 500) || 'Prepare a policy memo.';
    const providedBody = optionalString(input, 'body', 40_000);
    await this.ensureClientVisible(ctx, clientId);
    const clientContext = await this.engagement.clientContext(ctx, clientId);
    const research =
      objective.length > 3
        ? await this.searchResearchSources(ctx, { query: objective, clientId, limit: 6 }).catch(
            () => ({ results: [] }),
          )
        : { results: [] };
    const bodyText =
      providedBody ||
      renderPolicyMemo({
        title,
        objective,
        clientContext,
        researchResults: Array.isArray(research.results) ? research.results : [],
      });
    const artifact = await this.persistArtifact(ctx, {
      conversationId,
      clientId,
      title,
      kind: 'policy_memo',
      bodyText,
      metadata: {
        source: 'clio_tool',
        tool: 'draft_policy_memo',
        objective,
        generatedAt: new Date().toISOString(),
        mode: providedBody ? 'provided_body' : 'deterministic_capiro_context',
      },
    });

    return {
      tool: 'draft_policy_memo',
      generatedAt: new Date().toISOString(),
      artifact,
      bodyText,
    };
  }

  private async saveNote(ctx: TenantContext, input: Record<string, unknown>) {
    const body = requiredString(input, 'body', 40_000);
    const title = optionalString(input, 'title', 160);
    const conversationId = optionalString(input, 'conversationId', 80);
    const requestedClientId = optionalString(input, 'clientId', 80);
    const meetingId = optionalString(input, 'meetingId', 80);
    const source = optionalString(input, 'source', 80) || 'clio_tool';
    let clientId = requestedClientId ?? null;
    let meetingNote: unknown = null;

    if (meetingId) {
      const meeting = await this.ensureOwnMeeting(ctx, meetingId);
      if (clientId && meeting.clientId && clientId !== meeting.clientId) {
        throw new BadRequestException('clientId does not match the meeting client');
      }
      clientId = clientId ?? meeting.clientId;
      meetingNote = await this.engagement.createMeetingNote(ctx, meetingId, {
        body,
        confidential: optionalBoolean(input, 'confidential') ?? true,
        accessLevel: optionalString(input, 'accessLevel', 80) ?? 'tenant_admins_and_author',
      });
    } else if (clientId) {
      await this.ensureClientVisible(ctx, clientId);
    }

    if (conversationId) await this.ensureConversationForTool(ctx, conversationId, clientId);

    const clioNote = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioNote.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId,
          conversationId: conversationId ?? null,
          meetingId: meetingId ?? null,
          title: title ?? null,
          body,
          source,
          metadata: {
            tool: 'save_note',
            savedToMeetingNotes: Boolean(meetingNote),
          },
        },
      }),
    );

    return {
      tool: 'save_note',
      generatedAt: new Date().toISOString(),
      note: clioNote,
      meetingNote,
    };
  }

  // ── Email tools ──────────────────────────────────────────────────────

  private async findUserEmailConnection(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.integrationConnection.findFirst({
        where: {
          tenantId: ctx.tenantId,
          createdByUserId: ctx.userId,
          provider: 'microsoft_365',
          status: 'connected',
          token: { isNot: null },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, accountEmail: true, displayName: true },
      }),
    );
  }

  private async sendEmail(ctx: TenantContext, input: Record<string, unknown>) {
    const to = requiredString(input, 'to', 320);
    const subject = requiredString(input, 'subject', 500);
    const body = requiredString(input, 'body', 50_000);
    const clientId = optionalString(input, 'clientId', 36);
    const conversationId = optionalString(input, 'conversationId', 80);

    const connection = await this.findUserEmailConnection(ctx);
    if (!connection) {
      return {
        error: 'No connected Microsoft 365 account found. Please connect one in Settings → Integrations.',
      };
    }

    await this.microsoftGraph.sendMail(ctx, connection.id, {
      subject,
      body,
      toRecipients: [{ email: to }],
    });

    if (conversationId) {
      await this.persistArtifact(ctx, {
        conversationId,
        clientId,
        title: `Email: ${subject}`,
        kind: 'email_sent',
        bodyText: `To: ${to}\nSubject: ${subject}\n\n${body}`,
        metadata: { to, subject, sentFrom: connection.accountEmail },
      });
    }

    return { ok: true, sentFrom: connection.accountEmail, to, subject };
  }

  private async listEmails(ctx: TenantContext, input: Record<string, unknown>) {
    const clientId = optionalString(input, 'clientId', 36);
    const limit = clampInt(input.limit, 1, 50, 15);

    const where: Prisma.MailThreadWhereInput = {
      ...ownMailThreadWhere(ctx.userId),
    };
    if (clientId) where.clientId = clientId;

    const threads = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.mailThread.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        select: {
          id: true,
          subject: true,
          snippet: true,
          participants: true,
          lastMessageAt: true,
          status: true,
          client: { select: { id: true, name: true } },
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 3,
            select: {
              id: true,
              subject: true,
              fromEmail: true,
              fromName: true,
              bodyText: true,
              sentAt: true,
              receivedAt: true,
            },
          },
        },
      }),
    );

    return { threads, count: threads.length };
  }

  private async replyEmail(ctx: TenantContext, input: Record<string, unknown>) {
    const threadId = requiredString(input, 'threadId', 80);
    const body = requiredString(input, 'body', 50_000);
    const clientId = optionalString(input, 'clientId', 36);
    const conversationId = optionalString(input, 'conversationId', 80);

    const thread = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.mailThread.findFirst({
        where: { id: threadId, ...ownMailThreadWhere(ctx.userId) },
        select: {
          id: true,
          subject: true,
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { id: true, fromEmail: true, fromName: true, subject: true },
          },
        },
      }),
    );
    if (!thread) return { error: 'Thread not found.' };

    const lastMsg = thread.messages[0];
    if (!lastMsg?.fromEmail) return { error: 'No messages in thread to reply to.' };

    const connection = await this.findUserEmailConnection(ctx);
    if (!connection) {
      return { error: 'No connected Microsoft 365 account found.' };
    }

    const replySubject = thread.subject?.startsWith('Re: ')
      ? thread.subject
      : `Re: ${thread.subject ?? ''}`;

    await this.microsoftGraph.sendMail(ctx, connection.id, {
      subject: replySubject,
      body,
      toRecipients: [{ email: lastMsg.fromEmail }],
    });

    if (conversationId) {
      await this.persistArtifact(ctx, {
        conversationId,
        clientId,
        title: `Reply: ${replySubject}`,
        kind: 'email_reply',
        bodyText: `Reply to: ${lastMsg.fromEmail}\nSubject: ${replySubject}\n\n${body}`,
        metadata: { to: lastMsg.fromEmail, subject: replySubject, sentFrom: connection.accountEmail, threadId },
      });
    }

    return { ok: true, sentFrom: connection.accountEmail, to: lastMsg.fromEmail, subject: replySubject };
  }

  // ── Artifact persistence ────────────────────────────────────────────

  private async persistArtifact(ctx: TenantContext, input: ToolArtifactInput) {
    if (!input.conversationId) {
      return {
        persisted: false,
        reason: 'No conversationId was supplied to the tool call.',
      };
    }
    await this.ensureConversationForTool(ctx, input.conversationId, input.clientId ?? null);
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioArtifact.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId: input.clientId ?? null,
          conversationId: input.conversationId!,
          title: input.title,
          kind: input.kind,
          contentType: 'text/markdown',
          bodyText: input.bodyText,
          metadata: input.metadata ?? {},
        },
      }),
    );
  }

  private async meetingForTool(ctx: TenantContext, meetingId: string) {
    const meeting = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId, ...ownMeetingWhere(ctx.userId) },
        include: {
          client: { select: { id: true, name: true, website: true, productDescription: true } },
          attendees: { orderBy: { createdAt: 'asc' } },
          preps: { orderBy: { createdAt: 'desc' }, take: 1 },
          tasks: {
            where: { status: { notIn: [EngagementTaskStatus.done, EngagementTaskStatus.canceled] } },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
            take: 8,
          },
        },
      }),
    );
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async ensureOwnMeeting(ctx: TenantContext, meetingId: string) {
    const meeting = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId, ...ownMeetingWhere(ctx.userId) },
        select: { id: true, clientId: true },
      }),
    );
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async ensureClientVisible(ctx: TenantContext, clientId: string) {
    const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: { id: true },
      }),
    );
    if (!client) throw new NotFoundException('Client not found');
  }

  private async ensureConversationForTool(
    ctx: TenantContext,
    conversationId: string,
    clientId: string | null,
  ) {
    const conversation = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioConversation.findFirst({
        where: {
          id: conversationId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          archivedAt: null,
        },
        select: { id: true, clientId: true },
      }),
    );
    if (!conversation) throw new NotFoundException('Clio conversation not found');
    if (clientId && conversation.clientId && conversation.clientId !== clientId) {
      throw new BadRequestException('Tool clientId does not match the Clio conversation client');
    }
    return conversation;
  }

  private async recentThreadsForClient(ctx: TenantContext, clientId: string | null) {
    if (!clientId) return [];
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.mailThread.findMany({
        where: { tenantId: ctx.tenantId, clientId, ...ownMailThreadWhere(ctx.userId) },
        select: { id: true, subject: true, snippet: true, lastMessageAt: true },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
      }),
    );
  }

  private async contextFromConversation(conversationId: string): Promise<TenantContext> {
    const row = await this.prisma.withSystem((tx) =>
      tx.clioConversation.findFirst({
        where: { id: conversationId, archivedAt: null },
        include: {
          tenant: { select: { id: true, slug: true } },
          user: { select: { id: true, clerkUserId: true } },
        },
      }),
    );
    if (!row) throw new NotFoundException('Clio conversation not found');

    const membership = await this.prisma.withSystem((tx) =>
      tx.tenantMembership.findFirst({
        where: {
          tenantId: row.tenantId,
          userId: row.userId,
          status: MembershipStatus.active,
        },
        select: { role: true },
      }),
    );
    if (!membership) throw new ForbiddenException('Clio conversation user is not an active tenant member');

    return {
      tenantId: row.tenantId,
      tenantSlug: row.tenant.slug,
      userId: row.userId,
      clerkUserId: row.user.clerkUserId,
      role: membership.role as TenantContext['role'],
    };
  }

  private assertRuntimeToolAuth(rawAuthorization: string | undefined) {
    const configured =
      this.config.get('CLIO_TOOL_API_KEY', { infer: true }) ??
      this.config.get('CLIO_RUNTIME_API_KEY', { infer: true }) ??
      this.config.get('CLIO_NANOCLAW_API_KEY', { infer: true });
    if (!configured) throw new UnauthorizedException('Clio runtime tool API key is not configured');
    const token = rawAuthorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token || !safeEqual(token, configured)) {
      throw new UnauthorizedException('Invalid Clio runtime tool API key');
    }
  }
}

function normalizeToolName(value: string): ClioToolName {
  const name = value.trim();
  if (TOOL_DEFINITIONS.some((tool) => tool.name === name)) return name as ClioToolName;
  throw new NotFoundException('Clio tool not found');
}

function objectInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function requiredString(input: Record<string, unknown>, key: string, max: number): string {
  const value = optionalString(input, key, max);
  if (!value) throw new BadRequestException(`${key} is required`);
  return value;
}

function optionalString(input: Record<string, unknown>, key: string, max: number): string | null {
  const value = input[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | null {
  const value = input[key];
  return typeof value === 'boolean' ? value : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function ownMeetingWhere(userId: string): Prisma.MeetingWhereInput {
  return {
    OR: [{ createdByUserId: userId }, { connection: { createdByUserId: userId } }],
  };
}

function ownMailThreadWhere(userId: string): Prisma.MailThreadWhereInput {
  return {
    connection: { createdByUserId: userId },
  };
}

function ownMailMessageWhere(userId: string): Prisma.MailMessageWhereInput {
  return {
    connection: { createdByUserId: userId },
  };
}

function renderMeetingBrief(input: {
  meeting: MeetingForBrief;
  notes: Array<{ body: string | null; createdAt: Date }>;
  debriefs: Array<{ body: string | null; createdAt: Date }>;
  recentThreads: Array<{ subject: string; snippet: string | null; lastMessageAt: Date | null }>;
}) {
  const { meeting, notes, debriefs, recentThreads } = input;
  const attendees = meeting.attendees
    .map((attendee) => attendee.name || attendee.email)
    .filter(Boolean)
    .join(', ');
  const prep = meeting.preps[0];
  const tasks = meeting.tasks.map((task) => `- ${task.title}${task.dueDate ? ` (due ${formatDate(task.dueDate)})` : ''}`);

  return [
    `# Meeting Brief: ${meeting.subject}`,
    '',
    `Client: ${meeting.client?.name ?? 'Unassigned'}`,
    `When: ${formatDate(meeting.startsAt)} - ${formatDate(meeting.endsAt)}`,
    meeting.location ? `Location: ${meeting.location}` : null,
    attendees ? `Attendees: ${attendees}` : null,
    '',
    '## Context',
    summarizeText(meeting.description, 1200) || 'No meeting description is available in Capiro.',
    '',
    '## Latest Prep',
    prep
      ? [prep.summary, ...jsonStringArray(prep.talkingPoints).map((item) => `- ${item}`)].filter(Boolean).join('\n')
      : 'No saved prep is available for this meeting.',
    '',
    '## Visible Notes',
    notes.length ? notes.map((note) => `- ${summarizeText(note.body, 500)}`).join('\n') : 'No visible notes.',
    '',
    '## Visible Debriefs',
    debriefs.length
      ? debriefs.map((debrief) => `- ${summarizeText(debrief.body, 500)}`).join('\n')
      : 'No visible debriefs.',
    '',
    '## Open Tasks',
    tasks.length ? tasks.join('\n') : 'No open tasks are attached to this meeting.',
    '',
    '## Recent Client Threads',
    recentThreads.length
      ? recentThreads.map((thread) => `- ${thread.subject}: ${summarizeText(thread.snippet, 240)}`).join('\n')
      : 'No recent authorized mail threads are linked to this client.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function renderPolicyMemo(input: {
  title: string;
  objective: string;
  clientContext: unknown;
  researchResults: unknown[];
}) {
  const context = objectInput(input.clientContext);
  const client = objectInput(context.client);
  const clientName = typeof client.name === 'string' ? client.name : 'Selected client';
  const summary = objectInput(context.summary);
  const sources = input.researchResults
    .map((result) => objectInput(result))
    .map((result) => `- ${String(result.title ?? result.id ?? 'Source')}: ${summarizeText(String(result.snippet ?? ''), 280)}`)
    .join('\n');

  return [
    `# ${input.title}`,
    '',
    `Client: ${clientName}`,
    `Objective: ${input.objective}`,
    '',
    '## Current Capiro Context',
    `- Meetings in loaded context: ${summary.meetings ?? 0}`,
    `- Mail threads in loaded context: ${summary.mailThreads ?? 0}`,
    `- Contacts in loaded context: ${summary.contacts ?? 0}`,
    `- Open tasks in loaded context: ${summary.openTasks ?? 0}`,
    '',
    '## Draft Position',
    'Add the policy position, supporting evidence, and requested action here. This draft was assembled from authorized Capiro context and should be reviewed before external use.',
    '',
    '## Supporting Sources',
    sources || 'No matching authorized research sources were found for the objective.',
    '',
    '## Follow-Up',
    '- Confirm factual claims against primary sources.',
    '- Attach client-approved language and citations.',
    '- Save final outreach or memo artifacts in Capiro.',
  ].join('\n');
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function summarizeText(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function formatDate(value: Date): string {
  return value.toISOString();
}

function dateMillis(value: Date | null): number {
  return value ? value.getTime() : 0;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Clio tool: ${value}`);
}
