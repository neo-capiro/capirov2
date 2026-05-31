import { Injectable } from '@nestjs/common';
import { isValidPeCode } from '../jbook/jbook-extract.js';

/**
 * Extracts a Program Element code from a USAspending award and validates it
 * against the known program_element universe (Step 28).
 *
 * Resolution order:
 *   1. An explicit PE field on the award (program_element / pe_code), if present.
 *   2. Otherwise, regex on the award description.
 * The first valid, DB-known PE wins. An award with no resolvable/known PE keeps
 * pe_code NULL — it is NOT quarantined (awards legitimately span many that have
 * no R-2 PE line, e.g. O&M / services).
 */

// PE code in free text: 7 digits + service letter (+ optional suffix). Same canon
// as the rest of the pipeline (jbook isValidPeCode). NB: a bare 7-digit number is
// only a PE when followed by the service letter.
const PE_IN_TEXT = /\b([0-9]{7}[A-Z][A-Z0-9]*)\b/g;

export interface AwardLike {
  /** Explicit PE field if USAspending/source provides one. */
  programElement?: string | null;
  peCode?: string | null;
  description?: string | null;
}

@Injectable()
export class AwardPeExtractorService {
  /**
   * Resolve a PE code for an award against the set of known PE codes.
   * Returns the uppercased PE if a valid, known one is found; otherwise null.
   */
  extractPeCode(award: AwardLike, knownPeCodes: ReadonlySet<string>): string | null {
    // 1) explicit field
    const explicit = (award.programElement ?? award.peCode ?? '').toString().trim().toUpperCase();
    if (explicit && isValidPeCode(explicit) && knownPeCodes.has(explicit)) {
      return explicit;
    }

    // 2) regex on description — first valid, known candidate wins
    const desc = award.description ?? '';
    if (desc) {
      const matches = desc.toUpperCase().match(PE_IN_TEXT);
      if (matches) {
        for (const m of matches) {
          const candidate = m.trim().toUpperCase();
          if (isValidPeCode(candidate) && knownPeCodes.has(candidate)) {
            return candidate;
          }
        }
      }
    }

    return null;
  }
}
