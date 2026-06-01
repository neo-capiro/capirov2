import { Injectable, Logger } from '@nestjs/common';
import { hasFirstAndLast } from './press-release-personnel-extractor.service.js';

/**
 * GAO-report interviewee personnel extractor (Step 34B).
 *
 * Pure orchestration around an injectable LLM call (Claude via raw fetch to
 * api.anthropic.com — the repo's house pattern; there is no src/llm/ client), so it is
 * fully unit-testable with a stub. Mirrors the Step 32 press-release extractor.
 *
 * IMPORTANT — text source: `gao_report` stores title + summary + topics + agencies
 * only (no full-report-text column, and the repo has no Textract integration). Per the
 * established Step 32 precedent (NER over title+summary, "yield modest by design"), the
 * LLM runs over the available metadata text. Full-PDF extraction via Textract is left as
 * a documented future seam (see buildUserPrompt / the runner) — NOT wired here, so no
 * new AWS dependency is introduced.
 *
 * Pipeline per report:
 *   1. LLM extracts {persons:[{full_name,title,organization,quote}]} from report text.
 *   2. Validate: full_name has first+last; title non-empty.
 *   3. Emit PersonRecordInput-shaped rows for the writer (source='gao_interviewee',
 *      confidence=0.55), observedAt = report publishDate (writer idempotency key).
 */

export interface GaoReportInput {
  id: string; // GAO report number, e.g. "GAO-24-106155"
  title: string;
  summary: string | null;
  url: string | null;
  publishDate: Date;
  topics: string[];
  agencies: string[];
  /** Optional full report text if a future Textract seam supplies it; falls back to metadata. */
  fullText?: string | null;
}

export interface GaoLlmPerson {
  full_name?: string;
  title?: string;
  organization?: string;
  quote?: string;
}

/** Injected LLM call: given the report, returns parsed person mentions. */
export type GaoPersonExtractor = (report: GaoReportInput) => Promise<GaoLlmPerson[]>;

export interface ExtractedGaoPerson {
  fullName: string;
  title: string;
  organization: string | null;
  sourceUrl: string | undefined;
  snippet: string;
  observedAt: Date;
  confidence: number;
}

export const GAO_INTERVIEWEE_SOURCE = 'gao_interviewee';
export const GAO_INTERVIEWEE_CONFIDENCE = 0.55;

export const GAO_NER_SYSTEM_PROMPT =
  'You extract named government personnel referenced in GAO reports (by title and ' +
  'organization). Output JSON only. Never invent names, titles, or quotes — only emit ' +
  'people explicitly named in the provided text.';

@Injectable()
export class GaoPersonnelExtractorService {
  private readonly logger = new Logger(GaoPersonnelExtractorService.name);

  /**
   * Extract validated person records from one GAO report.
   * @param extract injected LLM person extractor
   */
  async extractFromReport(report: GaoReportInput, extract: GaoPersonExtractor): Promise<ExtractedGaoPerson[]> {
    let persons: GaoLlmPerson[] = [];
    try {
      persons = await extract(report);
    } catch (err) {
      this.logger.warn(`LLM extraction failed for ${report.id}: ${String(err)}`);
      return [];
    }

    const out: ExtractedGaoPerson[] = [];
    const seen = new Set<string>();
    for (const p of persons) {
      const fullName = (p.full_name ?? '').trim();
      const title = (p.title ?? '').trim();
      // Validation: first+last name AND non-empty title (matches press extractor rules).
      if (!fullName || !hasFirstAndLast(fullName)) continue;
      if (!title) continue;

      const key = fullName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const quote = (p.quote ?? '').trim();
      const org = (p.organization ?? '').trim();
      out.push({
        fullName,
        title,
        organization: org || null,
        sourceUrl: report.url ?? undefined,
        snippet: (quote || `${title}${org ? `, ${org}` : ''} — ${report.title}`).slice(0, 500),
        observedAt: report.publishDate,
        confidence: GAO_INTERVIEWEE_CONFIDENCE,
      });
    }
    return out;
  }

  /** Build the user-prompt payload for the LLM (schema + report text). */
  static buildUserPrompt(report: GaoReportInput): string {
    const schema = {
      persons: [
        {
          full_name: 'string',
          title: 'string',
          organization: 'string',
          quote: 'string (the sentence/phrase from the text that names this person)',
        },
      ],
    };
    // Prefer full text if a future Textract seam supplied it; otherwise metadata.
    const body = (report.fullText && report.fullText.trim().length > 0)
      ? report.fullText
      : [
          report.title,
          report.summary ?? '',
          report.topics.length ? `Topics: ${report.topics.join(', ')}` : '',
          report.agencies.length ? `Agencies: ${report.agencies.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
    return `Schema:\n${JSON.stringify(schema)}\n\nGAO Report ${report.id}:\n${body}`.trim();
  }
}
