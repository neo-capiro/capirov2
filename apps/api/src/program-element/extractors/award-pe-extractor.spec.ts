import { describe, expect, test } from '@jest/globals';
import { AwardPeExtractorService, type AwardLike } from './award-pe-extractor.service.js';

const known = new Set(['0603270A', '0603250F', '0604201A']);
const svc = new AwardPeExtractorService();

describe('AwardPeExtractorService.extractPeCode', () => {
  test('award with explicit, known PE field → extracted (uppercased)', () => {
    const award: AwardLike = { programElement: '0603270a', description: 'whatever' };
    expect(svc.extractPeCode(award, known)).toBe('0603270A');
  });

  test('award with PE in description → extracted', () => {
    const award: AwardLike = { description: 'R&D services supporting PE 0603250F electronic warfare' };
    expect(svc.extractPeCode(award, known)).toBe('0603250F');
  });

  test('award with no PE anywhere → null (NOT quarantined)', () => {
    const award: AwardLike = { description: 'Base operations support services, no program element' };
    expect(svc.extractPeCode(award, known)).toBeNull();
  });

  test('PE-shaped but not in known program_element set → null (filtered)', () => {
    const award: AwardLike = { programElement: '0609999Z', description: 'mentions 0609999Z' };
    expect(svc.extractPeCode(award, known)).toBeNull();
  });

  test('malformed PE-ish token → null', () => {
    const award: AwardLike = { description: 'contract 12345 ABC not a pe' };
    expect(svc.extractPeCode(award, known)).toBeNull();
  });

  test('explicit field takes precedence; falls back to description when explicit invalid', () => {
    const award: AwardLike = { programElement: 'N/A', description: 'work under 0604201A' };
    expect(svc.extractPeCode(award, known)).toBe('0604201A');
  });

  test('idempotent / deterministic — same input yields same output', () => {
    const award: AwardLike = { description: 'PE 0603270A and PE 0603250F both mentioned' };
    const a = svc.extractPeCode(award, known);
    const b = svc.extractPeCode(award, known);
    expect(a).toBe(b);
    expect(a).toBe('0603270A'); // first valid known match wins
  });
});
