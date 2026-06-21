import { describe, expect, test } from '@jest/globals';
import { parseSuggestions } from './meri-suggestions.helpers.js';

describe('parseSuggestions', () => {
  test('parses a JSON array', () => {
    expect(
      parseSuggestions('["What is the markup date?", "Who chairs the subcommittee?"]'),
    ).toEqual(['What is the markup date?', 'Who chairs the subcommittee?']);
  });

  test('parses a fenced JSON array with surrounding prose', () => {
    const raw = 'Here you go:\n```json\n["Draft a memo", "Summarize the bill"]\n```';
    expect(parseSuggestions(raw)).toEqual(['Draft a memo', 'Summarize the bill']);
  });

  test('falls back to bullet/numbered lines and strips markers + quotes', () => {
    const raw = '1. "Check the 302(b) levels"\n- Draft talking points\n* Find the hearing date';
    expect(parseSuggestions(raw)).toEqual([
      'Check the 302(b) levels',
      'Draft talking points',
      'Find the hearing date',
    ]);
  });

  test('dedupes (case-insensitive) and caps the count', () => {
    const raw = '["a thing", "A THING", "second", "third", "fourth"]';
    expect(parseSuggestions(raw, 3)).toEqual(['a thing', 'second', 'third']);
  });

  test('drops too-short entries and truncates long ones', () => {
    const long = 'x'.repeat(200);
    const out = parseSuggestions(`["okay", "${long}", "a"]`);
    expect(out).toContain('okay'); // valid, kept
    const truncated = out.find((s) => s.endsWith('…'));
    expect(truncated).toBeDefined();
    expect(truncated!.length).toBeLessThanOrEqual(120);
    expect(out).not.toContain('a'); // length < 3, dropped
  });

  test('empty / non-string input yields []', () => {
    expect(parseSuggestions('')).toEqual([]);
    expect(parseSuggestions('   ')).toEqual([]);
  });
});
