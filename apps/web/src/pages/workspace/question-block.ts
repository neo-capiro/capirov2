/**
 * Parses the `capiro-question` markdown fence the model emits when it
 * wants to ask a clarifying question. Format:
 *
 *   ```capiro-question
 *   { "question": "...", "options": [...], "allowFreeText": true, "multi": false }
 *   ```
 *
 * Returned to the chat UI so it can render a modal instead of plain
 * markdown. If the JSON is missing/invalid we fall back to rendering
 * the raw text — better a degraded display than a swallowed message.
 */

export interface CapiroQuestion {
  question: string;
  options?: string[];
  allowFreeText?: boolean;
  multi?: boolean;
}

export interface ParsedAssistantMessage {
  // Everything before the question fence. Often empty per the prompt
  // contract but the model is free to emit a one-liner like "Got it —"
  // before the block.
  prose: string;
  question: CapiroQuestion | null;
}

const FENCE_RE = /```capiro-question\s*\n([\s\S]*?)```/;

export function parseAssistantMessage(content: string): ParsedAssistantMessage {
  const match = FENCE_RE.exec(content);
  if (!match) {
    return { prose: content, question: null };
  }
  const before = content.slice(0, match.index).trim();
  // Defensive parse — model occasionally trails the JSON with extra
  // text; try once, fall back to the raw markdown render if it fails.
  let question: CapiroQuestion | null = null;
  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    if (parsed && typeof parsed === 'object' && 'question' in parsed) {
      const q = parsed as Record<string, unknown>;
      if (typeof q.question === 'string') {
        question = {
          question: q.question,
          ...(Array.isArray(q.options) && q.options.every((o) => typeof o === 'string')
            ? { options: q.options as string[] }
            : {}),
          ...(typeof q.allowFreeText === 'boolean' ? { allowFreeText: q.allowFreeText } : {}),
          ...(typeof q.multi === 'boolean' ? { multi: q.multi } : {}),
        };
      }
    }
  } catch {
    // Fall through — leave question null so the prose path renders.
  }
  if (!question) {
    return { prose: content, question: null };
  }
  return { prose: before, question };
}
