import { Injectable, Logger } from '@nestjs/common';
import { isValidPeCode } from '../../program-element/jbook/jbook-extract.js';

/**
 * Press-release personnel NER extractor (Step 32).
 *
 * Pure orchestration around an injectable LLM call so it is fully unit-testable
 * without hitting Anthropic. The runner injects a real Claude-Sonnet call (raw
 * fetch to api.anthropic.com, the repo's house pattern — there is no src/llm/
 * client); tests inject a stub that returns canned JSON.
 *
 * Pipeline per article:
 *   1. LLM extracts {mentions:[{full_name,title,organization,programs_mentioned,role_inferred}]}.
 *   2. Validate each mention: full_name has first+last; title non-empty.
 *   3. For each programs_mentioned entry, attempt a PE-code match (regex + caller's
 *      known-PE set).
 *   4. Emit PersonRecordInput-shaped rows for the writer (source='press_release').
 */

export interface PressArticle {
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date;
}

export interface LlmMention {
  full_name?: string;
  title?: string;
  organization?: string;
  programs_mentioned?: string[];
  role_inferred?: string;
}

/** Injected LLM call: given the system+user prompt, returns parsed mentions. */
export type MentionExtractor = (article: PressArticle) => Promise<LlmMention[]>;

export interface ExtractedPerson {
  fullName: string;
  title: string;
  organization: string | null;
  role: string | null;
  programOfRecord: string | null;
  pePrimary: string | null;
  peSecondary: string[];
  sourceUrl: string;
  snippet: string;
  observedAt: Date;
  confidence: number;
}

// PE code in free text: 7 digits + service letter (canonical form, matches the rest
// of the pipeline; the spec's loose mention is normalized through isValidPeCode).
const PE_IN_TEXT = /\b([0-9]{7}[A-Z][A-Z0-9]*)\b/gi;

export const PRESS_RELEASE_SOURCE = 'press_release';
export const PRESS_RELEASE_CONFIDENCE = 0.65;

export const PRESS_NER_SYSTEM_PROMPT =
  'You extract DoD personnel mentions from press releases. Output JSON only. Never invent values.';

/** A name is valid only if it has at least a first AND last token. */
export function hasFirstAndLast(name: string): boolean {
  const cleaned = name
    .replace(/\b(Dr|Mr|Ms|Mrs|Hon|Gen|Lt|Col|Maj|Capt|Sgt|Adm|RADM|VADM|BG|MG)\.?\b/gi, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter((p) => /[A-Za-z]/.test(p));
  return parts.length >= 2;
}

@Injectable()
export class PressReleasePersonnelExtractorService {
  private readonly logger = new Logger(PressReleasePersonnelExtractorService.name);

  /**
   * Extract validated person records from one article.
   * @param extract  injected LLM mention extractor
   * @param knownPeCodes  set of valid PE codes (program_element) for attribution
   */
  async extractFromArticle(
    article: PressArticle,
    extract: MentionExtractor,
    knownPeCodes: ReadonlySet<string>,
  ): Promise<ExtractedPerson[]> {
    let mentions: LlmMention[] = [];
    try {
      mentions = await extract(article);
    } catch (err) {
      this.logger.warn(`LLM extraction failed for ${article.url}: ${String(err)}`);
      return [];
    }

    const out: ExtractedPerson[] = [];
    for (const m of mentions) {
      const fullName = (m.full_name ?? '').trim();
      const title = (m.title ?? '').trim();
      // Validation: first+last name AND non-empty title.
      if (!fullName || !hasFirstAndLast(fullName)) continue;
      if (!title) continue;

      const pes = this.matchPeCodes(m.programs_mentioned ?? [], knownPeCodes);
      out.push({
        fullName,
        title,
        organization: (m.organization ?? '').trim() || null,
        role: (m.role_inferred ?? '').trim() || null,
        programOfRecord: (m.programs_mentioned ?? []).join('; ').slice(0, 500) || null,
        pePrimary: pes[0] ?? null,
        peSecondary: pes.slice(1),
        sourceUrl: article.url,
        snippet: `${title}${m.organization ? `, ${m.organization}` : ''} — ${article.title}`.slice(0, 500),
        observedAt: article.publishedAt,
        confidence: PRESS_RELEASE_CONFIDENCE,
      });
    }
    return out;
  }

  /** Extract + validate PE codes from program mention strings against known PEs. */
  matchPeCodes(programs: string[], knownPeCodes: ReadonlySet<string>): string[] {
    const found = new Set<string>();
    for (const p of programs) {
      const matches = (p ?? '').toUpperCase().match(PE_IN_TEXT);
      if (!matches) continue;
      for (const raw of matches) {
        const code = raw.trim().toUpperCase();
        if (isValidPeCode(code) && knownPeCodes.has(code)) found.add(code);
      }
    }
    return Array.from(found);
  }

  /** Build the user-prompt payload for the LLM (schema + article text). */
  static buildUserPrompt(article: PressArticle): string {
    const schema = {
      mentions: [
        {
          full_name: 'string',
          title: 'string',
          organization: 'string',
          programs_mentioned: ['string'],
          role_inferred: 'PEO | PM | DPM | PCO | KO | COR | TD | CE | STAFFER | OTHER',
        },
      ],
    };
    const body = `${article.title}\n\n${article.summary ?? ''}`.trim();
    return `Schema:\n${JSON.stringify(schema)}\n\nArticle:\n${body}`;
  }
}
