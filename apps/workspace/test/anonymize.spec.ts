import { describe, expect, test } from '@jest/globals';
import { anonymizeText, deanonymizeText } from '../src/generation/anonymize.js';

/** Anonymization (AC-6.4). Pure function, no DB/network. */
describe('anonymizeText', () => {
  test('replaces client name with [CLIENT] and builds a legend', () => {
    const { text, map } = anonymizeText('Aerovance Systems requests funding for Aerovance.', {
      client: 'Aerovance Systems',
    });
    expect(text).toContain('[CLIENT]');
    expect(text).not.toContain('Aerovance Systems');
    expect(map.legend['[CLIENT]']).toBe('Aerovance Systems');
  });

  test('longest-match-first prevents partial clobbering', () => {
    // "Acme Defense Systems" must be replaced as a whole, before "Acme".
    const { text } = anonymizeText('Acme Defense Systems and Acme.', {
      client: 'Acme Defense Systems',
      offices: ['Acme'],
    });
    expect(text).toContain('[CLIENT]');
    expect(text).toContain('[OFFICE_1]');
    expect(text).not.toContain('Acme Defense Systems');
  });

  test('case-insensitive replacement', () => {
    const { text } = anonymizeText('aerovance systems and AEROVANCE SYSTEMS', {
      client: 'Aerovance Systems',
    });
    expect(text).not.toMatch(/aerovance/i);
  });

  test('offices get distinct placeholders', () => {
    const { text, map } = anonymizeText('Rep. Smith and Sen. Jones support this.', {
      offices: ['Rep. Smith', 'Sen. Jones'],
    });
    expect(map.legend['[OFFICE_1]']).toBe('Rep. Smith');
    expect(map.legend['[OFFICE_2]']).toBe('Sen. Jones');
    expect(text).toContain('[OFFICE_1]');
    expect(text).toContain('[OFFICE_2]');
  });

  test('deanonymize reverses the mapping', () => {
    const original = 'Aerovance Systems requests support from Rep. Smith.';
    const { text, map } = anonymizeText(original, {
      client: 'Aerovance Systems',
      offices: ['Rep. Smith'],
    });
    expect(deanonymizeText(text, map)).toBe(original);
  });

  test('no targets = passthrough', () => {
    const { text, map } = anonymizeText('Generic text.', {});
    expect(text).toBe('Generic text.');
    expect(Object.keys(map.legend)).toHaveLength(0);
  });
});
