/**
 * Deterministic PE <-> person matcher (no LLM, no network). Proposes person ->
 * Program Element links for human review by overlapping a person's org/title
 * text against PE titles + project titles.
 *
 * Design goals:
 *  - High precision over recall: a candidate should be a plausible, auditable
 *    match a reviewer can confirm in seconds, not a fuzzy guess.
 *  - Distinctive program tokens (acronyms like AMPV/THAAD, proper system names)
 *    drive the score; generic acquisition words (system, program, office, army)
 *    are stopworded so they never create spurious matches.
 *  - Pure functions only, so they unit-test without a DB.
 */

// Generic words that appear in almost every PE/org and must NOT drive a match.
const STOPWORDS = new Set([
  'the', 'and', 'of', 'for', 'to', 'a', 'an', 'in', 'on', 'with', 'or',
  'program', 'programs', 'project', 'projects', 'system', 'systems', 'office',
  'executive', 'management', 'development', 'advanced', 'technology', 'technologies',
  'army', 'navy', 'air', 'force', 'marine', 'corps', 'space', 'joint', 'defense',
  'us', 'u', 's', 'usa', 'dod', 'support', 'general', 'integrated', 'capability',
  'capabilities', 'command', 'control', 'engineering', 'research', 'evaluation',
  'test', 'operational', 'pm', 'peo', 'pmo', 'deputy', 'director', 'manager',
  'product', 'increment', 'inc', 'improvement', 'prog', 'division', 'directorate',
  'headquarters', 'staff', 'department', 'service', 'services', 'group', 'team',
  'budget', 'line', 'item', 'element', 'activity', 'fy', 'rdte',
  // Agency / office / organizational acronyms — these identify WHERE someone works,
  // not WHICH program. Matching on them alone produces false PE links (e.g. every
  // OSD/DARPA/NATO person matching every PE that mentions the agency), so they are
  // excluded from the acronym signal.
  'osd', 'ousd', 'darpa', 'dtra', 'dcma', 'dau', 'nato', 'dod', 'dla', 'disa',
  'nsa', 'nga', 'nro', 'diu', 'osc', 'cdao', 'asd', 're', 'spp', 'jcs', 'jroc',
  'cocom', 'socom', 'centcom', 'indopacom', 'africom', 'eucom', 'northcom',
  'spacecom', 'stratcom', 'transcom', 'usarpac', 'usaf', 'usmc', 'usn', 'hqda',
  'navsea', 'navair', 'navwar', 'spawar', 'afmc', 'aflcmc', 'afrl', 'arl', 'onr',
  'hasc', 'sasc', 'hac', 'sac', 'gao', 'cbo', 'crs', 'omb',
]);

export interface PeText {
  peCode: string;
  /** PE title plus all of its project titles, concatenated. */
  text: string;
}

export interface PersonText {
  organization?: string | null;
  title?: string | null;
  programOfRecord?: string | null;
}

export interface PeMatchCandidate {
  peCode: string;
  score: number;
  matchBasis: string; // the overlapping distinctive tokens
  breakdown: { sharedTokens: string[]; sharedAcronyms: string[] };
}

/** Tokenize to lowercased alphanumeric words >=3 chars, minus stopwords. */
export function distinctiveTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Uppercase acronyms (2-6 letters/digits) from the ORIGINAL-case text, e.g. AMPV, THAAD, AFATDS. */
export function acronyms(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\b([A-Z][A-Z0-9]{1,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || '')) !== null) {
    const cap = m[1];
    if (!cap) continue;
    const a = cap.toLowerCase();
    if (STOPWORDS.has(a)) continue;
    out.add(a);
  }
  return out;
}

/**
 * Score one person against one PE's text. Acronym matches are weighted heavily
 * (a shared program acronym like "ampv" is a strong signal); distinctive word
 * overlap contributes secondarily. Returns 0 when there is no distinctive overlap.
 */
export function scorePersonToPe(person: PersonText, pe: PeText): PeMatchCandidate | null {
  const personRaw = [person.organization, person.title, person.programOfRecord].filter(Boolean).join(' ');
  const personTokens = distinctiveTokens(personRaw);
  const personAcr = acronyms(personRaw);
  const peTokens = distinctiveTokens(pe.text);
  const peAcr = acronyms(pe.text);

  const sharedAcronyms = Array.from(personAcr).filter((a) => peAcr.has(a));
  const sharedTokens = Array.from(personTokens).filter((t) => peTokens.has(t) && !personAcr.has(t));

  if (sharedAcronyms.length === 0 && sharedTokens.length === 0) return null;

  // Precision guard: a SINGLE bare program-acronym match (with no supporting word
  // overlap) is too weak — even after stopwording org acronyms, a lone shared
  // token like a common program initialism produces noise. Require corroboration:
  //   - 2+ shared acronyms, OR
  //   - 1 acronym + 1+ supporting distinctive word, OR
  //   - 2+ distinctive words (no acronym).
  const strong =
    sharedAcronyms.length >= 2 ||
    (sharedAcronyms.length >= 1 && sharedTokens.length >= 1) ||
    sharedTokens.length >= 2;
  if (!strong) return null;

  // Acronym hit ~0.5 each (capped), word hit ~0.18 each (capped). Corroborated
  // matches comfortably clear the 0.5 review threshold; richer overlap scores higher.
  const acrScore = Math.min(0.7, sharedAcronyms.length * 0.5);
  const wordScore = Math.min(0.5, sharedTokens.length * 0.18);
  const score = Math.min(0.98, acrScore + wordScore);

  const basisParts: string[] = [];
  if (sharedAcronyms.length) basisParts.push(`acronyms: ${sharedAcronyms.join(', ').toUpperCase()}`);
  if (sharedTokens.length) basisParts.push(`terms: ${sharedTokens.join(', ')}`);

  return {
    peCode: pe.peCode,
    score: Number(score.toFixed(3)),
    matchBasis: basisParts.join(' | '),
    breakdown: { sharedTokens, sharedAcronyms },
  };
}

/**
 * Score a person against all PEs, returning the top candidates above `threshold`
 * (default 0.5), highest first, capped at `limit` (default 5).
 */
export function topPeCandidates(
  person: PersonText,
  pes: PeText[],
  threshold = 0.5,
  limit = 5,
): PeMatchCandidate[] {
  const scored: PeMatchCandidate[] = [];
  for (const pe of pes) {
    const c = scorePersonToPe(person, pe);
    if (c && c.score >= threshold) scored.push(c);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
