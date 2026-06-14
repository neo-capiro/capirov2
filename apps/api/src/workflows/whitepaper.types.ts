/**
 * White Paper structured authoring: section model, template variants, tone,
 * and context-item shapes. Shared by the workflows service (generation),
 * the chat service (Clio agentic write-back), and the web editor.
 *
 * The structured paper lives inside WorkflowInstance.formData under stable
 * keys (additive — no Prisma migration). `generated_document` remains the
 * flattened plain-text mirror for backward compatibility (dashboard,
 * legacy consumers).
 */

export type WhitePaperTone =
  | 'professional_neutral'
  | 'editorial_narrative'
  | 'technical_dense'
  | 'conversational_plain';

export type WhitePaperSectionStatus = 'empty' | 'drafted' | 'reviewed';

export interface WhitePaperSection {
  id: string;
  heading: string;
  body: string;
  status?: WhitePaperSectionStatus;
}

export type WhitePaperContextKind =
  // Client profile
  | 'client_profile'
  | 'person'
  | 'facility'
  // Program
  | 'capability'
  | 'program_element'
  // Engagement
  | 'meeting'
  | 'email_thread'
  | 'prior_submission'
  | 'submission_history'
  // Intelligence
  | 'tracked_bill'
  | 'intel_change'
  | 'client_brief'
  | 'recommendation'
  | 'intel'
  // Research
  | 'research_report'
  | 'note'
  | 'research'
  // Federal data
  | 'lda'
  | 'contract'
  // Documents
  | 'document'
  // Custom
  | 'freeform_note';

/**
 * High-level grouping the editor uses to organize the context catalog into
 * collapsible sections (Client profile / Program / Engagement / Intelligence /
 * Research / Federal data / Documents / Custom notes).
 */
export type WhitePaperContextCategory =
  | 'profile'
  | 'program'
  | 'engagement'
  | 'intel'
  | 'research'
  | 'federal'
  | 'documents'
  | 'custom';

/**
 * Per-kind display label + the category it belongs to. Keep this in sync with
 * the mirrored copy in the web editor (WhitePaperEditorPage.tsx) — the wire
 * shape is shared but the two packages can't import across the API/web boundary.
 */
export const WHITEPAPER_CONTEXT_KIND_META: Record<
  WhitePaperContextKind,
  { label: string; category: WhitePaperContextCategory }
> = {
  client_profile: { label: 'Client profile', category: 'profile' },
  person: { label: 'Key contact', category: 'profile' },
  facility: { label: 'Facility / district', category: 'profile' },
  capability: { label: 'Program / capability', category: 'program' },
  program_element: { label: 'Program element', category: 'program' },
  meeting: { label: 'Meeting', category: 'engagement' },
  email_thread: { label: 'Email', category: 'engagement' },
  prior_submission: { label: 'Prior submission', category: 'engagement' },
  submission_history: { label: 'Submission outcome', category: 'engagement' },
  tracked_bill: { label: 'Tracked bill', category: 'intel' },
  intel_change: { label: 'Intel change', category: 'intel' },
  client_brief: { label: 'Client brief', category: 'intel' },
  recommendation: { label: 'Recommendation', category: 'intel' },
  intel: { label: 'Intel', category: 'intel' },
  research_report: { label: 'Research report', category: 'research' },
  note: { label: 'Note', category: 'research' },
  research: { label: 'Research', category: 'research' },
  lda: { label: 'Lobbying (LDA)', category: 'federal' },
  contract: { label: 'Federal contract', category: 'federal' },
  document: { label: 'Document', category: 'documents' },
  freeform_note: { label: 'Note', category: 'custom' },
};

export const WHITEPAPER_CONTEXT_CATEGORY_LABELS: Record<WhitePaperContextCategory, string> = {
  profile: 'Client profile',
  program: 'Program',
  engagement: 'Engagement',
  intel: 'Intelligence',
  research: 'Research',
  federal: 'Federal data',
  documents: 'Documents',
  custom: 'Custom notes',
};

export function whitePaperContextCategory(kind: WhitePaperContextKind): WhitePaperContextCategory {
  return WHITEPAPER_CONTEXT_KIND_META[kind]?.category ?? 'custom';
}

/**
 * A resolved context item the user attached to ground/steer generation.
 * `content` is the text actually injected into the prompt. `refId` ties
 * server-backed items (meeting id, thread id, etc.) so candidates can be
 * re-resolved fresh at generation time.
 */
export interface WhitePaperContextItem {
  id: string;
  kind: WhitePaperContextKind;
  title: string;
  content: string;
  refId?: string;
  tag?: string;
  category?: WhitePaperContextCategory;
}

export interface WhitePaperVariant {
  slug: string;
  name: string;
  description: string;
  defaultTone: WhitePaperTone;
  /** Soft word budget for the whole paper; used for guidance + lint. */
  wordBudget: number;
  sections: Array<{ heading: string; purpose: string }>;
}

export const WHITEPAPER_TONE_GUIDANCE: Record<WhitePaperTone, string> = {
  professional_neutral:
    'Use concise, neutral, decision-ready language with clear claims and no rhetorical filler.',
  editorial_narrative:
    'Use a concise narrative arc: operating context, risk, action, and expected gain.',
  technical_dense:
    'Use dense technical framing, explicit assumptions, and quantifiable statements.',
  conversational_plain:
    'Use plain-language brief style while preserving precision and policy relevance.',
};

export function isWhitePaperTone(value: unknown): value is WhitePaperTone {
  return (
    value === 'professional_neutral' ||
    value === 'editorial_narrative' ||
    value === 'technical_dense' ||
    value === 'conversational_plain'
  );
}

export function asWhitePaperTone(value: unknown): WhitePaperTone {
  return isWhitePaperTone(value) ? value : 'professional_neutral';
}

/**
 * Three guided starting structures. Clio offers these; each carries a
 * recommended section set, default tone, and word budget.
 */
export const WHITEPAPER_VARIANTS: WhitePaperVariant[] = [
  {
    slug: 'congressional_program',
    name: 'Congressional Program White Paper',
    description:
      'Default 1-2 page program white paper for congressional authorization/appropriations submission.',
    defaultTone: 'professional_neutral',
    wordBudget: 600,
    sections: [
      {
        heading: 'Problem Statement',
        purpose: 'The specific capability gap or national security need being addressed.',
      },
      { heading: 'Solution', purpose: 'What this program does and how it solves the problem.' },
      {
        heading: 'Current Status',
        purpose:
          'Development stage, TRL level, milestones achieved, contracts or government endorsements.',
      },
      {
        heading: 'Funding History and Request',
        purpose: 'FY enacted / requested amounts with brief context versus the budget request.',
      },
      {
        heading: 'National Security Impact',
        purpose: 'Why this capability matters strategically.',
      },
      {
        heading: 'Economic and District Impact',
        purpose:
          "Jobs, districts supported, small business participation, the Member's state/district.",
      },
      {
        heading: 'The Ask',
        purpose: 'One sentence stating exactly what is being requested.',
      },
    ],
  },
  {
    slug: 'appropriations_brief',
    name: 'Appropriations Request Brief',
    description: 'Tighter, numbers-forward brief optimized for appropriations staff.',
    defaultTone: 'technical_dense',
    wordBudget: 450,
    sections: [
      { heading: 'The Ask', purpose: 'Exact account, line, and dollar amount requested.' },
      {
        heading: 'Funding Context',
        purpose:
          'FY enacted/requested vs the President\u2019s Budget Request; deltas and rationale.',
      },
      {
        heading: 'Capability Gap',
        purpose: 'The operational shortfall this funding closes, with evidence.',
      },
      {
        heading: 'District/State Impact',
        purpose: 'Jobs, facilities, and economic activity tied to the Member.',
      },
      {
        heading: 'Accountability and Oversight',
        purpose: 'How funds will be tracked, milestones, and reporting commitments.',
      },
    ],
  },
  {
    slug: 'policy_position',
    name: 'Issue / Policy Position Paper',
    description: 'Narrative position paper for a policy issue or legislative proposal.',
    defaultTone: 'editorial_narrative',
    wordBudget: 800,
    sections: [
      {
        heading: 'Executive Summary',
        purpose: 'The position and the recommended action in brief.',
      },
      { heading: 'Background', purpose: 'Relevant history and current state of the issue.' },
      { heading: 'Policy Problem', purpose: 'The specific problem and its stakes.' },
      { heading: 'Recommended Action', purpose: 'The concrete legislative or policy ask.' },
      {
        heading: 'Stakeholders and Support',
        purpose: 'Who benefits, who supports, and existing momentum.',
      },
      { heading: 'Call to Action', purpose: 'What you want the Member to do next.' },
    ],
  },
];

export const DEFAULT_WHITEPAPER_VARIANT: WhitePaperVariant = WHITEPAPER_VARIANTS[0]!;

export function getWhitePaperVariant(slug: string | null | undefined): WhitePaperVariant {
  return WHITEPAPER_VARIANTS.find((variant) => variant.slug === slug) ?? DEFAULT_WHITEPAPER_VARIANT;
}

export function variantSections(slug: string | null | undefined): WhitePaperSection[] {
  return getWhitePaperVariant(slug).sections.map((section, index) => ({
    id: `sec-${index + 1}`,
    heading: section.heading,
    body: '',
    status: 'empty' as const,
  }));
}

/** Flatten structured sections into the plain-text generated_document mirror. */
export function composeWhitePaperDocument(sections: WhitePaperSection[]): string {
  return sections
    .map((section) => {
      const heading = section.heading.trim();
      const body = section.body.trim();
      if (!heading && !body) return '';
      if (!body) return heading;
      return `${heading}\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Best-effort parse of a flat document (legacy generated_document or an AI
 * blob) into sections, matching against an expected heading set so a single
 * blob does not collapse into one section.
 */
export function splitDocumentIntoSections(
  doc: string,
  expectedHeadings: string[],
): WhitePaperSection[] {
  const text = (doc ?? '').trim();
  if (!text) {
    return expectedHeadings.map((heading, index) => ({
      id: `sec-${index + 1}`,
      heading,
      body: '',
      status: 'empty' as const,
    }));
  }

  const normalized = (value: string) =>
    value
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
  const headingSet = new Map(expectedHeadings.map((heading) => [normalized(heading), heading]));

  const lines = text.split(/\r?\n/);
  const sections: WhitePaperSection[] = [];
  let current: WhitePaperSection | null = null;

  const pushCurrent = () => {
    if (current) {
      current.body = current.body.trim();
      current.status = current.body.length > 0 ? 'drafted' : 'empty';
      sections.push(current);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current) current.body += '\n';
      continue;
    }
    // A heading line: short, matches an expected heading (allowing markdown #),
    // or is ALL CAPS / Title-style with no terminal punctuation.
    const stripped = line
      .replace(/^#+\s*/, '')
      .replace(/[:.]+$/, '')
      .trim();
    const matchKey = normalized(stripped);
    const isKnownHeading = headingSet.has(matchKey);
    const looksLikeHeading =
      isKnownHeading ||
      (stripped.length > 0 &&
        stripped.length <= 60 &&
        !/[.!?]$/.test(line) &&
        (stripped === stripped.toUpperCase() || /^#+\s/.test(rawLine)));

    if (looksLikeHeading) {
      pushCurrent();
      current = {
        id: `sec-${sections.length + 1}`,
        heading: isKnownHeading ? headingSet.get(matchKey)! : stripped,
        body: '',
        status: 'empty',
      };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    } else {
      // Preamble before any heading: seed the first expected section.
      current = {
        id: 'sec-1',
        heading: expectedHeadings[0] ?? 'Executive Summary',
        body: line,
        status: 'drafted',
      };
    }
  }
  pushCurrent();

  // Re-id sequentially.
  return sections.map((section, index) => ({ ...section, id: `sec-${index + 1}` }));
}
