import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { WorkflowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/config.schema.js';
import type { CreateWorkflowInstanceDto } from './dto/create-workflow-instance.dto.js';
import type { UpdateWorkflowInstanceDto } from './dto/update-workflow-instance.dto.js';

const AI_FILL_MODEL = 'claude-haiku-4-5-20251001';
const MAX_DOC_CHARS = 10_000;

@Injectable()
export class WorkflowsService {
  private readonly s3: S3Client;
  private readonly anthropicKey?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.anthropicKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.s3 = new S3Client({ region: config.get('AWS_REGION_DEFAULT', { infer: true }) });
  }

  listTemplates() {
    return this.prisma.workflowTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getTemplateBySlug(slug: string) {
    const template = await this.prisma.workflowTemplate.findUnique({ where: { slug } });
    if (!template) throw new NotFoundException(`Workflow template '${slug}' not found`);
    return template;
  }

  async createInstance(tenantId: string, userId: string, dto: CreateWorkflowInstanceDto) {
    const template = await this.getTemplateBySlug(dto.templateSlug);
    return this.prisma.workflowInstance.create({
      data: {
        tenantId,
        templateId: template.id,
        createdByUserId: userId,
        clientId: dto.clientId,
        title: dto.title ?? template.name,
        status: WorkflowStatus.triage,
      },
      include: { template: true },
    });
  }

  listInstances(tenantId: string, filters?: { status?: string; clientId?: string }) {
    return this.prisma.workflowInstance.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status as WorkflowStatus } : {}),
        ...(filters?.clientId ? { clientId: filters.clientId } : {}),
      },
      include: { template: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInstance(tenantId: string, id: string) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${id}' not found`);
    }
    return instance;
  }

  async updateInstance(tenantId: string, id: string, dto: UpdateWorkflowInstanceDto) {
    await this.getInstance(tenantId, id);

    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.formData !== undefined) data.formData = dto.formData;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.targetMemberId !== undefined) data.targetMemberId = dto.targetMemberId;
    if (dto.submissionDeadline !== undefined) data.submissionDeadline = new Date(dto.submissionDeadline);
    if (dto.submissionMethod !== undefined) data.submissionMethod = dto.submissionMethod;
    if (dto.status === WorkflowStatus.complete) data.completedAt = new Date();

    return this.prisma.workflowInstance.update({
      where: { id },
      data,
      include: { template: true },
    });
  }

  async deleteInstance(tenantId: string, id: string) {
    await this.getInstance(tenantId, id);
    return this.prisma.workflowInstance.delete({ where: { id } });
  }

  async aiFillInstance(tenantId: string, instanceId: string, clientId: string) {
    if (!this.anthropicKey) {
      throw new ServiceUnavailableException('AI fill is not configured. Set ANTHROPIC_API_KEY.');
    }

    const instance = await this.getInstance(tenantId, instanceId);

    // Look up client — try by id first, then search by tenant to give a clear error
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId },
    });
    if (!client) {
      throw new NotFoundException(
        `Client not found. Make sure the client exists and belongs to your organization.`,
      );
    }

    // Fetch ALL client context: attachments, meetings, mail threads, engagement tasks, notes
    const [attachments, meetings, mailThreads, tasks, clioNotes, directoryNotes] =
      await Promise.all([
        this.prisma.engagementAttachment.findMany({
          where: { tenantId, clientId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.meeting.findMany({
          where: { tenantId, clientId },
          orderBy: { startsAt: 'desc' },
          take: 10,
          select: { subject: true, description: true, startsAt: true, status: true },
        }),
        this.prisma.mailThread.findMany({
          where: { tenantId, clientId },
          orderBy: { lastMessageAt: 'desc' },
          take: 10,
          select: { subject: true, snippet: true, lastMessageAt: true },
        }),
        this.prisma.engagementTask.findMany({
          where: { tenantId, clientId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { title: true, description: true, status: true, dueDate: true },
        }),
        this.prisma.clioNote.findMany({
          where: { tenantId, clientId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { title: true, body: true, createdAt: true },
        }),
        this.prisma.outreachRecord.findMany({
          where: { tenantId, clientId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { title: true, body: true, type: true, status: true },
        }),
      ]);

    const template = instance.template as Record<string, unknown> | null;
    const requiredSections = template?.requiredSections as Record<string, unknown> | null;
    const formData = (instance.formData ?? {}) as Record<string, unknown>;
    const requestType = (formData.request_type as string) ?? 'funding';

    const sections = (requiredSections as Record<string, unknown> | null)?.sections as
      | Record<string, unknown>
      | undefined;
    const typeSection = (
      requestType === 'funding' ? sections?.funding : sections?.policy
    ) as Record<string, unknown> | undefined;
    const section1 = typeSection?.section1 as Record<string, unknown> | undefined;
    const allFields = (section1?.fields ?? []) as Array<{
      key: string;
      label: string;
      type: string;
      helpText?: string;
    }>;

    const fillableFields = allFields.filter(
      (f) =>
        (f.type === 'text' || f.type === 'textarea') &&
        (formData[f.key] === undefined || formData[f.key] === null || formData[f.key] === ''),
    );

    if (fillableFields.length === 0) return { suggestions: {} };

    // Read text content from S3 attachments
    const docTexts: string[] = [];
    let totalChars = 0;
    for (const att of attachments) {
      if (totalChars >= MAX_DOC_CHARS) break;
      const isText =
        att.contentType.startsWith('text/') || att.contentType === 'application/json';
      if (!isText) continue;
      try {
        const obj = await this.s3.send(
          new GetObjectCommand({ Bucket: att.bucket, Key: att.s3Key }),
        );
        const text = await streamToString(obj.Body as AsyncIterable<Uint8Array>);
        const remaining = MAX_DOC_CHARS - totalChars;
        const snippet = text.slice(0, remaining);
        docTexts.push(`--- Document: ${att.fileName} ---\n${snippet}`);
        totalChars += snippet.length;
      } catch {
        // skip unreadable attachments
      }
    }

    const contextInfo = (template?.contextInfo ?? {}) as Record<string, unknown>;
    const intakeData = (client.intakeData ?? {}) as Record<string, unknown>;

    // Build rich client context from the full profile
    const clientContext: string[] = [
      `CLIENT NAME: ${client.name}`,
      client.website ? `WEBSITE: ${client.website}` : '',
      client.description ? `CLIENT DESCRIPTION: ${client.description}` : '',
      client.productDescription ? `PRODUCT/SERVICE DESCRIPTION: ${client.productDescription}` : '',
      client.primaryContactName ? `PRIMARY CONTACT: ${client.primaryContactName}` : '',
      client.primaryContactEmail ? `CONTACT EMAIL: ${client.primaryContactEmail}` : '',
    ].filter(Boolean);

    if (Object.keys(intakeData).length) {
      clientContext.push(`\nCLIENT PROFILE DATA:\n${JSON.stringify(intakeData, null, 2)}`);
    }

    if (meetings.length) {
      clientContext.push(
        `\nRECENT MEETINGS (${meetings.length}):\n${meetings
          .map((m) => `  - ${m.subject}${m.description ? ': ' + m.description.slice(0, 200) : ''} (${String(m.startsAt).slice(0, 10)})`)
          .join('\n')}`,
      );
    }

    if (mailThreads.length) {
      clientContext.push(
        `\nRECENT EMAIL THREADS (${mailThreads.length}):\n${mailThreads
          .map((t) => `  - ${t.subject}${t.snippet ? ': ' + t.snippet.slice(0, 150) : ''}`)
          .join('\n')}`,
      );
    }

    if (tasks.length) {
      clientContext.push(
        `\nENGAGEMENT TASKS (${tasks.length}):\n${tasks
          .map((t) => `  - [${t.status}] ${t.title}${t.description ? ': ' + t.description.slice(0, 150) : ''}`)
          .join('\n')}`,
      );
    }

    if (clioNotes.length) {
      clientContext.push(
        `\nCLIO NOTES (${clioNotes.length}):\n${clioNotes
          .map((n) => `  - ${n.title ?? 'Untitled'}: ${n.body.slice(0, 300)}`)
          .join('\n')}`,
      );
    }

    if (directoryNotes.length) {
      clientContext.push(
        `\nOUTREACH RECORDS (${directoryNotes.length}):\n${directoryNotes
          .map((r) => `  - [${r.type}/${r.status}] ${r.title}${r.body ? ': ' + r.body.slice(0, 200) : ''}`)
          .join('\n')}`,
      );
    }

    const prompt = [
      'You are a government affairs assistant helping fill out a federal lobbying request form.',
      'Based on the client information, engagement history, and documents below, suggest values for the empty form fields.',
      'Only suggest values for fields where you have clear supporting evidence from the provided context.',
      'Return ONLY valid JSON with this structure: { "suggestions": { "<fieldKey>": { "value": "<suggested text>", "reasoning": "<one sentence why>" } } }',
      '',
      `FORM TYPE: ${requestType === 'funding' ? 'Funding Request' : 'Policy / Bill Language Request'}`,
      '',
      `TEMPLATE: ${String(template?.name ?? '')}`,
      contextInfo && Object.keys(contextInfo).length
        ? `SUBMISSION CONTEXT:\n${Object.entries(contextInfo)
            .filter(([, v]) => v)
            .map(([k, v]) => `  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join('\n')}`
        : '',
      '',
      ...clientContext,
      '',
      docTexts.length
        ? `CLIENT DOCUMENTS:\n${docTexts.join('\n\n')}`
        : 'No text documents available.',
      '',
      'FIELDS TO FILL (currently empty):',
      ...fillableFields.map(
        (f) =>
          `  - key: "${f.key}", label: "${f.label}", type: "${f.type}"${f.helpText ? `, hint: "${f.helpText}"` : ''}`,
      ),
      '',
      'CURRENT FORM VALUES (already filled by user, for reference):',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(formData).filter(([, v]) => v !== null && v !== undefined && v !== ''),
        ),
        null,
        2,
      ),
    ]
      .filter((line) => line !== null && line !== undefined)
      .join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_FILL_MODEL,
        max_tokens: 2000,
        system:
          'You are a government affairs assistant. Return only valid JSON matching the requested schema. Do not invent facts not supported by the provided context.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const err = (json.error as Record<string, unknown> | undefined)?.message ?? `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`AI fill failed: ${String(err)}`);
    }

    const text = extractAnthropicText(json);
    const parsed = parseJsonSafe(text);
    return { suggestions: (parsed.suggestions as Record<string, unknown>) ?? {} };
  }
}

function extractAnthropicText(json: Record<string, unknown>): string {
  const content = Array.isArray(json.content) ? json.content : [];
  return content
    .map((part) => {
      const record = part && typeof part === 'object' && !Array.isArray(part)
        ? (part as Record<string, unknown>)
        : {};
      return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .join('\n')
    .trim();
}

function parseJsonSafe(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

async function streamToString(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
