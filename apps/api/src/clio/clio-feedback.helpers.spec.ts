import { describe, expect, test } from '@jest/globals';
import { normalizeFeedback } from './clio-feedback.helpers.js';

describe('normalizeFeedback', () => {
  test('accepts up / down', () => {
    expect(normalizeFeedback({ rating: 'up' }).rating).toBe('up');
    expect(normalizeFeedback({ rating: 'down' }).rating).toBe('down');
  });

  test('coerces any other rating to null (clearing feedback)', () => {
    expect(normalizeFeedback({ rating: 'maybe' }).rating).toBeNull();
    expect(normalizeFeedback({ rating: null }).rating).toBeNull();
    expect(normalizeFeedback({}).rating).toBeNull();
    expect(normalizeFeedback({ rating: 5 }).rating).toBeNull();
  });

  test('trims a note, drops empties, and treats non-strings as null', () => {
    expect(normalizeFeedback({ rating: 'down', note: '  too vague  ' }).note).toBe('too vague');
    expect(normalizeFeedback({ rating: 'down', note: '   ' }).note).toBeNull();
    expect(normalizeFeedback({ rating: 'down', note: 123 }).note).toBeNull();
    expect(normalizeFeedback({ rating: 'up' }).note).toBeNull();
  });

  test('clamps a long note to 2000 chars', () => {
    const note = normalizeFeedback({ rating: 'down', note: 'x'.repeat(5000) }).note;
    expect(note).not.toBeNull();
    expect(note!.length).toBe(2000);
  });
});
