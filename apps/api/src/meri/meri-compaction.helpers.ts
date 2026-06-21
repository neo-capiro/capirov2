/**
 * Pure helpers for long-conversation compaction (assistant-parity F2).
 *
 * Long threads replay full message history into the model; without compaction
 * the history trimmer silently drops the oldest turns once the char budget is
 * hit, losing early facts. Instead, an after-turn async job (never on the
 * streaming path) maintains a rolling summary per conversation:
 *
 *   [summary of turns <= summaryUpToMessageId] + [verbatim tail of recent turns]
 *
 * The summary regenerates incrementally — old summary + turns since — with a
 * small (intent-tier) model, roughly one call per trigger-budget of new text,
 * and is injected into the DYNAMIC system tail (never the cached base, so the
 * prompt-cache split is preserved).
 *
 * Only ClioMessage user/assistant bodies ever enter the prompt builder —
 * encrypted meeting notes live in a different table and have no path in
 * (spec-covered structural guarantee).
 */

export const APPROX_CHARS_PER_TOKEN = 4;

/** Cheap, deterministic token estimate (chars/4) for budget decisions. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export interface CompactionMessage {
  id: string;
  role: string;
  body: string;
}

export interface CompactionPlanInput {
  /** Messages newer than the current summary boundary, chronological. */
  messages: CompactionMessage[];
  existingSummary: string | null;
  /** Compact once the un-summarized text beyond the tail reaches this size. */
  triggerTokens: number;
  /** How many of the newest messages always stay verbatim. */
  tailMessages: number;
  /** Don't bother summarizing fewer than this many messages. */
  minMessagesToSummarize?: number;
}

export interface CompactionPlan {
  compact: boolean;
  /** Oldest-first messages to fold into the summary this round. */
  toSummarize: CompactionMessage[];
  /** New summary boundary (id of the newest summarized message). */
  upToMessageId: string | null;
}

const NO_COMPACTION: CompactionPlan = { compact: false, toSummarize: [], upToMessageId: null };

/**
 * Decide whether (and what) to compact. The trigger is token-based so call
 * frequency scales with verbosity, not message count: nothing happens until
 * the text beyond the verbatim tail reaches triggerTokens, which for typical
 * chat turns works out to one small-model call per dozens of turns.
 */
export function planCompaction(input: CompactionPlanInput): CompactionPlan {
  const minMessages = input.minMessagesToSummarize ?? 4;
  const beyondTail = input.messages.slice(0, Math.max(0, input.messages.length - input.tailMessages));
  if (beyondTail.length < minMessages) return NO_COMPACTION;
  const beyondTailTokens = beyondTail.reduce((sum, m) => sum + estimateTokens(m.body), 0);
  if (beyondTailTokens < input.triggerTokens) return NO_COMPACTION;
  const last = beyondTail[beyondTail.length - 1];
  return {
    compact: true,
    toSummarize: beyondTail,
    upToMessageId: last?.id ?? null,
  };
}

/** Per-turn clamp inside the summarization prompt so one giant paste can't
 *  blow the small model's context. */
export function clampTurnForSummary(body: string, maxChars = 2000): string {
  const trimmed = body.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars).trimEnd()}…` : trimmed;
}

export interface CompactionPromptInput {
  existingSummary: string | null;
  turns: Array<{ role: string; body: string }>;
}

export interface CompactionPrompt {
  system: string;
  user: string;
}

/**
 * Build the incremental-summarization prompt: old summary + turns since →
 * new summary. Structured sections keep retention predictable; concrete
 * identifiers (bill numbers, clients, amounts, dates, [n] citations of
 * record) are pinned explicitly because they are what needle probes — and
 * lobbyists — actually ask for later.
 */
export function buildCompactionPrompt(input: CompactionPromptInput): CompactionPrompt {
  const system = [
    'You maintain the rolling summary of a long conversation between a federal-lobbying professional and Meri, their AI assistant.',
    'Rewrite the summary so it stays a faithful, compact record of everything established so far.',
    'Structure the summary as four labeled sections:',
    'Facts & context: durable facts established in conversation (clients, bills, programs, people, numbers, dates).',
    'Decisions & preferences: what the user decided, asked for, or prefers.',
    'Work products: deliverables produced (briefings, memos, drafts) and their key conclusions.',
    'Open threads: unresolved questions or promised follow-ups.',
    'Preserve concrete identifiers verbatim: bill numbers, client and member names, dollar amounts, dates, deadlines, and bracketed source citations like [3] that were cited as evidence.',
    'Fold the new turns into the existing summary; drop chit-chat; never invent facts.',
    'Hard limit: 400 words. Output ONLY the summary text (the four sections), no preamble.',
  ].join('\n');

  const parts: string[] = [];
  if (input.existingSummary?.trim()) {
    parts.push(`Existing summary:\n${input.existingSummary.trim()}`);
  } else {
    parts.push('Existing summary: (none yet)');
  }
  parts.push(
    'New turns since the last summary (oldest first):',
    ...input.turns.map((t) => `${t.role === 'assistant' ? 'Meri' : 'User'}: ${clampTurnForSummary(t.body)}`),
    'Write the updated summary now.',
  );
  return { system, user: parts.join('\n\n') };
}

/** The block injected ahead of the verbatim history tail in turn assembly. */
export function formatSummaryBlockForPrompt(summary: string): string {
  return [
    'Conversation summary (older turns were compacted into this; treat it as established conversation context):',
    summary.trim(),
  ].join('\n');
}

/** Defensive output cleanup for the small model's summary text. */
export function sanitizeSummaryOutput(raw: string, maxChars = 6000): string | null {
  const text = raw.trim();
  if (!text) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}
