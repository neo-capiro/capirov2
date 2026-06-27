/**
 * Client anonymization (Phase 6 / handoff §12.13). When a draft has
 * config.anonymize=true, the client name + any office names are replaced with
 * neutral placeholders before the text leaves the editor (preview/export) and
 * before it is sent to the model as context. Deterministic + reversible map so
 * the UI can show a legend ("[CLIENT] = Aerovance Systems").
 */

export interface AnonymizeMap {
  // placeholder -> original
  legend: Record<string, string>;
}

export interface AnonymizeResult {
  text: string;
  map: AnonymizeMap;
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the client name and office names with placeholders. Longest names
 * first so a containing name (e.g. "Acme Defense Systems") is replaced before
 * a substring ("Acme"). Case-insensitive, whole-token.
 */
export function anonymizeText(
  text: string,
  opts: { client?: string | null; offices?: string[] },
): AnonymizeResult {
  const legend: Record<string, string> = {};
  let out = text;

  const targets: { value: string; placeholder: string }[] = [];
  if (opts.client && opts.client.trim()) {
    targets.push({ value: opts.client.trim(), placeholder: '[CLIENT]' });
  }
  (opts.offices ?? []).forEach((office, i) => {
    if (office && office.trim()) {
      targets.push({ value: office.trim(), placeholder: `[OFFICE_${i + 1}]` });
    }
  });

  // Longest first to avoid partial-token clobbering.
  targets.sort((a, b) => b.value.length - a.value.length);

  for (const t of targets) {
    const re = new RegExp(escapeRegExp(t.value), 'gi');
    if (re.test(out)) {
      out = out.replace(re, t.placeholder);
      legend[t.placeholder] = t.value;
    }
  }

  return { text: out, map: { legend } };
}

/** Reverse an anonymization using its legend (for de-anonymized export). */
export function deanonymizeText(text: string, map: AnonymizeMap): string {
  let out = text;
  for (const [placeholder, original] of Object.entries(map.legend)) {
    out = out.split(placeholder).join(original);
  }
  return out;
}
