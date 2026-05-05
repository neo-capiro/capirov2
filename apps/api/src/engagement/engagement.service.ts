import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AssociationEntityType,
  EngagementConnectionStatus,
  EngagementProvider,
  EngagementSource,
  EngagementTaskStatus,
  MeetingPrepStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DirectoryService, type DirectoryEmailMatch } from '../directory/directory.service.js';
import { ClientAssociationService } from './client-association.service.js';
import { EngagementAiService } from './engagement-ai.service.js';
import { MeetingNotesCryptoService } from './meeting-notes-crypto.service.js';

export interface CreateIntegrationInput {
  provider: EngagementProvider;
  accountEmail?: string;
  displayName?: string;
}

export interface MeetingAttendeeInput {
  email?: string;
  name?: string;
  role?: string;
  responseStatus?: string;
}

export interface CreateMeetingInput {
  clientId?: string;
  subject: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  organizerEmail?: string;
  organizerName?: string;
  attendees?: MeetingAttendeeInput[];
}

export interface UpdateMeetingInput {
  clientId?: string | null;
  subject?: string;
  description?: string | null;
  location?: string | null;
  startsAt?: string;
  endsAt?: string;
  status?: string;
}

export interface CreateTaskInput {
  clientId?: string;
  meetingId?: string;
  contactId?: string;
  mailThreadId?: string;
  title: string;
  description?: string;
  ownerUserId?: string;
  dueDate?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  status?: EngagementTaskStatus;
}

export interface UpdateMeetingPrepInput {
  summary?: string | null;
  agenda?: string[];
  talkingPoints?: string[];
  risks?: string[];
  followUps?: string[];
}

export interface AssociationOverrideInput {
  entityType: AssociationEntityType;
  entityId: string;
  clientId: string;
  reason?: string;
}

export interface AttachmentUploadInput {
  clientId?: string;
  meetingId?: string;
  mailMessageId?: string;
  fileName: string;
  contentType: string;
  contentLength: number;
}

export interface ConfirmAttachmentInput {
  clientId?: string;
  meetingId?: string;
  mailMessageId?: string;
  fileName: string;
  contentType: string;
  s3Key: string;
  checksumSha256?: string;
}

export interface EngagementReportQuery {
  clientId?: string;
  period?: string;
}

export interface CreateReportTargetOfficeInput {
  clientId?: string | null;
  memberPrincipal: string;
  committee?: string | null;
  staffer?: string | null;
  building?: string | null;
  leadOwner?: string | null;
}

export interface UpsertReportTargetOfficeInput extends CreateReportTargetOfficeInput {
  officeKey: string;
  prepStatus?: ReportStatus;
  outreachStatus?: ReportStatus;
  submissionStatus?: ReportStatus;
  source?: string;
}

export type ReportPeriod = 'current' | 'previous' | 'all';
export type ReportStatus = 'auto' | 'not_started' | 'in_progress' | 'complete';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const REPORT_STATUSES: ReportStatus[] = ['auto', 'not_started', 'in_progress', 'complete'];

interface ReportTargetDraft {
  targetId: string | null;
  clientId: string | null;
  clientName: string | null;
  scopeKey: string;
  officeKey: string;
  memberPrincipal: string;
  committee: string | null;
  staffer: string | null;
  building: string | null;
  leadOwner: string | null;
  source: string;
  storedPrepStatus: ReportStatus;
  storedOutreachStatus: ReportStatus;
  storedSubmissionStatus: ReportStatus;
  meetingIds: Set<string>;
  heldMeetingIds: Set<string>;
  preparedMeetingIds: Set<string>;
  approvedPrepMeetingIds: Set<string>;
  meetings: Map<
    string,
    {
      id: string;
      subject: string;
      startsAt: Date;
      endsAt: Date;
      location: string | null;
      externalUrl: string | null;
    }
  >;
  threadIds: Set<string>;
  sentMessageIds: Set<string>;
  pendingActionIds: Set<string>;
}

@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);
  private readonly s3: S3Client;
  private readonly bucket?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly association: ClientAssociationService,
    private readonly ai: EngagementAiService,
    private readonly notesCrypto: MeetingNotesCryptoService,
    private readonly directory: DirectoryService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.bucket = config.get('ASSETS_BUCKET', { infer: true });
    this.s3 = new S3Client({ region: config.get('AWS_REGION_DEFAULT', { infer: true }) });
  }

  capabilities() {
    return {
      ai: this.ai.capabilities(),
      notes: this.notesCrypto.capabilities(),
      attachments: { s3Configured: Boolean(this.bucket), maxBytes: MAX_ATTACHMENT_BYTES },
      integrations: {
        microsoft365: {
          status: 'requires_oauth_configuration',
          normalizedModels: ['meetings', 'mail_threads', 'mail_messages'],
        },
        googleWorkspace: {
          status: 'requires_oauth_configuration',
          normalizedModels: ['meetings', 'mail_threads', 'mail_messages'],
        },
        imapCaldav: {
          status: 'requires_server_credentials',
          normalizedModels: ['meetings', 'mail_threads', 'mail_messages'],
        },
      },
    };
  }

  listIntegrations(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.integrationConnection.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(ctx.role === 'standard_user' ? { createdByUserId: ctx.userId } : {}),
        },
        orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  }

  createIntegration(ctx: TenantContext, input: CreateIntegrationInput) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.integrationConnection.create({
        data: {
          tenantId: ctx.tenantId,
          provider: input.provider,
          accountEmail: input.accountEmail?.trim().toLowerCase() || null,
          displayName: input.displayName?.trim() || null,
          status: EngagementConnectionStatus.needs_configuration,
          scopes: defaultScopes(input.provider),
          syncState: {
            calendar: { cursor: null, updatedAt: null },
            mail: { cursor: null, updatedAt: null },
            webhooks: { configured: false },
          },
          createdByUserId: ctx.userId,
        },
      }),
    );
  }

  listMeetings(ctx: TenantContext, query: { clientId?: string; from?: string; to?: string }) {
    const { from, to } = toDateWindow(query);
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.meeting.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(query.clientId ? { clientId: query.clientId } : {}),
          startsAt: { gte: from, lt: to },
        },
        include: meetingInclude(),
        orderBy: { startsAt: 'asc' },
      }),
    );
  }

  async getMeeting(ctx: TenantContext, id: string) {
    const meeting = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.meeting.findUnique({ where: { id }, include: meetingInclude() }),
    );
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  async createMeeting(ctx: TenantContext, input: CreateMeetingInput) {
    const startsAt = parseDate(input.startsAt, 'startsAt');
    const endsAt = parseDate(input.endsAt, 'endsAt');
    if (endsAt < startsAt) throw new BadRequestException('endsAt must be after startsAt');

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const attendeeEmails = (input.attendees ?? [])
        .map((attendee) => attendee.email)
        .filter((email): email is string => Boolean(email));

      const autoAssociation = input.clientId
        ? {
            clientId: input.clientId,
            score: 1,
            reason: 'Manually selected during meeting creation.',
            signals: { manual: true },
          }
        : await this.association.associate(tx, ctx.tenantId, {
            subject: input.subject,
            body: input.description,
            attendeeEmails: [...attendeeEmails, input.organizerEmail ?? ''],
          });

      const contactsByEmail = await this.upsertAttendeeContacts(
        tx,
        ctx.tenantId,
        input.attendees ?? [],
        autoAssociation.clientId,
      );

      return tx.meeting.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: autoAssociation.clientId,
          source: EngagementSource.manual,
          subject: input.subject.trim(),
          description: input.description?.trim() || null,
          location: input.location?.trim() || null,
          startsAt,
          endsAt,
          organizerEmail: input.organizerEmail?.trim().toLowerCase() || null,
          organizerName: input.organizerName?.trim() || null,
          associationScore: autoAssociation.score,
          associationReason: autoAssociation.reason,
          associationSignals: autoAssociation.signals as Prisma.InputJsonValue,
          createdByUserId: ctx.userId,
          attendees: {
            create: (input.attendees ?? []).map((attendee) => ({
              tenantId: ctx.tenantId,
              email: attendee.email?.trim().toLowerCase() || null,
              name: attendee.name?.trim() || null,
              role: attendee.role?.trim() || null,
              responseStatus: attendee.responseStatus?.trim() || null,
              contactId: attendee.email
                ? (contactsByEmail.get(attendee.email.trim().toLowerCase())?.id ?? null)
                : null,
            })),
          },
        },
        include: meetingInclude(),
      });
    });
  }

  async updateMeeting(ctx: TenantContext, id: string, input: UpdateMeetingInput) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.meeting.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Meeting not found');

      const updated = await tx.meeting.update({
        where: { id },
        data: {
          ...('clientId' in input ? { clientId: input.clientId } : {}),
          ...('subject' in input ? { subject: input.subject?.trim() } : {}),
          ...('description' in input ? { description: input.description?.trim() || null } : {}),
          ...('location' in input ? { location: input.location?.trim() || null } : {}),
          ...('startsAt' in input ? { startsAt: parseDate(input.startsAt, 'startsAt') } : {}),
          ...('endsAt' in input ? { endsAt: parseDate(input.endsAt, 'endsAt') } : {}),
          ...('status' in input ? { status: input.status } : {}),
        },
        include: meetingInclude(),
      });

      if ('clientId' in input && input.clientId && input.clientId !== existing.clientId) {
        await tx.clientAssociationOverride.create({
          data: {
            tenantId: ctx.tenantId,
            entityType: AssociationEntityType.meeting,
            entityId: id,
            clientId: input.clientId,
            previousClientId: existing.clientId,
            confidenceBefore: existing.associationScore,
            reason: 'Meeting client changed from meeting edit form.',
            userId: ctx.userId,
          },
        });
      }

      return updated;
    });
  }

  listMailThreads(ctx: TenantContext, query: { clientId?: string }) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.mailThread.findMany({
        where: { tenantId: ctx.tenantId, ...(query.clientId ? { clientId: query.clientId } : {}) },
        include: {
          client: clientSummarySelect(),
          messages: { orderBy: { receivedAt: 'desc' }, take: 3 },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
    );
  }

  listTasks(ctx: TenantContext, query: { clientId?: string }) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.engagementTask.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(query.clientId ? { clientId: query.clientId } : {}),
          status: { not: EngagementTaskStatus.canceled },
        },
        include: {
          client: clientSummarySelect(),
          meeting: { select: { id: true, subject: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  }

  async reportOverview(ctx: TenantContext, query: EngagementReportQuery) {
    const period = normalizeReportPeriod(query.period);
    const cycle = reportPeriodWindow(period);
    const clientId = query.clientId?.trim() || undefined;
    const dateWhere =
      cycle.from && cycle.to
        ? {
            gte: cycle.from,
            lt: cycle.to,
          }
        : undefined;

    const data = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      if (clientId) {
        await ensureExists(
          tx.client.findFirst({
            where: { id: clientId, tenantId: ctx.tenantId },
            select: { id: true },
          }),
          'Client not found',
        );
      }

      const [storedTargets, meetings, messages, tasks] = await Promise.all([
        tx.engagementReportTargetOffice.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(clientId ? { OR: [{ clientId }, { scopeKey: 'all' }] } : {}),
          },
          include: { client: { select: { id: true, name: true } } },
          orderBy: [{ memberPrincipal: 'asc' }, { createdAt: 'asc' }],
        }),
        tx.meeting.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(clientId ? { clientId } : {}),
            ...(dateWhere ? { startsAt: dateWhere } : {}),
          },
          include: {
            client: { select: { id: true, name: true } },
            connection: { select: { accountEmail: true, displayName: true } },
            attendees: { select: { email: true, name: true, role: true } },
            preps: {
              select: { status: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            tasks: {
              where: {
                status: { notIn: [EngagementTaskStatus.done, EngagementTaskStatus.canceled] },
              },
              select: { id: true, status: true },
            },
          },
          orderBy: { startsAt: 'asc' },
        }),
        tx.mailMessage.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(dateWhere
              ? {
                  OR: [{ sentAt: dateWhere }, { receivedAt: dateWhere }],
                }
              : {}),
            ...(clientId ? { thread: { clientId } } : {}),
          },
          select: {
            id: true,
            threadId: true,
            fromEmail: true,
            toRecipients: true,
            ccRecipients: true,
            bccRecipients: true,
            sentAt: true,
            receivedAt: true,
            metadata: true,
            connection: { select: { accountEmail: true, displayName: true } },
            thread: { select: { id: true, subject: true, clientId: true } },
          },
          orderBy: [{ sentAt: 'desc' }, { receivedAt: 'desc' }],
        }),
        tx.engagementTask.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(clientId ? { clientId } : {}),
            status: { notIn: [EngagementTaskStatus.done, EngagementTaskStatus.canceled] },
          },
          select: {
            id: true,
            title: true,
            clientId: true,
            meetingId: true,
            status: true,
          },
        }),
      ]);

      return { storedTargets, meetings, messages, tasks };
    });

    const emailUniverse = unique([
      ...data.meetings.flatMap((meeting) => [
        meeting.organizerEmail ?? '',
        ...meeting.attendees.map((attendee) => attendee.email ?? ''),
      ]),
      ...data.messages.flatMap((message) => mailMessageEmails(message)),
    ]).filter((email): email is string => Boolean(email));
    const directoryMatches = await this.directoryMatchesForReport(emailUniverse);
    const matchesByEmail = new Map<string, DirectoryEmailMatch[]>();
    for (const match of directoryMatches) {
      const email = normalizeEmailAddress(match.attendeeEmail);
      if (!email) continue;
      const matches = matchesByEmail.get(email) ?? [];
      matches.push(match);
      matchesByEmail.set(email, matches);
    }

    const rows = new Map<string, ReportTargetDraft>();
    const rowKey = (scopeKey: string, officeKey: string) => `${scopeKey}:${officeKey}`;
    const ensureRow = (input: {
      targetId?: string | null;
      clientId?: string | null;
      clientName?: string | null;
      scopeKey: string;
      officeKey: string;
      memberPrincipal: string;
      committee?: string | null;
      staffer?: string | null;
      building?: string | null;
      leadOwner?: string | null;
      source: string;
      storedPrepStatus?: ReportStatus;
      storedOutreachStatus?: ReportStatus;
      storedSubmissionStatus?: ReportStatus;
    }) => {
      const key = rowKey(input.scopeKey, input.officeKey);
      const existing = rows.get(key);
      if (existing) {
        existing.targetId = existing.targetId ?? input.targetId ?? null;
        existing.clientId = existing.clientId ?? input.clientId ?? null;
        existing.clientName = existing.clientName ?? input.clientName ?? null;
        existing.committee = existing.committee || input.committee || null;
        existing.staffer = existing.staffer || input.staffer || null;
        existing.building = existing.building || input.building || null;
        existing.leadOwner = existing.leadOwner || input.leadOwner || null;
        existing.source = existing.source === 'manual' ? existing.source : input.source;
        existing.storedPrepStatus = mergeStoredStatus(
          existing.storedPrepStatus,
          input.storedPrepStatus,
        );
        existing.storedOutreachStatus = mergeStoredStatus(
          existing.storedOutreachStatus,
          input.storedOutreachStatus,
        );
        existing.storedSubmissionStatus = mergeStoredStatus(
          existing.storedSubmissionStatus,
          input.storedSubmissionStatus,
        );
        return existing;
      }

      const created: ReportTargetDraft = {
        targetId: input.targetId ?? null,
        clientId: input.clientId ?? null,
        clientName: input.clientName ?? null,
        scopeKey: input.scopeKey,
        officeKey: input.officeKey,
        memberPrincipal: input.memberPrincipal,
        committee: input.committee ?? null,
        staffer: input.staffer ?? null,
        building: input.building ?? null,
        leadOwner: input.leadOwner ?? null,
        source: input.source,
        storedPrepStatus: input.storedPrepStatus ?? 'auto',
        storedOutreachStatus: input.storedOutreachStatus ?? 'auto',
        storedSubmissionStatus: input.storedSubmissionStatus ?? 'auto',
        meetingIds: new Set(),
        heldMeetingIds: new Set(),
        preparedMeetingIds: new Set(),
        approvedPrepMeetingIds: new Set(),
        meetings: new Map(),
        threadIds: new Set(),
        sentMessageIds: new Set(),
        pendingActionIds: new Set(),
      };
      rows.set(key, created);
      return created;
    };

    for (const target of data.storedTargets) {
      ensureRow({
        targetId: target.id,
        clientId: target.clientId,
        clientName: target.client?.name ?? null,
        scopeKey: target.scopeKey,
        officeKey: target.officeKey,
        memberPrincipal: target.memberPrincipal,
        committee: target.committee,
        staffer: target.staffer,
        building: target.building,
        leadOwner: target.leadOwner,
        source: target.source,
        storedPrepStatus: normalizeReportStatus(target.prepStatus),
        storedOutreachStatus: normalizeReportStatus(target.outreachStatus),
        storedSubmissionStatus: normalizeReportStatus(target.submissionStatus),
      });
    }

    const now = new Date();
    for (const meeting of data.meetings) {
      const meetingEmails = unique([
        meeting.organizerEmail ?? '',
        ...meeting.attendees.map((attendee) => attendee.email ?? ''),
      ]).filter((email): email is string => Boolean(email));
      const matches = uniqueDirectoryMatches(
        meetingEmails.flatMap(
          (email) => matchesByEmail.get(normalizeEmailAddress(email) ?? '') ?? [],
        ),
      );
      const meetingScopeKey = reportScopeKey(clientId ?? meeting.clientId ?? null);
      for (const match of matches) {
        const row = ensureRow({
          clientId: clientId ?? meeting.clientId,
          clientName: meeting.client?.name ?? null,
          scopeKey: meetingScopeKey,
          officeKey: reportOfficeKey(match),
          ...reportTargetDetails(match),
          leadOwner:
            meeting.connection?.displayName || meeting.connection?.accountEmail || undefined,
          source: 'directory',
        });
        row.meetingIds.add(meeting.id);
        if (meeting.endsAt <= now && meeting.status !== 'canceled')
          row.heldMeetingIds.add(meeting.id);
        if (meeting.preps[0]) row.preparedMeetingIds.add(meeting.id);
        if (meeting.preps[0]?.status === MeetingPrepStatus.approved) {
          row.approvedPrepMeetingIds.add(meeting.id);
        }
        for (const task of meeting.tasks) row.pendingActionIds.add(task.id);
        row.meetings.set(meeting.id, {
          id: meeting.id,
          subject: meeting.subject,
          startsAt: meeting.startsAt,
          endsAt: meeting.endsAt,
          location: meeting.location,
          externalUrl: readWebLink(meeting.metadata),
        });
      }
    }

    for (const message of data.messages) {
      const messageEmails = unique(mailMessageEmails(message)).filter((email): email is string =>
        Boolean(email),
      );
      const matches = uniqueDirectoryMatches(
        messageEmails.flatMap(
          (email) => matchesByEmail.get(normalizeEmailAddress(email) ?? '') ?? [],
        ),
      );
      if (!matches.length) continue;
      const messageScopeKey = reportScopeKey(clientId ?? message.thread.clientId ?? null);
      const isSent = isSentMailMessage(message.metadata);
      for (const match of matches) {
        const row = ensureRow({
          clientId: clientId ?? message.thread.clientId,
          scopeKey: messageScopeKey,
          officeKey: reportOfficeKey(match),
          ...reportTargetDetails(match),
          leadOwner:
            message.connection?.displayName || message.connection?.accountEmail || undefined,
          source: 'directory',
        });
        row.threadIds.add(message.threadId);
        if (isSent) row.sentMessageIds.add(message.id);
      }
    }

    const openTaskCount = data.tasks.length;
    const sentMessageIds = new Set(
      data.messages
        .filter((message) => isSentMailMessage(message.metadata))
        .map((message) => message.id),
    );
    const heldMeetingIds = new Set(
      data.meetings
        .filter((meeting) => meeting.endsAt <= now && meeting.status !== 'canceled')
        .map((meeting) => meeting.id),
    );

    const rowsOut = Array.from(rows.values())
      .map((row) => {
        const prepStatus = resolveReportStatus(row.storedPrepStatus, autoPrepStatus(row));
        const outreachStatus = resolveReportStatus(
          row.storedOutreachStatus,
          autoOutreachStatus(row),
        );
        const submissionStatus = resolveReportStatus(row.storedSubmissionStatus, 'not_started');
        return {
          targetId: row.targetId,
          clientId: row.clientId,
          clientName: row.clientName,
          scopeKey: row.scopeKey,
          officeKey: row.officeKey,
          memberPrincipal: row.memberPrincipal,
          committee: row.committee,
          staffer: row.staffer,
          building: row.building,
          leadOwner: row.leadOwner,
          meetingsHeld: row.heldMeetingIds.size,
          outreachSent: row.sentMessageIds.size,
          pendingActions: row.pendingActionIds.size,
          prepStatus,
          outreachStatus,
          submissionStatus,
          source: row.source,
          manuallyOverridden:
            row.storedPrepStatus !== 'auto' ||
            row.storedOutreachStatus !== 'auto' ||
            row.storedSubmissionStatus !== 'auto',
          meetings: Array.from(row.meetings.values()).sort(
            (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
          ),
        };
      })
      .sort((left, right) => left.memberPrincipal.localeCompare(right.memberPrincipal));

    return {
      cycle,
      summary: {
        targetOffices: rowsOut.length,
        meetingsHeld: heldMeetingIds.size,
        outreachSent: sentMessageIds.size,
        submissionsFiled: rowsOut.filter((row) => row.submissionStatus === 'complete').length,
        pendingActions: openTaskCount,
      },
      rows: rowsOut,
    };
  }

  async createReportTargetOffice(ctx: TenantContext, input: CreateReportTargetOfficeInput) {
    const clientId = input.clientId?.trim() || null;
    const scopeKey = reportScopeKey(clientId);
    const memberPrincipal = requiredReportText(input.memberPrincipal, 'memberPrincipal', 240);
    const officeKey = `manual:${randomUUID()}`;

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      if (clientId) {
        await ensureExists(
          tx.client.findFirst({
            where: { id: clientId, tenantId: ctx.tenantId },
            select: { id: true },
          }),
          'Client not found',
        );
      }

      return tx.engagementReportTargetOffice.create({
        data: {
          tenantId: ctx.tenantId,
          clientId,
          scopeKey,
          officeKey,
          memberPrincipal,
          committee: optionalReportText(input.committee, 120),
          staffer: optionalReportText(input.staffer, 160),
          building: optionalReportText(input.building, 120),
          leadOwner: optionalReportText(input.leadOwner, 120),
          source: 'manual',
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  async upsertReportTargetOffice(ctx: TenantContext, input: UpsertReportTargetOfficeInput) {
    const clientId = input.clientId?.trim() || null;
    const scopeKey = reportScopeKey(clientId);
    const officeKey = requiredReportText(input.officeKey, 'officeKey', 240);
    const memberPrincipal = requiredReportText(input.memberPrincipal, 'memberPrincipal', 240);

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      if (clientId) {
        await ensureExists(
          tx.client.findFirst({
            where: { id: clientId, tenantId: ctx.tenantId },
            select: { id: true },
          }),
          'Client not found',
        );
      }

      return tx.engagementReportTargetOffice.upsert({
        where: {
          tenantId_scopeKey_officeKey: {
            tenantId: ctx.tenantId,
            scopeKey,
            officeKey,
          },
        },
        update: {
          memberPrincipal,
          committee: optionalReportText(input.committee, 120),
          staffer: optionalReportText(input.staffer, 160),
          building: optionalReportText(input.building, 120),
          leadOwner: optionalReportText(input.leadOwner, 120),
          ...(input.prepStatus ? { prepStatus: normalizeReportStatus(input.prepStatus) } : {}),
          ...(input.outreachStatus
            ? { outreachStatus: normalizeReportStatus(input.outreachStatus) }
            : {}),
          ...(input.submissionStatus
            ? { submissionStatus: normalizeReportStatus(input.submissionStatus) }
            : {}),
          source: input.source?.trim().slice(0, 80) || 'manual_override',
        },
        create: {
          tenantId: ctx.tenantId,
          clientId,
          scopeKey,
          officeKey,
          memberPrincipal,
          committee: optionalReportText(input.committee, 120),
          staffer: optionalReportText(input.staffer, 160),
          building: optionalReportText(input.building, 120),
          leadOwner: optionalReportText(input.leadOwner, 120),
          prepStatus: normalizeReportStatus(input.prepStatus),
          outreachStatus: normalizeReportStatus(input.outreachStatus),
          submissionStatus: normalizeReportStatus(input.submissionStatus),
          source: input.source?.trim().slice(0, 80) || 'manual_override',
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  createTask(ctx: TenantContext, input: CreateTaskInput) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.engagementTask.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: input.clientId ?? null,
          meetingId: input.meetingId ?? null,
          contactId: input.contactId ?? null,
          mailThreadId: input.mailThreadId ?? null,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          ownerUserId: input.ownerUserId ?? null,
          dueDate: input.dueDate ? parseDate(input.dueDate, 'dueDate') : null,
          createdByUserId: ctx.userId,
        },
      }),
    );
  }

  async updateTask(ctx: TenantContext, id: string, input: UpdateTaskInput) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await ensureExists(tx.engagementTask.findUnique({ where: { id } }), 'Task not found');
      return tx.engagementTask.update({
        where: { id },
        data: {
          ...('title' in input ? { title: input.title?.trim() } : {}),
          ...('description' in input ? { description: input.description?.trim() || null } : {}),
          ...('ownerUserId' in input ? { ownerUserId: input.ownerUserId ?? null } : {}),
          ...('dueDate' in input
            ? { dueDate: input.dueDate ? parseDate(input.dueDate, 'dueDate') : null }
            : {}),
          ...('status' in input ? { status: input.status } : {}),
        },
      });
    });
  }

  async createMeetingNote(
    ctx: TenantContext,
    meetingId: string,
    input: { body: string; confidential?: boolean; accessLevel?: string },
  ) {
    const encrypted = this.notesCrypto.encrypt(input.body);
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const meeting = await tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId },
      });
      if (!meeting) throw new NotFoundException('Meeting not found');
      return tx.meetingNote.create({
        data: {
          tenantId: ctx.tenantId,
          meetingId,
          clientId: meeting.clientId,
          authorUserId: ctx.userId,
          bodyCiphertext: encrypted.bodyCiphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          confidential: input.confidential ?? true,
          accessLevel: input.accessLevel ?? 'tenant_admins_and_author',
        },
        select: noteMetadataSelect(),
      });
    });
  }

  async createMeetingDebrief(
    ctx: TenantContext,
    meetingId: string,
    input: { body: string; confidential?: boolean; accessLevel?: string },
  ) {
    const encrypted = this.notesCrypto.encrypt(input.body);
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const meeting = await tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId },
      });
      if (!meeting) throw new NotFoundException('Meeting not found');
      return tx.meetingDebrief.create({
        data: {
          tenantId: ctx.tenantId,
          meetingId,
          clientId: meeting.clientId,
          authorUserId: ctx.userId,
          bodyCiphertext: encrypted.bodyCiphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          confidential: input.confidential ?? true,
          accessLevel: input.accessLevel ?? 'tenant_members',
        },
        select: debriefMetadataSelect(),
      });
    });
  }

  async listMeetingNotes(ctx: TenantContext, meetingId: string) {
    const notes = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const meeting = await tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!meeting) throw new NotFoundException('Meeting not found');

      return tx.meetingNote.findMany({
        where: { tenantId: ctx.tenantId, meetingId },
        include: {
          author: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    return notes.map((note) => {
      const canReadBody = canReadEncryptedEntry(ctx, note);
      return {
        id: note.id,
        meetingId: note.meetingId,
        clientId: note.clientId,
        body: canReadBody
          ? this.notesCrypto.decrypt({
              bodyCiphertext: note.bodyCiphertext,
              iv: note.iv,
              authTag: note.authTag,
            })
          : null,
        confidential: note.confidential,
        accessLevel: note.accessLevel,
        keyVersion: note.keyVersion,
        authorUserId: note.authorUserId,
        author: note.author,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        restricted: !canReadBody,
      };
    });
  }

  async listMeetingDebriefs(ctx: TenantContext, meetingId: string) {
    const debriefs = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const meeting = await tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!meeting) throw new NotFoundException('Meeting not found');

      return tx.meetingDebrief.findMany({
        where: { tenantId: ctx.tenantId, meetingId },
        include: {
          author: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    return debriefs.map((debrief) => {
      const canReadBody = canReadEncryptedEntry(ctx, debrief);
      return {
        id: debrief.id,
        meetingId: debrief.meetingId,
        clientId: debrief.clientId,
        body: canReadBody
          ? this.notesCrypto.decrypt({
              bodyCiphertext: debrief.bodyCiphertext,
              iv: debrief.iv,
              authTag: debrief.authTag,
            })
          : null,
        confidential: debrief.confidential,
        accessLevel: debrief.accessLevel,
        keyVersion: debrief.keyVersion,
        authorUserId: debrief.authorUserId,
        author: debrief.author,
        createdAt: debrief.createdAt,
        updatedAt: debrief.updatedAt,
        restricted: !canReadBody,
      };
    });
  }

  async generateMeetingPrep(ctx: TenantContext, meetingId: string) {
    const context = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const meeting = await tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId },
        include: {
          client: true,
          attendees: true,
          tasks: {
            where: {
              status: { notIn: [EngagementTaskStatus.done, EngagementTaskStatus.canceled] },
            },
          },
        },
      });
      if (!meeting) throw new NotFoundException('Meeting not found');

      const recentMeetings = meeting.clientId
        ? await tx.meeting.findMany({
            where: { tenantId: ctx.tenantId, clientId: meeting.clientId, id: { not: meeting.id } },
            select: {
              id: true,
              subject: true,
              startsAt: true,
              associationReason: true,
              attendees: { select: { email: true, name: true } },
            },
            orderBy: { startsAt: 'desc' },
            take: 5,
          })
        : [];

      const recentThreads = meeting.clientId
        ? await tx.mailThread.findMany({
            where: { tenantId: ctx.tenantId, clientId: meeting.clientId },
            select: { id: true, subject: true, snippet: true, lastMessageAt: true, status: true },
            orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
            take: 5,
          })
        : [];

      return { meeting, recentMeetings, recentThreads };
    });

    const directoryProfiles = await this.directoryProfilesForMeeting(context.meeting);
    const promptContext = {
      meeting: pruneForAi(context.meeting),
      client: context.meeting.client ? pruneForAi(context.meeting.client) : null,
      attendees: context.meeting.attendees.map(pruneForAi),
      congressionalDirectoryMatches: directoryProfiles.map(pruneForAi),
      recentMeetings: context.recentMeetings.map(pruneForAi),
      recentThreads: context.recentThreads.map(pruneForAi),
      tasks: context.meeting.tasks.map(pruneForAi),
    };
    const promptHash = createHash('sha256').update(JSON.stringify(promptContext)).digest('hex');
    const generated = await this.ai.generateMeetingPrep(promptContext);

    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.meetingPrep.create({
        data: {
          tenantId: ctx.tenantId,
          meetingId,
          clientId: context.meeting.clientId,
          agenda: generated.agenda,
          talkingPoints: generated.talkingPoints,
          risks: generated.risks,
          followUps: generated.followUps,
          summary: generated.summary,
          provider: generated.provider,
          model: generated.model,
          promptHash,
          generatedFrom: {
            promptHash,
            meetingId,
            recentMeetings: context.recentMeetings.map((meeting) => meeting.id),
            recentThreads: context.recentThreads.map((thread) => thread.id),
            congressionalDirectoryContactIds: directoryProfiles.map(
              (profile) => profile.directoryContactId,
            ),
          },
        },
      }),
    );
  }

  async updateMeetingPrep(ctx: TenantContext, prepId: string, input: UpdateMeetingPrepInput) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const prep = await tx.meetingPrep.findFirst({
        where: { id: prepId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!prep) throw new NotFoundException('Meeting prep not found');

      return tx.meetingPrep.update({
        where: { id: prepId },
        data: {
          ...('summary' in input ? { summary: input.summary?.trim() || null } : {}),
          ...('agenda' in input ? { agenda: normalizeStringArray(input.agenda) } : {}),
          ...('talkingPoints' in input
            ? { talkingPoints: normalizeStringArray(input.talkingPoints) }
            : {}),
          ...('risks' in input ? { risks: normalizeStringArray(input.risks) } : {}),
          ...('followUps' in input ? { followUps: normalizeStringArray(input.followUps) } : {}),
          status: MeetingPrepStatus.edited,
          editedByUserId: ctx.userId,
        },
      });
    });
  }

  async approveMeetingPrep(ctx: TenantContext, prepId: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const prep = await tx.meetingPrep.findFirst({
        where: { id: prepId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!prep) throw new NotFoundException('Meeting prep not found');

      return tx.meetingPrep.update({
        where: { id: prepId },
        data: {
          status: MeetingPrepStatus.approved,
          editedByUserId: ctx.userId,
        },
      });
    });
  }

  private async directoryProfilesForMeeting(
    meeting: Prisma.MeetingGetPayload<{
      include: { attendees: true };
    }>,
  ) {
    const attendeeEmails = meeting.attendees
      .map((attendee) => attendee.email)
      .filter((email): email is string => Boolean(email));
    const emails = [meeting.organizerEmail, ...attendeeEmails].filter((email): email is string =>
      Boolean(email),
    );
    if (!emails.length) return [];

    try {
      return await this.directory.findContactsByEmails(emails);
    } catch (error) {
      this.logger.warn(
        `Could not enrich meeting ${meeting.id} with congressional directory context: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async directoryMatchesForReport(emails: string[]) {
    if (!emails.length) return [];
    try {
      return await this.directory.findContactsByEmails(emails, 500);
    } catch (error) {
      this.logger.warn(
        `Could not enrich engagement report with congressional directory context: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  async overrideAssociation(ctx: TenantContext, input: AssociationOverrideInput) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await ensureExists(
        tx.client.findUnique({ where: { id: input.clientId } }),
        'Client not found',
      );

      if (input.entityType === AssociationEntityType.meeting) {
        const existing = await tx.meeting.findUnique({ where: { id: input.entityId } });
        if (!existing) throw new NotFoundException('Meeting not found');
        await tx.meeting.update({
          where: { id: input.entityId },
          data: { clientId: input.clientId },
        });
        return tx.clientAssociationOverride.create({
          data: {
            tenantId: ctx.tenantId,
            entityType: input.entityType,
            entityId: input.entityId,
            clientId: input.clientId,
            previousClientId: existing.clientId,
            confidenceBefore: existing.associationScore,
            reason: input.reason ?? 'Manual association override.',
            userId: ctx.userId,
          },
        });
      }

      if (input.entityType === AssociationEntityType.mail_thread) {
        const existing = await tx.mailThread.findUnique({ where: { id: input.entityId } });
        if (!existing) throw new NotFoundException('Mail thread not found');
        await tx.mailThread.update({
          where: { id: input.entityId },
          data: { clientId: input.clientId },
        });
        return tx.clientAssociationOverride.create({
          data: {
            tenantId: ctx.tenantId,
            entityType: input.entityType,
            entityId: input.entityId,
            clientId: input.clientId,
            previousClientId: existing.clientId,
            confidenceBefore: existing.associationScore,
            reason: input.reason ?? 'Manual association override.',
            userId: ctx.userId,
          },
        });
      }

      throw new BadRequestException('Only meeting and mail_thread overrides are supported now');
    });
  }

  async clientContext(ctx: TenantContext, clientId: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) throw new NotFoundException('Client not found');
      const [meetings, threads, contacts, tasks] = await Promise.all([
        tx.meeting.findMany({
          where: { tenantId: ctx.tenantId, clientId },
          include: { attendees: true },
          orderBy: { startsAt: 'desc' },
          take: 10,
        }),
        tx.mailThread.findMany({
          where: { tenantId: ctx.tenantId, clientId },
          orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
          take: 10,
        }),
        tx.engagementContact.findMany({
          where: { tenantId: ctx.tenantId, clientId },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
        tx.engagementTask.findMany({
          where: {
            tenantId: ctx.tenantId,
            clientId,
            status: { notIn: [EngagementTaskStatus.done, EngagementTaskStatus.canceled] },
          },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
          take: 20,
        }),
      ]);

      return {
        client,
        recentActivity: [
          ...meetings.map((meeting) => ({
            type: 'meeting',
            id: meeting.id,
            title: meeting.subject,
            date: meeting.startsAt,
          })),
          ...threads.map((thread) => ({
            type: 'mail_thread',
            id: thread.id,
            title: thread.subject,
            date: thread.lastMessageAt ?? thread.updatedAt,
          })),
        ]
          .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
          .slice(0, 12),
        keyStakeholders: contacts,
        openThreads: threads.filter((thread) => thread.status !== 'closed'),
        openTasks: tasks,
        summary: {
          meetings: meetings.length,
          mailThreads: threads.length,
          contacts: contacts.length,
          openTasks: tasks.length,
          rag: 'pgvector storage is provisioned; embeddings are written once an embedding provider is configured.',
        },
      };
    });
  }

  async createAttachmentUploadUrl(ctx: TenantContext, input: AttachmentUploadInput) {
    if (!this.bucket) throw new ServiceUnavailableException('ASSETS_BUCKET is not configured');
    if (input.contentLength > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(`Attachment must be <= ${MAX_ATTACHMENT_BYTES} bytes`);
    }
    if (!input.clientId && !input.meetingId && !input.mailMessageId) {
      throw new BadRequestException(
        'Attachment must be linked to a client, meeting, or mail message',
      );
    }

    const safeName = safeFileName(input.fileName);
    const s3Key = `tenants/${ctx.tenantId}/engagement/${randomUUID()}/${safeName}`;
    const presigned = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: s3Key,
      Conditions: [
        ['content-length-range', 1, MAX_ATTACHMENT_BYTES],
        ['eq', '$Content-Type', input.contentType],
        ['starts-with', '$key', `tenants/${ctx.tenantId}/engagement/`],
      ],
      Fields: { 'Content-Type': input.contentType },
      Expires: 300,
    });
    return { ...presigned, s3Key };
  }

  async confirmAttachment(ctx: TenantContext, input: ConfirmAttachmentInput) {
    if (!this.bucket) throw new ServiceUnavailableException('ASSETS_BUCKET is not configured');
    if (!input.s3Key.startsWith(`tenants/${ctx.tenantId}/engagement/`)) {
      throw new BadRequestException('Attachment key is outside tenant engagement prefix');
    }
    const head = await this.s3
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.s3Key }))
      .catch(() => null);
    if (!head) throw new BadRequestException('Uploaded attachment not found in S3');

    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.engagementAttachment.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: input.clientId ?? null,
          meetingId: input.meetingId ?? null,
          mailMessageId: input.mailMessageId ?? null,
          fileName: input.fileName,
          contentType: input.contentType,
          byteSize: head.ContentLength ? Number(head.ContentLength) : null,
          bucket: this.bucket!,
          s3Key: input.s3Key,
          checksumSha256: input.checksumSha256 ?? null,
          uploadedByUserId: ctx.userId,
        },
      }),
    );
  }

  async listAttachments(
    ctx: TenantContext,
    query: { clientId?: string; meetingId?: string; mailMessageId?: string },
  ) {
    if (!query.clientId && !query.meetingId && !query.mailMessageId) {
      throw new BadRequestException('At least one attachment parent is required');
    }
    const rows = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.engagementAttachment.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(query.clientId ? { clientId: query.clientId } : {}),
          ...(query.meetingId ? { meetingId: query.meetingId } : {}),
          ...(query.mailMessageId ? { mailMessageId: query.mailMessageId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        downloadUrl: await this.createAttachmentDownloadUrl(row.s3Key),
      })),
    );
  }

  async deleteAttachment(ctx: TenantContext, id: string) {
    const attachment = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.engagementAttachment.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Attachment not found');
      return row;
    });

    if (this.bucket) {
      await this.s3
        .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: attachment.s3Key }))
        .catch(() => undefined);
    }

    await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.engagementAttachment.delete({ where: { id } }),
    );
    return { ok: true };
  }

  private async createAttachmentDownloadUrl(s3Key: string): Promise<string | null> {
    if (!this.bucket) return null;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }), {
      expiresIn: 300,
    });
  }

  private async upsertAttendeeContacts(
    tx: Prisma.TransactionClient,
    tenantId: string,
    attendees: MeetingAttendeeInput[],
    clientId: string | null,
  ) {
    const contacts = new Map<string, { id: string }>();
    for (const attendee of attendees) {
      const email = attendee.email?.trim().toLowerCase();
      if (!email) continue;
      const contact = await tx.engagementContact.upsert({
        where: { tenantId_email: { tenantId, email } },
        update: {
          fullName: attendee.name?.trim() || undefined,
          ...(clientId ? { clientId } : {}),
        },
        create: {
          tenantId,
          email,
          fullName: attendee.name?.trim() || null,
          source: 'meeting_attendee',
          clientId,
        },
        select: { id: true },
      });
      contacts.set(email, contact);
    }
    return contacts;
  }
}

function meetingInclude() {
  return {
    client: clientSummarySelect(),
    attendees: { include: { contact: true }, orderBy: { createdAt: 'asc' as const } },
    attachments: { orderBy: { createdAt: 'desc' as const } },
    notes: { select: noteMetadataSelect(), orderBy: { createdAt: 'desc' as const } },
    debriefs: { select: debriefMetadataSelect(), orderBy: { createdAt: 'desc' as const } },
    preps: { orderBy: { createdAt: 'desc' as const }, take: 1 },
    tasks: {
      where: { status: { not: EngagementTaskStatus.canceled } },
      orderBy: [{ dueDate: 'asc' as const }, { createdAt: 'desc' as const }],
    },
  };
}

function clientSummarySelect() {
  return {
    select: {
      id: true,
      name: true,
      website: true,
      primaryContactName: true,
      primaryContactEmail: true,
      intakeData: true,
    },
  };
}

function noteMetadataSelect() {
  return {
    id: true,
    meetingId: true,
    clientId: true,
    authorUserId: true,
    author: { select: { id: true, email: true, firstName: true, lastName: true } },
    confidential: true,
    accessLevel: true,
    keyVersion: true,
    createdAt: true,
    updatedAt: true,
  };
}

function debriefMetadataSelect() {
  return {
    id: true,
    meetingId: true,
    clientId: true,
    authorUserId: true,
    author: { select: { id: true, email: true, firstName: true, lastName: true } },
    confidential: true,
    accessLevel: true,
    keyVersion: true,
    createdAt: true,
    updatedAt: true,
  };
}

function canReadEncryptedEntry(
  ctx: TenantContext,
  note: { confidential: boolean; accessLevel: string; authorUserId: string | null },
): boolean {
  if (!note.confidential) return true;
  if (note.authorUserId === ctx.userId) return true;
  if (ctx.role === 'user_admin' || ctx.role === 'capiro_admin') return true;
  return note.accessLevel === 'tenant_members';
}

function normalizeStringArray(value?: string[]): string[] {
  return (value ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeReportPeriod(value?: string): ReportPeriod {
  if (value === 'previous' || value === 'all') return value;
  return 'current';
}

function reportPeriodWindow(period: ReportPeriod) {
  if (period === 'all') return { period, label: 'All time', from: null, to: null };

  const now = new Date();
  const year = now.getUTCFullYear() + (period === 'previous' ? -1 : 0);
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  return {
    period,
    label: period === 'previous' ? `Previous cycle (${year})` : `Current cycle (${year})`,
    from,
    to,
  };
}

function reportScopeKey(clientId: string | null | undefined): string {
  return clientId || 'all';
}

function normalizeReportStatus(value?: string | null): ReportStatus {
  return REPORT_STATUSES.includes(value as ReportStatus) ? (value as ReportStatus) : 'auto';
}

function mergeStoredStatus(current: ReportStatus, next?: ReportStatus): ReportStatus {
  if (current !== 'auto') return current;
  return next && next !== 'auto' ? next : current;
}

function resolveReportStatus(stored: ReportStatus, automatic: Exclude<ReportStatus, 'auto'>) {
  return stored === 'auto' ? automatic : stored;
}

function autoPrepStatus(row: ReportTargetDraft): Exclude<ReportStatus, 'auto'> {
  if (row.meetingIds.size === 0) return 'not_started';
  if (row.preparedMeetingIds.size >= row.meetingIds.size) return 'complete';
  if (row.preparedMeetingIds.size > 0 || row.approvedPrepMeetingIds.size > 0) return 'in_progress';
  return 'not_started';
}

function autoOutreachStatus(row: ReportTargetDraft): Exclude<ReportStatus, 'auto'> {
  if (row.sentMessageIds.size > 0) return 'complete';
  if (row.threadIds.size > 0) return 'in_progress';
  return 'not_started';
}

function reportOfficeKey(match: DirectoryEmailMatch): string {
  return `directory:${match.directoryContactId}`;
}

function reportTargetDetails(match: DirectoryEmailMatch) {
  return {
    memberPrincipal: reportMemberPrincipal(match),
    committee: match.member.committees[0] ?? null,
    staffer: match.staff?.fullName ?? null,
    building: reportBuilding(match),
  };
}

function reportMemberPrincipal(match: DirectoryEmailMatch): string {
  const member = match.member;
  const district = member.chamber === 'House' ? `${member.state}-${member.district}` : member.state;
  return `${member.fullName} (${partyInitial(member.partyName)}-${district})`;
}

function partyInitial(partyName: string): string {
  const normalized = partyName.toLowerCase();
  if (normalized.startsWith('dem')) return 'D';
  if (normalized.startsWith('rep')) return 'R';
  if (normalized.startsWith('ind')) return 'I';
  return partyName.slice(0, 1).toUpperCase() || '?';
}

function reportBuilding(match: DirectoryEmailMatch): string | null {
  const value =
    match.staff?.officeLocation ||
    match.member.officeLocation ||
    match.member.addresses.find((address) => address.isMain)?.title ||
    '';
  if (!value) return null;
  if (/rayburn/i.test(value)) return 'Rayburn';
  if (/cannon/i.test(value)) return 'Cannon';
  if (/longworth/i.test(value)) return 'Longworth';
  if (/russell/i.test(value)) return 'Russell';
  if (/dirksen/i.test(value)) return 'Dirksen';
  if (/hart/i.test(value)) return 'Hart';
  return value.slice(0, 120);
}

function uniqueDirectoryMatches(matches: DirectoryEmailMatch[]): DirectoryEmailMatch[] {
  const seen = new Set<string>();
  const next: DirectoryEmailMatch[] = [];
  for (const match of matches) {
    const key = `${match.directoryContactId}:${match.staff?.id ?? 'member'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(match);
  }
  return next;
}

function mailMessageEmails(message: {
  fromEmail: string | null;
  toRecipients: Prisma.JsonValue;
  ccRecipients: Prisma.JsonValue;
  bccRecipients: Prisma.JsonValue;
}): string[] {
  return unique([
    message.fromEmail ?? '',
    ...recipientEmails(message.toRecipients),
    ...recipientEmails(message.ccRecipients),
    ...recipientEmails(message.bccRecipients),
  ]).filter(Boolean);
}

function recipientEmails(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const email =
        typeof record.email === 'string'
          ? record.email
          : typeof record.address === 'string'
            ? record.address
            : null;
      return normalizeEmailAddress(email);
    })
    .filter((email): email is string => Boolean(email));
}

function isSentMailMessage(metadata: Prisma.JsonValue): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  const folder = typeof record.folder === 'string' ? record.folder.toLowerCase() : '';
  const folders = Array.isArray(record.folders)
    ? record.folders
        .map((entry) => (typeof entry === 'string' ? entry.toLowerCase() : ''))
        .filter(Boolean)
    : [];
  return folder === 'sentitems' || folder === 'sent items' || folders.includes('sentitems');
}

function readWebLink(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).webLink;
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : null;
}

function requiredReportText(value: string | undefined | null, field: string, max: number): string {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${field} is required`);
  return text.slice(0, max);
}

function optionalReportText(value: string | undefined | null, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

function normalizeEmailAddress(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes('@') ? normalized : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function defaultScopes(provider: EngagementProvider): string[] {
  if (provider === EngagementProvider.microsoft_365) {
    return ['offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'];
  }
  if (provider === EngagementProvider.google_workspace) {
    return [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
    ];
  }
  if (provider === EngagementProvider.imap_caldav) return ['imap.read', 'caldav.read'];
  return [];
}

function toDateWindow(query: { from?: string; to?: string }) {
  const from = query.from ? parseDate(query.from, 'from') : startOfToday();
  const to = query.to ? parseDate(query.to, 'to') : addDays(from, 1);
  if (to <= from) throw new BadRequestException('to must be after from');
  return { from, to };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDate(value: string | undefined, field: string): Date {
  if (!value) throw new BadRequestException(`${field} is required`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return date;
}

async function ensureExists<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) throw new NotFoundException(message);
  return value;
}

function pruneForAi(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return JSON.parse(
    JSON.stringify(value, (_key, entry) => {
      if (entry instanceof Date) return entry.toISOString();
      return entry;
    }),
  ) as Record<string, unknown>;
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return cleaned || 'attachment';
}
