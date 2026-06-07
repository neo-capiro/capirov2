import { describe, expect, test } from '@jest/globals';
import { PePersonMatcherService, PeRow, PersonRow } from './pe-person-matcher.service.js';

const svc = new PePersonMatcherService();

function buildIndex(pes: PeRow[]) {
  const peIndex = pes.map((p) => ({ peCode: p.peCode, norm: svc.norm(p.title), tg: svc.trigrams(p.title), svc: svc.peService(p.peCode) }));
  const byNormTitle = new Map<string, string[]>();
  for (const p of peIndex) { if (!byNormTitle.has(p.norm)) byNormTitle.set(p.norm, []); byNormTitle.get(p.norm)!.push(p.peCode); }
  return { peIndex, byNormTitle };
}

describe('peService (suffix -> service)', () => {
  test('maps single-letter designators', () => {
    expect(svc.peService('0601102A')).toBe('ARMY');
    expect(svc.peService('0601102F')).toBe('AF');
    expect(svc.peService('0601153N')).toBe('NAVY');
    expect(svc.peService('0305282M')).toBe('USMC');
    expect(svc.peService('0601601E')).toBe('DARPA');
  });
  test('prefers multi-char designators (SF, D8Z, JCY)', () => {
    expect(svc.peService('0601102SF')).toBe('SF');
    expect(svc.peService('0604011D8Z')).toBe('OSD');
    expect(svc.peService('0305251JCY')).toBe('CYBER');
  });
});

describe('personService', () => {
  test('uses explicit service field', () => {
    expect(svc.personService('ARMY', null)).toBe('ARMY');
    expect(svc.personService('SPACE FORCE', null)).toBe('SF');
  });
  test('falls back to organization heuristics', () => {
    expect(svc.personService(null, 'Air Force Research Laboratory (AFRL)')).toBe('AF');
    expect(svc.personService(null, 'Office of Naval Intelligence')).toBe('NAVY');
    expect(svc.personService(null, 'DARPA')).toBe('DARPA');
  });
});

describe('norm / similarity', () => {
  test('normalizes em-dash to recover exact matches', () => {
    expect(svc.norm('Weapons and Munitions — Eng Dev')).toBe(svc.norm('Weapons and Munitions - Eng Dev'));
  });
  test('similarity is 1.0 for normalization-equal strings', () => {
    expect(svc.similarity('Logistics and Engineer Equipment - Adv Dev', 'LOGISTICS AND ENGINEER EQUIPMENT—ADV DEV')).toBeCloseTo(1, 5);
  });
  test('similarity is low for unrelated strings', () => {
    expect(svc.similarity('Budget Oversight Role', 'Conventional Munitions')).toBeLessThan(0.3);
  });
});

describe('matchPerson — Signal 1 (peTitle)', () => {
  const pes: PeRow[] = [
    { peCode: '0601102A', title: 'Defense Research Sciences' },
    { peCode: '0601102F', title: 'Defense Research Sciences' },
    { peCode: '0601102SF', title: 'Defense Research Sciences' },
    { peCode: '0601153N', title: 'Defense Research Sciences' },
    { peCode: '0603804A', title: 'Logistics and Engineer Equipment—Adv Dev' },
  ];
  const { peIndex, byNormTitle } = buildIndex(pes);

  test('disambiguates an ambiguous title by the person service (THE drift guard)', () => {
    const person: PersonRow = { id: 'p1', service: 'SF', organization: 'Space Force', peTitle: 'Defense Research Sciences', programOfRecord: null };
    const c = svc.matchPerson(person, peIndex, byNormTitle, []);
    expect(c).toHaveLength(1);
    expect(c[0]!.peCode).toBe('0601102SF'); // NOT 0601102A/F/N
    expect(c[0]!.breakdown.signal).toBe('1a_exact_svc_disambig');
  });

  test('an Army person on the same ambiguous title gets the Army code', () => {
    const person: PersonRow = { id: 'p2', service: 'ARMY', organization: 'Army Research Lab', peTitle: 'Defense Research Sciences', programOfRecord: null };
    const c = svc.matchPerson(person, peIndex, byNormTitle, []);
    expect(c[0]!.peCode).toBe('0601102A');
  });

  test('unique exact title -> single high-confidence candidate', () => {
    const person: PersonRow = { id: 'p3', service: 'ARMY', organization: 'Army', peTitle: 'Logistics and Engineer Equipment - Adv Dev', programOfRecord: null };
    const c = svc.matchPerson(person, peIndex, byNormTitle, []);
    expect(c).toHaveLength(1);
    expect(c[0]!.peCode).toBe('0603804A');
    expect(c[0]!.score).toBeGreaterThanOrEqual(0.95);
  });

  test('no service info on an ambiguous title -> low-confidence fan-out for human pick', () => {
    const person: PersonRow = { id: 'p4', service: null, organization: null, peTitle: 'Defense Research Sciences', programOfRecord: null };
    const c = svc.matchPerson(person, peIndex, byNormTitle, []);
    expect(c.length).toBeGreaterThan(1);
    for (const x of c) expect(x.score).toBeLessThan(0.6);
  });
});

describe('matchPerson — Signal 2 (program_of_record)', () => {
  const pes: PeRow[] = [{ peCode: '0605051A', title: 'Aircraft Survivability Equipment' }];
  const { peIndex, byNormTitle } = buildIndex(pes);

  test('matches a strong program_of_record, service-aware', () => {
    const person: PersonRow = { id: 'p5', service: 'ARMY', organization: 'Army', peTitle: null, programOfRecord: 'Aircraft Survivability Equipment' };
    const c = svc.matchPerson(person, peIndex, byNormTitle, []);
    expect(c).toHaveLength(1);
    expect(c[0]!.peCode).toBe('0605051A');
    expect(c[0]!.breakdown.signal).toMatch(/^2_/);
  });

  test('rejects short/fragment program_of_record (precision guard)', () => {
    const person: PersonRow = { id: 'p6', service: 'AF', organization: 'AF', peTitle: null, programOfRecord: '•C2' };
    const c = svc.matchPerson(person, peIndex, byNormTitle, []);
    expect(c).toHaveLength(0);
  });

  test('rejects a service mismatch', () => {
    const person: PersonRow = { id: 'p7', service: 'NAVY', organization: 'Navy', peTitle: null, programOfRecord: 'Aircraft Survivability Equipment' };
    const c = svc.matchPerson(person, peIndex, byNormTitle, []);
    expect(c).toHaveLength(0); // 0605051A is ARMY; NAVY person -> mismatch dropped
  });
});
