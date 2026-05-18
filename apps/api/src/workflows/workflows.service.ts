import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { WorkflowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/config.schema.js';
import type { CreateWorkflowInstanceDto } from './dto/create-workflow-instance.dto.js';
import type { UpdateWorkflowInstanceDto } from './dto/update-workflow-instance.dto.js';

const AI_FILL_MODEL = 'claude-haiku-4-5-20251001';
const AI_GEN_MODEL = 'claude-sonnet-4-6';
const MAX_DOC_CHARS = 10_000;

const SUPPORTING_DOC_SLUGS = new Set([
  'program-white-paper',
  'meeting-request-letter',
  'leave-behind-talking-points',
  'follow-up-letter',
]);

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
      options?: string[];
      maxLength?: number;
    }>;

    // Fill ALL empty fields — text, textarea, integer, select, and boolean
    const fillableFields = allFields.filter(
      (f) =>
        formData[f.key] === undefined || formData[f.key] === null || formData[f.key] === '',
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
      'You are a government affairs assistant helping fill out a federal NDAA authorization request form.',
      'You MUST fill in as many fields as possible using the client information, profile data, engagement history, and documents provided below.',
      'Use the client profile data aggressively — if the client has a funding ask, PE number, program description, sector, or any relevant data, USE IT to fill the corresponding fields.',
      'For integer fields (dollar amounts), return the numeric value as a string with no commas, decimals, or symbols (e.g. "5000000" not "$5,000,000").',
      'For select fields, return EXACTLY one of the valid options listed.',
      'For boolean fields, return "true" or "false".',
      'For text/textarea fields, provide concise, professional text appropriate for a congressional submission.',
      'Return ONLY valid JSON: { "suggestions": { "<fieldKey>": { "value": "<suggested value>", "reasoning": "<one sentence why>" } } }',
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
      'FIELDS TO FILL (currently empty — fill as many as you can):',
      ...fillableFields.map(
        (f) => {
          let desc = `  - key: "${f.key}", label: "${f.label}", type: "${f.type}"`;
          if (f.options?.length) desc += `, VALID OPTIONS: [${f.options.map(o => `"${o}"`).join(', ')}]`;
          if (f.maxLength) desc += `, max ${f.maxLength} chars`;
          if (f.helpText) desc += `, hint: "${f.helpText}"`;
          return desc;
        },
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
        max_tokens: 4000,
        system:
          'You are an expert government affairs assistant specializing in NDAA authorization requests. Fill in as many form fields as possible using the provided client data, documents, and engagement history. Be thorough — if you can reasonably infer a value from the context, include it. For dollar amounts use plain integers. For selects pick the best matching option. Return only valid JSON.',
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

  async generateDocument(tenantId: string, instanceId: string) {
    if (!this.anthropicKey) {
      throw new ServiceUnavailableException('AI document generation is not configured. Set ANTHROPIC_API_KEY.');
    }

    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: {
        template: true,
        strategy: {
          include: {
            capability: true,
            targets: true,
            instances: { include: { template: true } },
          },
        },
      },
    });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${instanceId}' not found`);
    }

    const templateSlug = instance.template?.slug ?? '';
    if (!SUPPORTING_DOC_SLUGS.has(templateSlug)) {
      throw new ServiceUnavailableException(
        `generateDocument is only available for supporting document templates`,
      );
    }

    const client = instance.clientId
      ? await this.prisma.client.findUnique({ where: { id: instance.clientId } })
      : null;

    const strategy = instance.strategy as {
      name: string;
      fiscalYear: string | null;
      targets: Array<{ memberName: string; committee: string | null; subcommittee: string | null }>;
      instances: Array<{ template: { slug: string; name: string } | null; formData: unknown }>;
      capability: {
        name: string;
        peNumber: string | null;
        appropriationAccount: string | null;
        fundingAsk: number | null;
        justification: string | null;
        districtNexus: string | null;
        description: string | null;
        trl: number | null;
      } | null;
    } | null;

    // Pull sibling submission form data for context (e.g., NDAA fields)
    const siblingData: Record<string, unknown> = {};
    if (strategy?.instances) {
      for (const sib of strategy.instances) {
        if (sib.template?.slug && sib.template.slug !== templateSlug) {
          const slugKey = sib.template.slug.replace(/-/g, '_');
          siblingData[slugKey] = sib.formData;
        }
      }
    }

    const contextBlocks: string[] = [];

    if (client) {
      contextBlocks.push(`CLIENT: ${client.name}`);
      if (client.description) contextBlocks.push(`CLIENT DESCRIPTION: ${client.description}`);
      if (client.productDescription) contextBlocks.push(`PRODUCT/SERVICE: ${client.productDescription}`);
    }

    if (strategy?.capability) {
      const cap = strategy.capability;
      contextBlocks.push(`PROGRAM: ${cap.name}`);
      if (cap.peNumber) contextBlocks.push(`PE NUMBER: ${cap.peNumber}`);
      if (cap.appropriationAccount) contextBlocks.push(`APPROPRIATION ACCOUNT: ${cap.appropriationAccount}`);
      if (cap.fundingAsk) contextBlocks.push(`FUNDING ASK: $${cap.fundingAsk.toLocaleString()}`);
      if (cap.description) contextBlocks.push(`CAPABILITY DESCRIPTION: ${cap.description}`);
      if (cap.justification) contextBlocks.push(`JUSTIFICATION: ${cap.justification}`);
      if (cap.districtNexus) contextBlocks.push(`DISTRICT NEXUS: ${cap.districtNexus}`);
      if (cap.trl) contextBlocks.push(`TECHNOLOGY READINESS LEVEL (TRL): ${cap.trl}`);
    }

    if (strategy?.targets?.length) {
      const targetNames = strategy.targets
        .map((t) => `${t.memberName}${t.committee ? ' (' + t.committee + ')' : ''}`)
        .join(', ');
      contextBlocks.push(`TARGET MEMBERS: ${targetNames}`);
    }

    if (strategy?.name) contextBlocks.push(`STRATEGY: ${strategy.name}`);
    if (strategy?.fiscalYear) contextBlocks.push(`FISCAL YEAR: ${strategy.fiscalYear}`);

    if (Object.keys(siblingData).length) {
      contextBlocks.push(`RELATED SUBMISSION DATA:\n${JSON.stringify(siblingData, null, 2)}`);
    }

    const existingFormData = (instance.formData ?? {}) as Record<string, unknown>;
    if (Object.keys(existingFormData).length > 1) {
      contextBlocks.push(`CURRENT FORM DATA:\n${JSON.stringify(existingFormData, null, 2)}`);
    }

    const templatePrompts: Record<string, string> = {
      'program-white-paper': `Generate a 1-2 page program white paper for congressional submission.
Format as a professional document with these sections:
PROGRAM WHITE PAPER — [Program Name]
[Fiscal Year] Authorization/Appropriations Request

Problem Statement: The specific capability gap or national security need being addressed.
Solution: What this program does and how it solves the problem.
Current Status: Development stage, TRL level, milestones achieved to date, contracts or government endorsements.
Funding History and Request: FY25 enacted / FY26 enacted / FY27 requested amounts with brief context.
National Security Impact: Why this capability matters strategically.
Economic Impact: Jobs, districts supported, small business participation.
District/State Connection: How this program connects to the Member's state or district.

Use formal, concise prose. No bullet points — use short paragraphs. Length: 400-600 words.`,

      'meeting-request-letter': `Generate a formal meeting request letter to a Member of Congress or their staff.
Format as a proper business letter with:
- Date: [Current date]
- Recipient: The Honorable [Name], [Title]
- Re: Request for Meeting — [Program/Topic]
- Opening: Who you are, what organization you represent, and the specific ask for a meeting.
- Body (2-3 short paragraphs): Context for the meeting, what you'd like to discuss, why it's relevant to the Member's portfolio.
- Closing: Flexible availability, offer to provide materials in advance, direct contact for scheduling.
- Signature block: [Lobbyist/Firm name]

Tone: professional, respectful, concise. Keep to one page (250-350 words).`,

      'leave-behind-talking-points': `Generate a leave-behind document for a congressional meeting.
Format as a single-page document:
[CLIENT NAME] | [PROGRAM NAME]
FY[Year] [Authorization/Appropriations] Request

THE ASK (bold, top of page):
One sentence stating exactly what you're requesting.

KEY POINTS (3-5 bullets):
- Each bullet = one compelling supporting argument
- Lead with the strongest point
- Include data/numbers where possible

DISTRICT/STATE IMPACT:
Brief statement on jobs, facilities, or economic activity in the Member's state/district.

FUNDING CONTEXT:
FY25 enacted: $X | FY26 enacted: $X | FY27 requested: $X [above/at/below PBR]

CONTACT: [Client POC name, title, email]

Keep it scannable. No walls of text. Total: 200-300 words.`,

      'follow-up-letter': `Generate a post-meeting follow-up thank-you letter.
Format as a formal business letter:
- Date: [Date of follow-up, typically 1-2 days after meeting]
- Recipient: [Staff member(s) who attended]
- Re: Follow-Up — Meeting on [Program/Topic]
- Thank you paragraph: Thank them for their time, reference the specific meeting.
- Summary paragraph: Brief recap of what was discussed — the ask, any feedback received, key points of agreement.
- Next steps paragraph: Restate the specific request, remind of any upcoming deadlines, offer to provide additional materials.
- Materials paragraph (if applicable): Reference any follow-up materials being enclosed/attached.
- Closing: Express continued availability, look forward to the Member's support.

Tone: warm but professional. One page (250-350 words).`,
    };

    const typePrompt = templatePrompts[templateSlug] ?? 'Generate a professional congressional advocacy document based on the provided context.';

    const prompt = [
      typePrompt,
      '',
      'Use ONLY the information provided below. Do not invent facts, names, dollar amounts, or dates that are not in the context.',
      'Write in formal professional English appropriate for congressional correspondence.',
      '',
      'CONTEXT:',
      ...contextBlocks,
    ].join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_GEN_MODEL,
        max_tokens: 2000,
        system: 'You are an expert government affairs writer specializing in congressional advocacy documents. Generate professional, accurate documents using only the provided context. Never invent facts.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const err = (json.error as Record<string, unknown> | undefined)?.message ?? `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`Document generation failed: ${String(err)}`);
    }

    const generatedText = extractAnthropicText(json);

    // Save generated document into formData
    const updatedFormData = {
      ...(existingFormData),
      generated_document: generatedText,
    };

    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { formData: updatedFormData },
    });

    return { generated_document: generatedText };
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
