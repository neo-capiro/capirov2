import {
  BadRequestException,
  Injectable,
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
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

@Injectable()
export class EngagementService {
  private readonly s3: S3Client;
  private readonly bucket?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly association: ClientAssociationService,
    private readonly ai: EngagementAiService,
    private readonly notesCrypto: MeetingNotesCryptoService,
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
      const meeting = await tx.meeting.findUnique({ where: { id: meetingId } });
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

  async generateMeetingPrep(ctx: TenantContext, meetingId: string) {
    const context = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const meeting = await tx.meeting.findUnique({
        where: { id: meetingId },
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

    const promptContext = {
      meeting: pruneForAi(context.meeting),
      client: context.meeting.client ? pruneForAi(context.meeting.client) : null,
      attendees: context.meeting.attendees.map(pruneForAi),
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
          },
        },
      }),
    );
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
    confidential: true,
    accessLevel: true,
    keyVersion: true,
    createdAt: true,
    updatedAt: true,
  };
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
