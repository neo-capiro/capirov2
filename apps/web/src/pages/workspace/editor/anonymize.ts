/**
 * Display-time anonymization. The Anonymize toggle replaces direct client and
 * product names with neutral placeholders in the rendered document (the Phase 6
 * review modal will let the user approve per-term scope + export behavior; this
 * is the live toggle behavior).
 *
 * Server-side generation can also return anonymized content (useGenerateSection
 * → result.anonymized); this client pass covers content already in the doc.
 */

/** Build a name→placeholder map from the draft's client + product. */
export function anonymizeMap(
  client: string | null,
  product: string | null,
): Array<[RegExp, string]> {
  const pairs: Array<[string, string]> = [];
  if (client) pairs.push([client, 'the client']);
  if (product) pairs.push([product, 'the program']);
  return (
    pairs
      // Longest names first so a multi-word match wins over a partial one.
      .sort((a, b) => b[0].length - a[0].length)
      .map(([from, to]) => [new RegExp(escapeRegExp(from), 'g'), to])
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apply an anonymize map to a string when `on`. */
export function anonText(
  text: string | undefined | null,
  on: boolean,
  map: Array<[RegExp, string]>,
): string {
  if (!on || !text) return text ?? '';
  return map.reduce((acc, [re, to]) => acc.replace(re, to), text);
}
