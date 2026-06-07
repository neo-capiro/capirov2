import { describe, expect, test } from '@jest/globals';
import {
  distinctiveTokens,
  sharesDistinctiveToken,
  EntityResolutionService,
} from './entity-resolution.service.js';

/**
 * Distinctiveness guard for the LDA/contractor fuzzy matcher. A high raw trigram
 * score driven only by a shared generic word ("FOX CORPORATION" vs "RTX
 * CORPORATION") is noise — without this guard, a short distinctive client name
 * floods the review queue with dozens of unrelated "<X> CORPORATION" filers.
 */
describe('entity-resolution distinctiveness guard', () => {
  test('distinctiveTokens strips generic corporate words', () => {
    expect(distinctiveTokens('rtx corporation')).toEqual(['rtx']);
    expect(distinctiveTokens('raytheon company')).toEqual(['raytheon']);
    expect(distinctiveTokens('the company group')).toEqual([]); // all generic
    expect(distinctiveTokens('lockheed martin corporation')).toEqual(['lockheed', 'martin']);
  });

  test('sharesDistinctiveToken catches "<X> CORPORATION" collisions', () => {
    expect(sharesDistinctiveToken('rtx corporation', 'fox corporation')).toBe(false);
    expect(sharesDistinctiveToken('rtx corporation', 'csx corporation')).toBe(false);
    expect(sharesDistinctiveToken('rtx corporation', 'gatx corporation')).toBe(false);
  });

  test('sharesDistinctiveToken keeps genuine overlaps', () => {
    expect(sharesDistinctiveToken('rtx corporation', 'rtx')).toBe(true);
    expect(sharesDistinctiveToken('lockheed martin', 'lockheed martin corporation')).toBe(true);
    // No distinctive token on one side → can't judge → don't penalise.
    expect(sharesDistinctiveToken('the company group', 'fox corporation')).toBe(true);
  });

  test('scoreCandidate caps a generic-only collision below the write floor', () => {
    const service = new EntityResolutionService({} as never);
    const clientFp = service.fingerprint('RTX CORPORATION');
    const junk = (
      service as unknown as {
        scoreCandidate: (fp: string, row: { external_name: string; similarity: number }) => number;
      }
    ).scoreCandidate(clientFp, { external_name: 'FOX CORPORATION', similarity: 0.6 });
    expect(junk).toBeLessThanOrEqual(0.35); // dropped before the 0.4 review floor
  });

  test('scoreCandidate still rewards a real match', () => {
    const service = new EntityResolutionService({} as never);
    const clientFp = service.fingerprint('RTX CORPORATION');
    const real = (
      service as unknown as {
        scoreCandidate: (fp: string, row: { external_name: string; similarity: number }) => number;
      }
    ).scoreCandidate(clientFp, { external_name: 'RTX CORPORATION', similarity: 0.6 });
    expect(real).toBeGreaterThanOrEqual(0.85); // multi-token fingerprint-exact boost
  });
});
