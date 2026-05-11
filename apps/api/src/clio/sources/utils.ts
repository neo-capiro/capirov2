export function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value!)));
}

export function compactSnippet(parts: Array<string | null | undefined>, max = 500): string {
  const normalized = parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map(stripHtml)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function requireApiKey(apiKey: string, keyName: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error(`${keyName} is required`);
  return trimmed;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

