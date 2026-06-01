/**
 * Pure parser for Clio's "suggested next actions" (P2-4).
 *
 * A cheap model pass proposes a few likely follow-up prompts after an answer;
 * this normalizes its output (JSON array preferred, newline/bullet list as a
 * fallback) into a clean, deduped, capped list of short suggestion strings.
 * Pure so it unit-tests under `src/**.spec.ts`; the model call lives in the
 * service.
 */

const MAX_LEN = 120;

export function parseSuggestions(raw: string, max = 3): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];

  let items: string[] = [];
  // Prefer a JSON array if the model returned one (possibly fenced / wrapped).
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr: unknown = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr)) items = arr.filter((x): x is string => typeof x === 'string');
    } catch {
      /* fall through to line parsing */
    }
  }
  if (items.length === 0) items = raw.split('\n');

  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let s = item
      .replace(/^[\s\-*•\d.)]+/, '') // strip leading bullets / numbering / whitespace
      .replace(/^["'`]+|["'`]+$/g, '') // strip wrapping quotes
      .trim();
    if (s.length < 3) continue;
    if (s.length > MAX_LEN) s = `${s.slice(0, MAX_LEN - 1).trimEnd()}…`;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(s);
    if (cleaned.length >= max) break;
  }
  return cleaned;
}
