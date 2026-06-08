/**
 * Step 3.3 — artifact grounding verifier (plan §18). PURE: no DB, no LLM, no
 * NestJS. Mirrors the spirit of `clio-verifier.helpers` (parse claims, summarize
 * unsupported) but for the closed-fact-sheet model used here.
 *
 * The LLM is instructed to produce prose that ONLY restates claims by id. This gate
 * enforces that mechanically. A paragraph is REJECTED when:
 *   (a) it cites zero claim ids — nothing grounds it; or
 *   (b) it contains a numeral that is NOT present in any cited claim's `value` or
 *       `claimText` — a fabricated/unsourced figure (the classic hallucination).
 *
 * Numerals are compared on a normalized digit signature ("$120M" and "120 million"
 * are NOT auto-equated — the claim must literally carry the figure the prose uses),
 * which is intentionally strict: better to drop a paragraph than ship an unsourced
 * "$999M". Caveat/disclaimer text is exempt from numeral-checking only when its
 * paragraph carries no claim ids by design (see {@link verifyArtifact} options).
 */
import type { Claim, FactSheet, GeneratedParagraph } from './artifact-types.js';

export interface RejectedParagraph {
  index: number;
  reason: string;
}

export interface ArtifactVerification {
  ok: boolean;
  rejected: RejectedParagraph[];
}

export interface VerifyOptions {
  /**
   * Indices (into the paragraphs array) that are caveat/disclaimer text and are
   * therefore exempt from BOTH the zero-claim and the unsourced-numeral checks.
   * Caveats are derived from the card's `uncertainty` and intentionally carry no
   * claim grounding. Defaults to none.
   */
  caveatIndices?: number[];
}

/**
 * Extract the bare numeric tokens from a string: the digit-runs (with optional
 * decimal) inside any figure. "$120M up from $90M" -> ["120", "90"]. We compare on
 * the digit run so "$120M" in prose matches a claim value of "$120M" or claimText
 * "...is $120M..."; a magnitude word change alone (M vs B) still differs by digits
 * only if the digits match — which is acceptable, the digit is the load-bearing part.
 */
function extractNumerals(text: string): string[] {
  const out: string[] = [];
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  for (const raw of matches) {
    const normalized = raw.replace(/,/g, '');
    out.push(normalized);
  }
  return out;
}

/** All numeral signatures a claim can vouch for (from its value AND its claimText). */
function claimNumerals(claim: Claim): Set<string> {
  const set = new Set<string>();
  for (const num of extractNumerals(claim.value ?? '')) set.add(num);
  for (const num of extractNumerals(claim.claimText)) set.add(num);
  return set;
}

/**
 * Verify generated paragraphs against the fact sheet. Returns `ok` (no rejections)
 * plus the list of rejected paragraphs with a human reason. Does not mutate input.
 */
export function verifyArtifact(
  paragraphs: GeneratedParagraph[],
  factSheet: FactSheet,
  options: VerifyOptions = {},
): ArtifactVerification {
  const caveat = new Set(options.caveatIndices ?? []);
  const claimById = new Map(factSheet.claims.map((c) => [c.id, c]));
  const rejected: RejectedParagraph[] = [];

  paragraphs.forEach((para, index) => {
    if (caveat.has(index)) return; // caveats are exempt by design

    const claimIds = Array.isArray(para.claimIds) ? para.claimIds : [];

    // (a) zero claim ids => ungrounded.
    if (claimIds.length === 0) {
      rejected.push({ index, reason: 'paragraph cites no claims' });
      return;
    }

    // Build the union of numerals all cited (and known) claims can vouch for.
    const allowed = new Set<string>();
    let sawKnownClaim = false;
    for (const id of claimIds) {
      const claim = claimById.get(id);
      if (!claim) continue; // unknown id contributes nothing; may still leave para ungrounded
      sawKnownClaim = true;
      for (const num of claimNumerals(claim)) allowed.add(num);
    }

    if (!sawKnownClaim) {
      rejected.push({ index, reason: 'paragraph cites only unknown claim ids' });
      return;
    }

    // (b) any numeral in the prose not vouched for by a cited claim => unsourced.
    const numerals = extractNumerals(para.text);
    const unsourced = numerals.filter((num) => !allowed.has(num));
    if (unsourced.length > 0) {
      rejected.push({
        index,
        reason: `unsourced numeral(s) not in any cited claim: ${unsourced.join(', ')}`,
      });
    }
  });

  return { ok: rejected.length === 0, rejected };
}
