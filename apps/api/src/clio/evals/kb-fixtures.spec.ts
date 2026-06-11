import { describe, expect, test } from '@jest/globals';
import {
  KB_SNAPSHOT_MAX_CHARS,
  KB_SOURCE_TYPES,
  formatDistrict,
} from '../../embeddings/client-kb.helpers.js';
import {
  KB_EVAL_QUESTIONS,
  MERIDIAN_DOCUMENTS,
  MERIDIAN_FACILITIES,
  MERIDIAN_PEOPLE,
  buildKbEvalCorpus,
  buildKbEvalSnapshot,
} from './kb-fixtures.js';

describe('kb fixtures', () => {
  // Built once with the PRODUCTION text builders + chunker so the assertions
  // below hold against exactly the text the indexer would embed.
  const corpus = buildKbEvalCorpus();
  const haystack = corpus.map((r) => r.text.toLowerCase());

  test('seeds the full Meridian client', () => {
    expect(MERIDIAN_PEOPLE).toHaveLength(6);
    expect(MERIDIAN_FACILITIES).toHaveLength(5);
    const districts = new Set(
      MERIDIAN_FACILITIES.map((f) => formatDistrict(f.state, f.congressionalDistrict)),
    );
    expect(districts.size).toBe(4);
    expect(MERIDIAN_DOCUMENTS).toHaveLength(3);
    for (const doc of MERIDIAN_DOCUMENTS) {
      // "Several paragraphs each" — enough body for retrieval to be non-trivial.
      expect(doc.text.split('\n\n').length).toBeGreaterThanOrEqual(3);
    }
  });

  test('corpus covers all four KB source types with unique row ids', () => {
    const kinds = new Set(corpus.map((r) => r.kind));
    for (const kind of KB_SOURCE_TYPES) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(new Set(corpus.map((r) => r.id)).size).toBe(corpus.length);
  });

  test('has 30 questions with unique ids and valid expectKinds', () => {
    expect(KB_EVAL_QUESTIONS).toHaveLength(30);
    expect(new Set(KB_EVAL_QUESTIONS.map((q) => q.id)).size).toBe(30);
    for (const q of KB_EVAL_QUESTIONS) {
      expect(KB_SOURCE_TYPES).toContain(q.expectKind);
      expect(q.mustInclude.length).toBeGreaterThan(0);
    }
  });

  test('every mustInclude string literally appears in the production-built corpus', () => {
    for (const q of KB_EVAL_QUESTIONS) {
      for (const expected of q.mustInclude) {
        const found = haystack.some((t) => t.includes(expected.toLowerCase()));
        if (!found) {
          throw new Error(`${q.id}: mustInclude "${expected}" not found anywhere in the corpus`);
        }
        expect(found).toBe(true);
      }
    }
  });

  test('each question has supporting text inside a row of its expectKind', () => {
    // Sanity for the retrieval@6 metric: the expected kind actually carries
    // at least one of the answer strings, so a kind-level retrieval hit is
    // meaningful (multi-hop questions may need other kinds for the rest).
    for (const q of KB_EVAL_QUESTIONS) {
      const rows = corpus.filter((r) => r.kind === q.expectKind);
      const hit = q.mustInclude.some((s) =>
        rows.some((r) => r.text.toLowerCase().includes(s.toLowerCase())),
      );
      if (!hit) {
        throw new Error(`${q.id}: no mustInclude found in any ${q.expectKind} row`);
      }
      expect(hit).toBe(true);
    }
  });

  test('snapshot builds deterministically, names the client, stays in budget', () => {
    const snapshot = buildKbEvalSnapshot();
    expect(snapshot).toContain('Meridian Aerostructures');
    expect(snapshot).toContain('KS-04');
    expect(snapshot).toBe(buildKbEvalSnapshot());
    // buildKbSnapshot truncates to KB_SNAPSHOT_MAX_CHARS (+1 for the ellipsis).
    expect(snapshot.length).toBeLessThanOrEqual(KB_SNAPSHOT_MAX_CHARS + 1);
  });
});
