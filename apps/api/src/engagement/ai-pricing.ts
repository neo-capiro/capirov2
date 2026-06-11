/**
 * Model→price lookup used to compute the ESTIMATED cost persisted on every
 * AiUsageEvent. Prices are USD per 1,000,000 tokens, hand-maintained against
 * the providers' public pricing pages — they are estimates, not provider-billed
 * truth, and the UI labels them accordingly.
 *
 * Verified 2026-06-11 (OpenAI pricing page; Anthropic models reference).
 * Update when provider pricing changes or a new model is adopted.
 */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

export const AI_PRICING: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4.1': { inputPerM: 2.0, outputPerM: 8.0 },
  'gpt-4.1-mini': { inputPerM: 0.4, outputPerM: 1.6 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10.0 },
  // Anthropic (keyed by alias; dated full IDs resolve via the suffix-strip
  // fallback in computeAiCostUsd)
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 },
  'claude-haiku-4-5-20251001': { inputPerM: 1.0, outputPerM: 5.0 },
  'claude-sonnet-4-5': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
};

export function computeAiCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = AI_PRICING[model] ?? AI_PRICING[model.replace(/-\d{8}$/, '')];
  if (!price) return 0;
  return (
    (inputTokens / 1_000_000) * price.inputPerM +
    (outputTokens / 1_000_000) * price.outputPerM
  );
}
