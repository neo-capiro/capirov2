import { describe, expect, test } from '@jest/globals';
import {
  ATTACHMENT_DOC_FIXTURES,
  ATTACHMENT_EVAL_CASE_COUNT,
  ATTACHMENT_FAILURE_FIXTURES,
  ATTACHMENT_IMAGE_FIXTURES,
} from './attachment-fixtures.js';

describe('attachment eval fixtures', () => {
  test('covers ~20 cases across doc Q&A, vision, and explicit failures', () => {
    expect(ATTACHMENT_DOC_FIXTURES.length).toBeGreaterThanOrEqual(14);
    expect(ATTACHMENT_IMAGE_FIXTURES.length).toBeGreaterThanOrEqual(3);
    expect(ATTACHMENT_FAILURE_FIXTURES.length).toBe(3);
    expect(ATTACHMENT_EVAL_CASE_COUNT).toBeGreaterThanOrEqual(20);
  });

  test('ids are unique', () => {
    const ids = [
      ...ATTACHMENT_DOC_FIXTURES.map((f) => f.id),
      ...ATTACHMENT_IMAGE_FIXTURES.map((f) => f.id),
      ...ATTACHMENT_FAILURE_FIXTURES.map((f) => f.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every doc fixture answer is actually present in its document', () => {
    for (const f of ATTACHMENT_DOC_FIXTURES) {
      const doc = f.lines.join('\n').toLowerCase();
      for (const expected of f.mustInclude) {
        expect(doc).toContain(expected.toLowerCase());
      }
    }
  });

  test('failure fixtures expect explicit, user-visible statuses', () => {
    for (const f of ATTACHMENT_FAILURE_FIXTURES) {
      expect(['scanned', 'unsupported']).toContain(f.expectStatus);
    }
  });
});
