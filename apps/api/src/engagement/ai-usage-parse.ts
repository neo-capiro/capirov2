/**
 * Extract token usage from a raw AI provider response. Both the OpenAI
 * responses API and the Anthropic messages API report
 * `usage.input_tokens` / `usage.output_tokens`, so one parser covers both.
 * Pure + total: any malformed payload yields zeros — metering must never
 * throw into a generation path.
 */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export function parseProviderUsage(raw: unknown): ProviderUsage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  const usage = (raw as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  const u = usage as { input_tokens?: unknown; output_tokens?: unknown };
  return {
    inputTokens: toTokenCount(u.input_tokens),
    outputTokens: toTokenCount(u.output_tokens),
  };
}

function toTokenCount(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}
