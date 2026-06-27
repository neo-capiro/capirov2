import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCredentialService } from './ai-credential.service.js';
import { anonymizeText, type AnonymizeMap } from './anonymize.js';
import { WSC } from '../cascade/cascade.config.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GENERATION_TIMEOUT_MS = 120_000;
const MAX_TOKENS = 4096;

export interface GenerateSectionResult {
  section: string;
  content: string;
  model: string;
  usedTenantKey: boolean;
  anonymized: boolean;
  legend?: AnonymizeMap['legend'];
}

/**
 * Meri document generation (Phase 6). Runs Claude Sonnet (tenant-scoped key via
 * AiCredentialService) to draft a section or a whole document, grounded in the
 * draft's setup config + context items. Honors the draft's anonymize flag: the
 * client/office names are stripped from BOTH the prompt and the returned text.
 */
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creds: AiCredentialService,
  ) {}

  async generateSection(
    tenantId: string,
    draftId: string,
    sectionName: string,
  ): Promise<GenerateSectionResult> {
    const draft = await this.prisma.wsDraft.findFirst({
      where: { id: draftId, tenantId },
      include: { context: true },
    });
    if (!draft) throw new ServiceUnavailableException('Draft not found');

    const cred = await this.creds.resolveAnthropic(tenantId);
    if (!cred) {
      throw new ServiceUnavailableException(
        'No Anthropic credential available (tenant or global). Configure an AI key.',
      );
    }

    const cfg = draft.config as Record<string, unknown>;
    const anonymize = Boolean(cfg.anonymize);
    const client = (cfg.client as string | null) ?? draft.client;
    const offices = (cfg.offices as string[] | undefined) ?? [];

    const contextText = (draft.context ?? [])
      .map((c) => {
        const p = c.payload as Record<string, unknown>;
        return c.kind === 'free-text' ? String(p.text ?? '') : String(p.label ?? '');
      })
      .filter(Boolean)
      .join('\n- ');

    const prompt = this.buildSectionPrompt({
      product: draft.product ?? 'document',
      docTitle: draft.docTitle,
      industry: draft.industry,
      section: sectionName,
      tone: String(cfg.tone ?? 'Formal'),
      toneContext: String(cfg.toneContext ?? ''),
      committees: (cfg.committees as string[] | undefined) ?? [],
      context: contextText,
      client: anonymize ? null : client,
    });

    // Strip client/office names from the prompt when anonymizing.
    const finalPrompt = anonymize
      ? anonymizeText(prompt, { client, offices }).text
      : prompt;

    const raw = await this.callAnthropic(cred.secret, cred.model, finalPrompt);

    // Strip any client/office names the model may have echoed back.
    const result = anonymize ? anonymizeText(raw, { client, offices }) : { text: raw, map: { legend: {} } };

    return {
      section: sectionName,
      content: result.text,
      model: cred.model,
      usedTenantKey: cred.usedTenantKey,
      anonymized: anonymize,
      legend: anonymize ? result.map.legend : undefined,
    };
  }

  private buildSectionPrompt(args: {
    product: string;
    docTitle: string;
    industry: string | null;
    section: string;
    tone: string;
    toneContext: string;
    committees: string[];
    context: string;
    client: string | null;
  }): string {
    const sectionGuide = WSC.suggestedSections(args.product);
    return [
      `You are Meri, a government-affairs writing assistant. Draft the "${args.section}" section`,
      `of a ${args.product} titled "${args.docTitle}".`,
      args.industry ? `Industry/sector: ${args.industry}.` : '',
      args.client ? `Client: ${args.client}.` : 'Do not reference any specific client by name.',
      args.committees.length ? `Relevant committees: ${args.committees.join(', ')}.` : '',
      `Tone: ${args.tone}.`,
      args.toneContext ? `Strategic emphasis: ${args.toneContext}.` : '',
      `This section sits within the standard structure: ${sectionGuide.join(' → ')}.`,
      args.context ? `Ground the content in these facts:\n- ${args.context}` : '',
      '',
      `Write only the prose for the "${args.section}" section — no headers, no preamble,`,
      `no meta-commentary. Be specific, factual, and concise. Government-affairs register.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async callAnthropic(secret: string, model: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': secret,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        this.logger.warn(`Anthropic generation failed: HTTP ${res.status} ${body.error?.message ?? ''}`);
        throw new ServiceUnavailableException(
          body.error?.message ?? `Generation failed (HTTP ${res.status})`,
        );
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ServiceUnavailableException(
          `Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
