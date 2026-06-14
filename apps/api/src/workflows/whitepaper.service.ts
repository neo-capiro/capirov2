import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/config.schema.js';
import {
  asWhitePaperTone,
  composeWhitePaperDocument,
  getWhitePaperVariant,
  splitDocumentIntoSections,
  variantSections,
  whitePaperContextCategory,
  WHITEPAPER_TONE_GUIDANCE,
  WHITEPAPER_VARIANTS,
  type WhitePaperContextCategory,
  type WhitePaperContextItem,
  type WhitePaperContextKind,
  type WhitePaperSection,
  type WhitePaperTone,
  type WhitePaperVariant,
} from './whitepaper.types.js';

const AI_GEN_MODEL = 'claude-sonnet-4-6';
const AI_TIMEOUT_MS = 90_000;
/** Default per-item budget for compact items (profile rows, meetings, intel). */
const MAX_CONTEXT_ITEM_CHARS = 1_500;
/** Larger budget for long-form items (documents, research reports, prior docs). */
const MAX_DOC_CONTEXT_CHARS = 6_000;
/** Hard ceiling on the total context injected into one generation call. */
const MAX_TOTAL_CONTEXT_CHARS = 28_000;

/** Long-form kinds that get the larger per-item budget when injected. */
const LONG_FORM_KINDS = new Set<WhitePaperContextKind>([
  'document',
  'research_report',
  'prior_submission',
  'note',
  'client_brief',
  'recommendation',
]);

function clip(value: string | null | undefined, max: number): string {
  const text = (value ?? '').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Map a MIME type to a short human label for a document chip (PDF, DOCX, …). */
function shortContentType(contentType: string | null | undefined): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('pdf')) return 'PDF';
  if (ct.includes('word') || ct.includes('document')) return 'DOCX';
  if (ct.includes('sheet') || ct.includes('excel') || ct.includes('csv')) return 'Sheet';
  if (ct.startsWith('text/')) return 'Text';
  if (ct.startsWith('audio/')) return 'Audio';
  if (ct.startsWith('video/')) return 'Video';
  if (ct.startsWith('image/')) return 'Image';
  return 'Doc';
}

/**
 * Stable formData keys for the structured white paper.
 */
export const WP_KEYS = {
  sections: 'whitepaper_sections',
  tone: 'whitepaper_tone',
  steerNote: 'whitepaper_steer_note',
  contextItems: 'whitepaper_context_items',
  variant: 'whitepaper_variant',
  generatedDoc: 'generated_document',
  generatedAt: 'whitepaper_generated_at',
  showClio: 'whitepaper_show_clio',
} as const;

export interface GenerateSectionInput {
  sectionId: string;
  heading: string;
  mode?: 'draft' | 'rewrite' | 'improve';
  improveDirective?: string;
  currentBody?: string;
  instruction?: string;
  tone?: WhitePaperTone;
  steerNote?: string;
  contextItems?: WhitePaperContextItem[];
}

export interface WhitePaperContextCandidate {
  id: string;
  kind: WhitePaperContextItem['kind'];
  title: string;
  content: string;
  refId?: string;
  tag?: string;
  category?: WhitePaperContextCategory;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ServiceUnavailableException(
        `AI provider request timed out after ${AI_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractAnthropicText(json: Record<string, unknown>): string {
  const content = Array.isArray(json.content) ? json.content : [];
  return content
    .map((part) => {
      const record =
        part && typeof part === 'object' && !Array.isArray(part)
          ? (part as Record<string, unknown>)
          : {};
      return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .join('\n')
    .trim();
}

function extractOpenAiText(json: Record<string, unknown>): string {
  if (typeof json.output_text === 'string') return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const content = Array.isArray(rec.content) ? rec.content : [];
    for (const c of content) {
      const cr = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
      if (typeof cr.text === 'string') parts.push(cr.text);
    }
  }
  return parts.join('\n').trim();
}

function parseJsonSafe(text: string): Record<string, unknown> {
  const trimmed = (text ?? '').trim();
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

@Injectable()
export class WhitePaperService {
  private readonly logger = new Logger(WhitePaperService.name);
  private readonly anthropicKey?: string;
  private readonly openaiKey?: string;
  private readonly preferredProvider?: 'openai' | 'anthropic';
  private readonly openaiModel: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.anthropicKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.openaiKey = config.get('OPENAI_API_KEY', { infer: true });
    this.preferredProvider = config.get('AI_PROVIDER', { infer: true });
    this.openaiModel = config.get('OPENAI_MODEL', { infer: true });
  }

  variants(): WhitePaperVariant[] {
    return WHITEPAPER_VARIANTS;
  }

  // ─── Provider fallback wrapper (mirrors chat/engagement pattern) ──────────

  private async callWithProviderFallback<T>(
    operation: string,
    invoke: (provider: 'openai' | 'anthropic') => Promise<T>,
  ): Promise<T> {
    const providers: Array<'openai' | 'anthropic'> = [];
    const add = (p: 'openai' | 'anthropic') => {
      const has = p === 'openai' ? this.openaiKey : this.anthropicKey;
      if (has && !providers.includes(p)) providers.push(p);
    };
    if (this.preferredProvider) add(this.preferredProvider);
    add('anthropic');
    add('openai');

    if (!providers.length) {
      throw new ServiceUnavailableException(
        `${operation} is not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.`,
      );
    }

    const failures: string[] = [];
    for (const provider of providers) {
      try {
        return await invoke(provider);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'provider failed';
        failures.push(`${provider}: ${msg}`);
        if (provider !== providers[providers.length - 1]) {
          this.logger.warn(`${operation} failed with ${provider}, trying fallback: ${msg}`);
        }
      }
    }
    throw new ServiceUnavailableException(
      `${operation} failed for all providers. ${failures.join(' | ')}`,
    );
  }

  private async completeJson(
    operation: string,
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    maxTokens: number,
  ): Promise<Record<string, unknown>> {
    return this.callWithProviderFallback(operation, async (provider) => {
      if (provider === 'anthropic') {
        const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': this.anthropicKey!,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: AI_GEN_MODEL,
            max_tokens: maxTokens,
            system: `${system} Return only valid JSON.`,
            messages: [
              { role: 'user', content: `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}` },
            ],
          }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok)
          throw new ServiceUnavailableException(`Anthropic ${operation}: HTTP ${res.status}`);
        return parseJsonSafe(extractAnthropicText(json));
      }
      const res = await fetchWithTimeout('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openaiKey!}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.openaiModel,
          instructions: `${system} Return only valid JSON.`,
          input: `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}`,
          text: { format: { type: 'json_object' } },
        }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new ServiceUnavailableException(`OpenAI ${operation}: HTTP ${res.status}`);
      return parseJsonSafe(extractOpenAiText(json));
    });
  }

  // ─── Context resolution ───────────────────────────────────────────────────

  /**
   * Candidate context items for a workflow instance, scoped to its client +
   * strategy. Reuses the same client-association logic used by generation so
   * the UI offers exactly what the model can ground on.
   */
  async contextCandidates(
    tenantId: string,
    instanceId: string,
  ): Promise<WhitePaperContextCandidate[]> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: { strategy: { include: { capability: true, targets: true } } },
    });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${instanceId}' not found`);
    }

    const candidates: WhitePaperContextCandidate[] = [];
    const clientId = instance.clientId;
    const strategy = instance.strategy as {
      capability: Record<string, unknown> | null;
    } | null;

    // Each source is isolated: a failure in one (missing table, bad data) must
    // never blank the whole catalog. We log and continue so the picker is
    // resilient and always shows whatever resolved.
    const sources: Array<[string, () => Promise<void>]> = [];

    // ── Client profile ─────────────────────────────────────────────────────
    sources.push([
      'client_profile',
      async () => {
        if (!clientId) return;
        const client = await this.prisma.client.findFirst({ where: { id: clientId, tenantId } });
        if (!client) return;
        const lines = [
          client.description ? `About: ${client.description}` : '',
          client.productDescription ? `Products/services: ${client.productDescription}` : '',
          client.sectorTag ? `Sector: ${client.sectorTag}` : '',
          client.website ? `Website: ${client.website}` : '',
          client.issueCodes?.length ? `Issue codes: ${client.issueCodes.join(', ')}` : '',
          client.naicsCodes?.length ? `NAICS: ${client.naicsCodes.join(', ')}` : '',
          client.pscCodes?.length ? `PSC: ${client.pscCodes.join(', ')}` : '',
          client.uei ? `UEI: ${client.uei}` : '',
          client.cageCode ? `CAGE: ${client.cageCode}` : '',
          client.submissionTracks?.length
            ? `Submission tracks: ${client.submissionTracks.join(', ')}`
            : '',
        ].filter(Boolean);
        if (!lines.length) return;
        candidates.push({
          id: 'client-profile',
          kind: 'client_profile',
          title: `Client profile: ${client.name}`,
          content: clip(lines.join('\n'), MAX_CONTEXT_ITEM_CHARS),
          tag: 'Profile',
        });
      },
    ]);

    // ── Key people ─────────────────────────────────────────────────────────
    sources.push([
      'people',
      async () => {
        if (!clientId) return;
        const people = await this.prisma.clientPerson.findMany({
          where: { tenantId, clientId },
          orderBy: [{ lastContact: 'desc' }, { updatedAt: 'desc' }],
          take: 8,
        });
        for (const p of people) {
          const lines = [
            [p.title, p.role].filter(Boolean).join(' · '),
            p.email ? `Email: ${p.email}` : '',
            p.phone ? `Phone: ${p.phone}` : '',
            p.notes ? `Notes: ${p.notes}` : '',
          ].filter(Boolean);
          candidates.push({
            id: `person-${p.id}`,
            kind: 'person',
            refId: p.id,
            title: p.name,
            content: clip(
              `${p.name}${lines.length ? `\n${lines.join('\n')}` : ''}`,
              MAX_CONTEXT_ITEM_CHARS,
            ),
            tag: p.title || 'Contact',
          });
        }
      },
    ]);

    // ── Facilities (district nexus) ────────────────────────────────────────
    sources.push([
      'facilities',
      async () => {
        if (!clientId) return;
        const facilities = await this.prisma.clientFacility.findMany({
          where: { tenantId, clientId },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        });
        for (const f of facilities) {
          const loc = [f.city, f.state].filter(Boolean).join(', ');
          const district =
            f.state && f.congressionalDistrict ? `${f.state}-${f.congressionalDistrict}` : '';
          const lines = [
            loc ? `Location: ${loc}` : '',
            district ? `Congressional district: ${district}` : '',
            f.employeeCount ? `Employees: ${f.employeeCount.toLocaleString()}` : '',
            f.notes ? `Notes: ${f.notes}` : '',
          ].filter(Boolean);
          candidates.push({
            id: `facility-${f.id}`,
            kind: 'facility',
            refId: f.id,
            title: f.name,
            content: clip(
              `${f.name}${lines.length ? `\n${lines.join('\n')}` : ''}`,
              MAX_CONTEXT_ITEM_CHARS,
            ),
            tag: district || loc || 'Facility',
          });
        }
      },
    ]);

    // ── Capability / program + program elements ────────────────────────────
    sources.push([
      'capability',
      async () => {
        const cap = strategy?.capability;
        if (!cap) return;
        const str = (k: string) => (typeof cap[k] === 'string' ? (cap[k] as string) : '');
        const num = (k: string) => (typeof cap[k] === 'number' ? (cap[k] as number) : null);
        const fundingAsk = num('fundingAsk');
        const lines = [
          str('description') ? `Description: ${str('description')}` : '',
          str('justification') ? `Justification: ${str('justification')}` : '',
          str('districtNexus') ? `District nexus: ${str('districtNexus')}` : '',
          str('serviceBranch') ? `Service branch: ${str('serviceBranch')}` : '',
          str('appropriationAccount')
            ? `Appropriation account: ${str('appropriationAccount')}`
            : '',
          str('targetSubcommittee') ? `Target subcommittee: ${str('targetSubcommittee')}` : '',
          fundingAsk ? `Funding ask: $${fundingAsk.toLocaleString()}` : '',
          num('trl') ? `TRL: ${num('trl')}` : '',
          num('mrl') ? `MRL: ${num('mrl')}` : '',
          str('existingContracts') ? `Existing contracts: ${str('existingContracts')}` : '',
          str('notes') ? `Notes: ${str('notes')}` : '',
        ].filter(Boolean);
        if (lines.length) {
          candidates.push({
            id: 'capability',
            kind: 'capability',
            title: `Program: ${str('name') || 'Capability'}`,
            content: clip(lines.join('\n'), MAX_CONTEXT_ITEM_CHARS),
            tag: 'Capability',
          });
        }
        const peNumbers = Array.isArray(cap.peNumbers) ? (cap.peNumbers as string[]) : [];
        const pes = Array.from(new Set([str('peNumber'), ...peNumbers].filter(Boolean)));
        if (pes.length) {
          candidates.push({
            id: 'program-elements',
            kind: 'program_element',
            title: `Program elements: ${pes.slice(0, 4).join(', ')}${pes.length > 4 ? '…' : ''}`,
            content: `Relevant program element (PE) numbers: ${pes.join(', ')}.`,
            tag: 'PE',
          });
        }
      },
    ]);

    // ── Meetings ───────────────────────────────────────────────────────────
    sources.push([
      'meetings',
      async () => {
        if (!clientId) return;
        const meetings = await this.prisma.meeting.findMany({
          where: {
            AND: [
              { tenantId },
              await clientMeetingAssociationWhere(this.prisma, tenantId, clientId),
            ],
          },
          orderBy: { startsAt: 'desc' },
          take: 8,
          select: { id: true, subject: true, description: true, startsAt: true },
        });
        for (const meeting of meetings) {
          const date = meeting.startsAt.toISOString().slice(0, 10);
          const detail = meeting.description ? `: ${meeting.description}` : '';
          candidates.push({
            id: `meeting-${meeting.id}`,
            kind: 'meeting',
            refId: meeting.id,
            title: meeting.subject || `Meeting ${date}`,
            content: clip(`Meeting (${date}): ${meeting.subject}${detail}`, MAX_CONTEXT_ITEM_CHARS),
            tag: date,
          });
        }
      },
    ]);

    // ── Email threads ──────────────────────────────────────────────────────
    sources.push([
      'threads',
      async () => {
        if (!clientId) return;
        const threads = await this.prisma.mailThread.findMany({
          where: {
            AND: [
              { tenantId },
              await clientMailThreadAssociationWhere(this.prisma, tenantId, clientId),
            ],
          },
          orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
          take: 8,
          select: { id: true, subject: true, snippet: true, lastMessageAt: true },
        });
        for (const thread of threads) {
          const date = thread.lastMessageAt ? thread.lastMessageAt.toISOString().slice(0, 10) : '';
          const snippet = thread.snippet ? `: ${thread.snippet}` : '';
          candidates.push({
            id: `thread-${thread.id}`,
            kind: 'email_thread',
            refId: thread.id,
            title: thread.subject || 'Email thread',
            content: clip(
              `Email thread${date ? ` (${date})` : ''}: ${thread.subject}${snippet}`,
              MAX_CONTEXT_ITEM_CHARS,
            ),
            tag: date || 'Email',
          });
        }
      },
    ]);

    // ── Prior submissions (generated docs) ─────────────────────────────────
    sources.push([
      'prior_submissions',
      async () => {
        if (!clientId) return;
        const priorSubmissions = await this.prisma.workflowInstance.findMany({
          where: { tenantId, clientId, id: { not: instanceId } },
          orderBy: { updatedAt: 'desc' },
          take: 6,
          select: { id: true, title: true, formData: true, template: { select: { name: true } } },
        });
        for (const sub of priorSubmissions) {
          const fd = (sub.formData ?? {}) as Record<string, unknown>;
          const doc = typeof fd.generated_document === 'string' ? fd.generated_document : '';
          if (!doc.trim()) continue;
          candidates.push({
            id: `submission-${sub.id}`,
            kind: 'prior_submission',
            refId: sub.id,
            title: sub.title || sub.template?.name || 'Prior submission',
            content: clip(doc, MAX_DOC_CONTEXT_CHARS),
            tag: 'Prior doc',
          });
        }
      },
    ]);

    // ── Submission history (outcomes) ──────────────────────────────────────
    sources.push([
      'submission_history',
      async () => {
        if (!clientId) return;
        const history = await this.prisma.clientSubmissionHistory.findMany({
          where: { tenantId, clientId },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        });
        for (const h of history) {
          const lines = [
            h.outcome ? `Outcome: ${h.outcome}` : '',
            h.outcomeType ? `Status: ${h.outcomeType}` : '',
            h.notes ? `Notes: ${h.notes}` : '',
          ].filter(Boolean);
          candidates.push({
            id: `subhist-${h.id}`,
            kind: 'submission_history',
            refId: h.id,
            title: `${h.fiscalYear} · ${h.title}`,
            content: clip(
              `${h.fiscalYear} ${h.title}${lines.length ? `\n${lines.join('\n')}` : ''}`,
              MAX_CONTEXT_ITEM_CHARS,
            ),
            tag: h.outcomeType || h.fiscalYear,
          });
        }
      },
    ]);

    // ── Tracked bills ──────────────────────────────────────────────────────
    sources.push([
      'tracked_bills',
      async () => {
        if (!clientId) return;
        const bills = await this.prisma.trackedBill.findMany({
          where: { tenantId, clientId },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        });
        for (const b of bills) {
          candidates.push({
            id: `bill-${b.id}`,
            kind: 'tracked_bill',
            refId: b.billId,
            title: `Tracked: ${b.billId}`,
            content: clip(
              `Pinned bill ${b.billId}${b.note ? `\n${b.note}` : ''}`,
              MAX_CONTEXT_ITEM_CHARS,
            ),
            tag: b.billId,
          });
        }
      },
    ]);

    // ── Intel changes ──────────────────────────────────────────────────────
    sources.push([
      'intel_changes',
      async () => {
        if (!clientId) return;
        const changes = await this.prisma.intelligenceChange.findMany({
          where: { relatedClientIds: { has: clientId } },
          orderBy: { detectedAt: 'desc' },
          take: 6,
        });
        for (const c of changes) {
          candidates.push({
            id: `change-${c.id}`,
            kind: 'intel_change',
            refId: c.id,
            title: c.title,
            content: clip(
              `[${c.changeType} · ${c.severity}] ${c.title}\n${c.description}`,
              MAX_CONTEXT_ITEM_CHARS,
            ),
            tag: c.severity,
          });
        }
      },
    ]);

    // ── Client briefs ──────────────────────────────────────────────────────
    sources.push([
      'client_briefs',
      async () => {
        if (!clientId) return;
        const briefs = await this.prisma.clientBrief.findMany({
          where: { tenantId, clientId },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        });
        for (const b of briefs) {
          candidates.push({
            id: `brief-${b.id}`,
            kind: 'client_brief',
            refId: b.id,
            title: b.title,
            content: clip(`${b.title}\n${b.body}`, MAX_DOC_CONTEXT_CHARS),
            tag: b.sourceType || 'Brief',
          });
        }
      },
    ]);

    // ── Action recommendations ─────────────────────────────────────────────
    sources.push([
      'recommendations',
      async () => {
        if (!clientId) return;
        const recs = await this.prisma.actionRecommendation.findMany({
          where: { tenantId, clientId, status: { notIn: ['dismissed', 'done'] } },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
          take: 6,
        });
        for (const r of recs) {
          const lines = [
            r.whatChanged ? `What changed: ${r.whatChanged}` : '',
            r.whyItMatters ? `Why it matters: ${r.whyItMatters}` : '',
            r.recommendedAction ? `Recommended action: ${r.recommendedAction}` : '',
          ].filter(Boolean);
          candidates.push({
            id: `rec-${r.id}`,
            kind: 'recommendation',
            refId: r.id,
            title: r.issueTitle,
            content: clip(`${r.issueTitle}\n${lines.join('\n')}`, MAX_DOC_CONTEXT_CHARS),
            tag: r.actionType,
          });
        }
      },
    ]);

    // ── Research reports (Clio deep research) ──────────────────────────────
    sources.push([
      'research_reports',
      async () => {
        if (!clientId) return;
        const reports = await this.prisma.clioArtifact.findMany({
          where: { tenantId, clientId, kind: { in: ['research_report', 'deep_research'] } },
          orderBy: { createdAt: 'desc' },
          take: 6,
        });
        for (const r of reports) {
          if (!r.bodyText?.trim()) continue;
          candidates.push({
            id: `research-${r.id}`,
            kind: 'research_report',
            refId: r.id,
            title: r.title || 'Research report',
            content: clip(r.bodyText, MAX_DOC_CONTEXT_CHARS),
            tag: 'Research',
          });
        }
      },
    ]);

    // ── Clio notes ─────────────────────────────────────────────────────────
    sources.push([
      'notes',
      async () => {
        if (!clientId) return;
        const notes = await this.prisma.clioNote.findMany({
          where: { tenantId, clientId },
          orderBy: { createdAt: 'desc' },
          take: 8,
        });
        for (const n of notes) {
          if (!n.body?.trim()) continue;
          candidates.push({
            id: `note-${n.id}`,
            kind: 'note',
            refId: n.id,
            title: n.title || clip(n.body, 48) || 'Note',
            content: clip(`${n.title ? `${n.title}\n` : ''}${n.body}`, MAX_CONTEXT_ITEM_CHARS),
            tag: 'Note',
          });
        }
      },
    ]);

    // ── Lobbying (LDA) — one summary block ─────────────────────────────────
    sources.push([
      'lda',
      async () => {
        if (!clientId) return;
        const client = await this.prisma.client.findFirst({
          where: { id: clientId, tenantId },
          select: { ldaClientIds: true, name: true },
        });
        const ldaIds = client?.ldaClientIds ?? [];
        if (!ldaIds.length) return;
        const filings = await this.prisma.ldaFiling.findMany({
          where: { clientId: { in: ldaIds } },
          orderBy: [{ filingYear: 'desc' }, { dtPosted: 'desc' }],
          take: 16,
        });
        if (!filings.length) return;
        const byYear = new Map<number, number>();
        const registrants = new Set<string>();
        const issues = new Set<string>();
        for (const f of filings) {
          const amt = Number(f.income ?? f.expenses ?? 0);
          byYear.set(
            f.filingYear,
            (byYear.get(f.filingYear) ?? 0) + (Number.isFinite(amt) ? amt : 0),
          );
          if (f.registrantName) registrants.add(f.registrantName);
          for (const code of f.issueCodes ?? []) issues.add(code);
        }
        const yearLines = Array.from(byYear.entries())
          .sort((a, b) => b[0] - a[0])
          .slice(0, 5)
          .map(([year, total]) => `FY${year}: $${Math.round(total).toLocaleString()}`);
        const lines = [
          `Federal lobbying disclosures (LDA) for ${client?.name ?? 'this client'}:`,
          yearLines.length ? `Spend by year — ${yearLines.join('; ')}` : '',
          registrants.size ? `Registrants: ${Array.from(registrants).slice(0, 6).join(', ')}` : '',
          issues.size ? `Issue codes: ${Array.from(issues).slice(0, 12).join(', ')}` : '',
        ].filter(Boolean);
        candidates.push({
          id: 'lda-summary',
          kind: 'lda',
          title: 'Lobbying disclosures (LDA)',
          content: clip(lines.join('\n'), MAX_CONTEXT_ITEM_CHARS),
          tag: 'LDA',
        });
      },
    ]);

    // ── Documents (uploaded attachments) ───────────────────────────────────
    sources.push([
      'documents',
      async () => {
        if (!clientId) return;
        const docs = await this.prisma.engagementAttachment.findMany({
          where: { tenantId, clientId },
          orderBy: { createdAt: 'desc' },
          take: 24,
        });
        for (const d of docs) {
          candidates.push({
            id: `doc-${d.id}`,
            kind: 'document',
            // refId is the attachment id; the editor resolves extracted text on
            // demand via POST /api/engagement/attachments/:id/extract-text.
            refId: d.id,
            title: d.fileName,
            content: '',
            tag: shortContentType(d.contentType),
          });
        }
      },
    ]);

    const settled = await Promise.allSettled(sources.map(([, run]) => run()));
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        const label = sources[index]?.[0] ?? 'unknown';
        this.logger.warn(
          `contextCandidates: source "${label}" failed: ${
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          }`,
        );
      }
    });

    // Backfill the category from the kind so the editor can group candidates.
    return candidates.map((c) => ({
      ...c,
      category: c.category ?? whitePaperContextCategory(c.kind),
    }));
  }

  /**
   * Re-resolve attached context items to fresh content where they reference
   * server-backed records; fall back to the stored content (e.g. freeform).
   */
  private async resolveContextBlocks(
    tenantId: string,
    instanceId: string,
    items: WhitePaperContextItem[],
  ): Promise<string[]> {
    if (!items.length) return [];
    const blocks: string[] = [];
    let total = 0;
    for (const item of items) {
      if (total >= MAX_TOTAL_CONTEXT_CHARS) break;
      const label = item.kind.replace(/_/g, ' ').toUpperCase();
      const perItem = LONG_FORM_KINDS.has(item.kind)
        ? MAX_DOC_CONTEXT_CHARS
        : MAX_CONTEXT_ITEM_CHARS;
      const budget = Math.min(perItem, MAX_TOTAL_CONTEXT_CHARS - total);
      const content = (item.content ?? '').trim();
      let block: string;
      if (content) {
        block = `${label} — ${item.title}:\n${clip(content, budget)}`;
      } else if (item.title) {
        block = `${label}: ${item.title}`;
      } else {
        continue;
      }
      blocks.push(block);
      total += block.length;
    }
    return blocks;
  }

  // ─── Shared strategy/client context block builder ─────────────────────────

  private async buildBaseContext(tenantId: string, instanceId: string) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: {
        template: true,
        strategy: { include: { capability: true, targets: true } },
      },
    });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${instanceId}' not found`);
    }

    const client = instance.clientId
      ? await this.prisma.client.findUnique({ where: { id: instance.clientId } })
      : null;

    const strategy = instance.strategy as {
      name: string;
      fiscalYear: string | null;
      targets: Array<{ memberName: string; committee: string | null }>;
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

    const blocks: string[] = [];
    if (client) {
      blocks.push(`CLIENT: ${client.name}`);
      if (client.description) blocks.push(`CLIENT DESCRIPTION: ${client.description}`);
      if (client.productDescription) blocks.push(`PRODUCT/SERVICE: ${client.productDescription}`);
    }
    if (strategy?.capability) {
      const cap = strategy.capability;
      blocks.push(`PROGRAM: ${cap.name}`);
      if (cap.peNumber) blocks.push(`PE NUMBER: ${cap.peNumber}`);
      if (cap.appropriationAccount)
        blocks.push(`APPROPRIATION ACCOUNT: ${cap.appropriationAccount}`);
      if (cap.fundingAsk) blocks.push(`FUNDING ASK: $${cap.fundingAsk.toLocaleString()}`);
      if (cap.description) blocks.push(`CAPABILITY DESCRIPTION: ${cap.description}`);
      if (cap.justification) blocks.push(`JUSTIFICATION: ${cap.justification}`);
      if (cap.districtNexus) blocks.push(`DISTRICT NEXUS: ${cap.districtNexus}`);
      if (cap.trl) blocks.push(`TECHNOLOGY READINESS LEVEL (TRL): ${cap.trl}`);
    }
    if (strategy?.targets?.length) {
      blocks.push(
        `TARGET MEMBERS: ${strategy.targets
          .map((t) => `${t.memberName}${t.committee ? ` (${t.committee})` : ''}`)
          .join(', ')}`,
      );
    }
    if (strategy?.name) blocks.push(`STRATEGY: ${strategy.name}`);
    if (strategy?.fiscalYear) blocks.push(`FISCAL YEAR: ${strategy.fiscalYear}`);

    return {
      instance,
      client,
      strategy,
      blocks,
      clientName: client?.name ?? 'the client',
      capabilityName: strategy?.capability?.name ?? 'the program',
      fiscalYear: strategy?.fiscalYear ?? '',
    };
  }

  private toneSteerLines(
    tone: WhitePaperTone | undefined,
    steerNote: string | undefined,
  ): string[] {
    const lines: string[] = [];
    const resolvedTone = asWhitePaperTone(tone);
    lines.push(`TONE DIRECTIVE: ${WHITEPAPER_TONE_GUIDANCE[resolvedTone]}`);
    if (steerNote && steerNote.trim()) {
      lines.push(`STEER NOTE (follow closely): ${steerNote.trim()}`);
    }
    return lines;
  }

  private readonly guardrail = [
    'Use ONLY the information provided in the context. Do not invent facts, names, dollar amounts, dates, or endorsements.',
    'Never leave bracket placeholders such as [Program Name] or [Fiscal Year]; if a fact is missing, omit it or write a neutral phrase, never a placeholder token.',
    'Write in formal professional English appropriate for congressional correspondence.',
  ];

  // ─── Full structured draft ─────────────────────────────────────────────────

  async generateStructuredDocument(
    tenantId: string,
    instanceId: string,
    opts: {
      variantSlug?: string;
      tone?: WhitePaperTone;
      steerNote?: string;
      contextItems?: WhitePaperContextItem[];
    },
  ): Promise<{ sections: WhitePaperSection[]; generated_document: string; variant: string }> {
    const base = await this.buildBaseContext(tenantId, instanceId);
    const variant = getWhitePaperVariant(
      opts.variantSlug ??
        (typeof (base.instance.formData as Record<string, unknown> | null)?.[WP_KEYS.variant] ===
        'string'
          ? ((base.instance.formData as Record<string, unknown>)[WP_KEYS.variant] as string)
          : null),
    );
    const tone = asWhitePaperTone(opts.tone ?? getWhitePaperVariant(variant.slug).defaultTone);

    const contextBlocks = [
      ...base.blocks,
      ...(await this.resolveContextBlocks(tenantId, instanceId, opts.contextItems ?? [])),
    ];

    const sectionSpec = variant.sections
      .map((section, index) => `${index + 1}. ${section.heading} — ${section.purpose}`)
      .join('\n');

    const prompt = [
      `Generate a "${variant.name}" for congressional submission as structured JSON.`,
      `Target length: about ${variant.wordBudget} words total across all sections.`,
      '',
      'Produce exactly these sections, in order, each with the given heading and a focused body:',
      sectionSpec,
      '',
      ...this.toneSteerLines(tone, opts.steerNote),
      '',
      ...this.guardrail,
      '',
      'Return JSON: { "sections": [ { "heading": string, "body": string } ] }.',
      'Each body is plain prose (no markdown headers). Keep bodies concise and decision-ready.',
      '',
      'CONTEXT:',
      ...contextBlocks,
    ].join('\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['sections'],
      properties: {
        sections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['heading', 'body'],
            properties: { heading: { type: 'string' }, body: { type: 'string' } },
          },
        },
      },
    };

    const result = await this.completeJson(
      'white paper generation',
      'You are an expert government affairs writer specializing in congressional advocacy documents.',
      prompt,
      schema,
      4000,
    );

    let sections = this.coerceSections(result.sections, variant);
    if (!sections.length) {
      sections = variantSections(variant.slug);
    }

    const generated_document = composeWhitePaperDocument(sections);
    await this.persist(tenantId, instanceId, {
      [WP_KEYS.sections]: sections,
      [WP_KEYS.variant]: variant.slug,
      [WP_KEYS.tone]: tone,
      [WP_KEYS.generatedDoc]: generated_document,
      [WP_KEYS.generatedAt]: new Date().toISOString(),
    });

    return { sections, generated_document, variant: variant.slug };
  }

  private coerceSections(raw: unknown, variant: WhitePaperVariant): WhitePaperSection[] {
    if (!Array.isArray(raw)) return [];
    const sections = raw
      .map((item, index) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const heading =
          typeof row.heading === 'string' && row.heading.trim()
            ? row.heading.trim()
            : (variant.sections[index]?.heading ?? `Section ${index + 1}`);
        const body = typeof row.body === 'string' ? row.body.trim() : '';
        return {
          id: `sec-${index + 1}`,
          heading,
          body,
          status: (body.length > 0 ? 'drafted' : 'empty') as WhitePaperSection['status'],
        };
      })
      .filter((section) => section.heading.length > 0);
    return sections;
  }

  // ─── Single section draft / rewrite / improve ──────────────────────────────

  async generateSection(
    tenantId: string,
    instanceId: string,
    input: GenerateSectionInput,
  ): Promise<{ sectionId: string; heading: string; body: string }> {
    const base = await this.buildBaseContext(tenantId, instanceId);
    const tone = asWhitePaperTone(input.tone);
    const mode = input.mode ?? 'draft';

    const contextBlocks = [
      ...base.blocks,
      ...(await this.resolveContextBlocks(tenantId, instanceId, input.contextItems ?? [])),
    ];

    const action =
      mode === 'rewrite'
        ? `Rewrite the "${input.heading}" section, improving clarity and persuasiveness while preserving accurate facts.`
        : mode === 'improve'
          ? `Improve the "${input.heading}" section per this directive: ${input.improveDirective || input.instruction || 'tighten and sharpen'}.`
          : `Write the "${input.heading}" section of a congressional white paper.`;

    const prompt = [
      action,
      input.instruction ? `Additional instruction: ${input.instruction}` : '',
      mode !== 'draft' && input.currentBody ? `CURRENT SECTION TEXT:\n${input.currentBody}` : '',
      '',
      ...this.toneSteerLines(tone, input.steerNote),
      '',
      ...this.guardrail,
      'Return JSON: { "body": string }. Body is plain prose for this one section only (no heading line, no markdown header).',
      '',
      'CONTEXT:',
      ...contextBlocks,
    ]
      .filter(Boolean)
      .join('\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['body'],
      properties: { body: { type: 'string' } },
    };

    const result = await this.completeJson(
      'white paper section',
      'You are an expert government affairs writer specializing in congressional advocacy documents.',
      prompt,
      schema,
      1500,
    );

    const body = typeof result.body === 'string' ? result.body.trim() : '';
    return { sectionId: input.sectionId, heading: input.heading, body };
  }

  // ─── Lint pass ──────────────────────────────────────────────────────────────

  lintSections(
    sections: WhitePaperSection[],
    variantSlug: string | null | undefined,
  ): { issues: string[]; wordCount: number; wordBudget: number } {
    const variant = getWhitePaperVariant(variantSlug);
    const issues: string[] = [];
    const fullText = composeWhitePaperDocument(sections);
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    if (/\[[A-Za-z][^\]]*\]/.test(fullText)) {
      issues.push(
        'Bracket placeholder(s) remain in the text (e.g. [Program Name]). Replace or remove.',
      );
    }
    const empty = sections.filter((s) => s.body.trim().length === 0);
    if (empty.length) {
      issues.push(
        `${empty.length} section${empty.length === 1 ? '' : 's'} still empty: ${empty.map((s) => s.heading).join(', ')}.`,
      );
    }
    const hasAsk = sections.some((s) =>
      /the ask|request|requesting/i.test(`${s.heading} ${s.body}`),
    );
    if (!hasAsk) issues.push('No explicit "Ask" detected. State exactly what you are requesting.');
    if (wordCount > variant.wordBudget * 1.25) {
      issues.push(
        `Length ${wordCount} words exceeds the ~${variant.wordBudget}-word budget for this format.`,
      );
    }
    return { issues, wordCount, wordBudget: variant.wordBudget };
  }

  // ─── Persistence helper (merges into formData) ──────────────────────────────

  async persist(tenantId: string, instanceId: string, patch: Record<string, unknown>) {
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${instanceId}' not found`);
    }
    const formData = { ...((instance.formData ?? {}) as Record<string, unknown>), ...patch };
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { formData: formData as Prisma.InputJsonValue },
    });
    return formData;
  }

  // ─── Real DOCX export (OOXML) ───────────────────────────────────────────────

  async exportDocx(
    tenantId: string,
    instanceId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const base = await this.buildBaseContext(tenantId, instanceId);
    const { sections, variantSlug } = await this.readSections(tenantId, instanceId);
    const variant = getWhitePaperVariant(variantSlug);
    const title =
      (typeof base.instance.title === 'string' && base.instance.title.trim()) || variant.name;

    // Lazy import keeps docx out of the hot path for non-export requests.
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
      await import('docx');

    const metaLine = [
      base.clientName,
      base.capabilityName,
      base.fiscalYear ? `FY${base.fiscalYear.replace(/^FY/i, '')}` : '',
    ]
      .filter(Boolean)
      .join('  \u2022  ');

    const children: InstanceType<typeof Paragraph>[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: title, bold: true, size: 32 })],
      }),
    ];
    if (metaLine) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: metaLine, italics: true, size: 20, color: '666666' })],
        }),
      );
    }

    for (const section of sections) {
      if (!section.heading && !section.body.trim()) continue;
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 80 },
          children: [new TextRun({ text: section.heading, bold: true })],
        }),
      );
      const paragraphs = section.body.split(/\n{2,}/).filter((p) => p.trim());
      if (!paragraphs.length && section.body.trim()) paragraphs.push(section.body.trim());
      for (const para of paragraphs) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: para
              .split(/\n/)
              .map((line, idx) =>
                idx === 0 ? new TextRun({ text: line }) : new TextRun({ text: line, break: 1 }),
              ),
          }),
        );
      }
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    const safe =
      title
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/-+/g, '-')
        .toLowerCase() || 'white-paper';
    return { buffer: Buffer.from(buffer), filename: `${safe}.docx` };
  }

  /**
   * Read current structured sections from an instance (used by Clio write-back).
   */
  async readSections(
    tenantId: string,
    instanceId: string,
  ): Promise<{
    sections: WhitePaperSection[];
    variantSlug: string;
    tone: WhitePaperTone;
    steerNote: string;
  }> {
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundException(`Workflow instance '${instanceId}' not found`);
    }
    const fd = (instance.formData ?? {}) as Record<string, unknown>;
    const variantSlug =
      typeof fd[WP_KEYS.variant] === 'string'
        ? (fd[WP_KEYS.variant] as string)
        : getWhitePaperVariant(null).slug;
    const variant = getWhitePaperVariant(variantSlug);
    let sections: WhitePaperSection[] = [];
    if (Array.isArray(fd[WP_KEYS.sections])) {
      sections = this.coerceSections(fd[WP_KEYS.sections], variant);
    }
    if (!sections.length) {
      const doc =
        typeof fd[WP_KEYS.generatedDoc] === 'string' ? (fd[WP_KEYS.generatedDoc] as string) : '';
      sections = doc.trim()
        ? splitDocumentIntoSections(
            doc,
            variant.sections.map((s) => s.heading),
          )
        : variantSections(variant.slug);
    }
    return {
      sections,
      variantSlug,
      tone: asWhitePaperTone(fd[WP_KEYS.tone]),
      steerNote: typeof fd[WP_KEYS.steerNote] === 'string' ? (fd[WP_KEYS.steerNote] as string) : '',
    };
  }
}

// ─── Client association helpers (shared shape with workflows.service) ─────────

async function clientMeetingAssociationWhere(
  prisma: PrismaService,
  tenantId: string,
  clientId: string,
): Promise<Prisma.MeetingWhereInput> {
  const emails = await clientProfileEmails(prisma, tenantId, clientId);
  const or: Prisma.MeetingWhereInput[] = [{ clientId }];
  if (emails.length) {
    or.push({ organizerEmail: { in: emails } }, { attendees: { some: { email: { in: emails } } } });
  }
  return { OR: or };
}

async function clientMailThreadAssociationWhere(
  prisma: PrismaService,
  tenantId: string,
  clientId: string,
): Promise<Prisma.MailThreadWhereInput> {
  const emails = await clientProfileEmails(prisma, tenantId, clientId);
  const or: Prisma.MailThreadWhereInput[] = [{ clientId }];
  if (emails.length) {
    or.push({ messages: { some: { fromEmail: { in: emails } } } });
  }
  return { OR: or };
}

async function clientProfileEmails(
  prisma: PrismaService,
  tenantId: string,
  clientId: string,
): Promise<string[]> {
  const [client, people] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, tenantId },
      select: { primaryContactEmail: true },
    }),
    prisma.clientPerson.findMany({
      where: { tenantId, clientId, email: { not: null } },
      select: { email: true },
    }),
  ]);
  return Array.from(
    new Set(
      [
        client?.primaryContactEmail?.trim().toLowerCase() ?? null,
        ...people.map((person) => person.email?.trim().toLowerCase() ?? null),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}
