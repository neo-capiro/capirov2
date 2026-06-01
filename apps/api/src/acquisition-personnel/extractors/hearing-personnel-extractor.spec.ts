import { describe, expect, test } from '@jest/globals';
import {
  HearingPersonnelExtractorService,
  HEARING_WITNESS_CONFIDENCE,
  type HearingInput,
} from './hearing-personnel-extractor.service.js';

const svc = new HearingPersonnelExtractorService();

function hearing(over: Partial<HearingInput> = {}): HearingInput {
  return {
    committeeName: 'House Armed Services Committee',
    committeeCode: 'AS00',
    title: 'Fiscal Year 2027 Budget Request for Army Modernization',
    date: new Date('2026-03-15T00:00:00Z'),
    url: 'https://armedservices.house.gov/hearings/fy27',
    witnesses: [],
    ...over,
  };
}

describe('isDefenseCommittee', () => {
  test('matches HASC/SASC by name', () => {
    expect(svc.isDefenseCommittee('House Armed Services Committee', null)).toBe(true);
    expect(svc.isDefenseCommittee('Senate Armed Services Committee', null)).toBe(true);
    expect(svc.isDefenseCommittee('SASC', null)).toBe(true);
  });
  test('matches defense appropriations subcommittees', () => {
    expect(svc.isDefenseCommittee('Defense Subcommittee, Committee on Appropriations', null)).toBe(true);
    expect(svc.isDefenseCommittee('Appropriations Subcommittee on Defense', null)).toBe(true);
  });
  test('matches by committee code when name is generic', () => {
    expect(svc.isDefenseCommittee('Committee on Appropriations', 'SSAS')).toBe(true);
  });
  test('rejects unrelated committees', () => {
    expect(svc.isDefenseCommittee('Committee on Agriculture', 'AG00')).toBe(false);
    expect(svc.isDefenseCommittee('House Committee on the Judiciary', null)).toBe(false);
  });
});

describe('parseWitness', () => {
  test('splits name / title / organization', () => {
    const r = svc.parseWitness('Hon. Jane Smith, Under Secretary of Defense, Department of Defense');
    expect(r.fullName).toBe('Hon. Jane Smith');
    expect(r.title).toBe('Under Secretary of Defense');
    expect(r.organization).toBe('Department of Defense');
  });
  test('name only when no comma', () => {
    const r = svc.parseWitness('General John Doe');
    expect(r.fullName).toBe('General John Doe');
    expect(r.title).toBeNull();
  });
});

describe('HearingPersonnelExtractorService.extractFromHearing', () => {
  test('hearing with DoD witnesses → extracted', () => {
    const out = svc.extractFromHearing(
      hearing({
        witnesses: [
          'Hon. Jane Smith, Under Secretary of Defense for Acquisition and Sustainment, Department of Defense',
          'General Mark Jones, Chief of Staff, U.S. Army',
        ],
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.fullName).toBe('Hon. Jane Smith');
    expect(out[0]?.confidence).toBe(HEARING_WITNESS_CONFIDENCE);
    expect(out[0]?.snippet).toContain('testified at');
    expect(out[0]?.snippet).toContain('2026-03-15');
    expect(out[0]?.observedAt).toEqual(hearing().date);
    expect(out[0]?.sourceUrl).toBe(hearing().url);
  });

  test('hearing with NO DoD witnesses → no-op (empty)', () => {
    const out = svc.extractFromHearing(
      hearing({
        witnesses: [
          'Dr. Alice Brown, Professor, Stanford University',
          'Bob Green, CEO, Acme Robotics Inc.',
        ],
      }),
    );
    expect(out).toHaveLength(0);
  });

  test('non-defense committee → no-op even with DoD witnesses', () => {
    const out = svc.extractFromHearing(
      hearing({
        committeeName: 'Committee on Agriculture',
        committeeCode: 'AG00',
        witnesses: ['Hon. Jane Smith, Under Secretary, Department of Defense'],
      }),
    );
    expect(out).toHaveLength(0);
  });

  test('mixed witnesses → only DoD-affiliated kept', () => {
    const out = svc.extractFromHearing(
      hearing({
        witnesses: [
          'Dr. Alice Brown, Professor, Stanford University', // non-DoD
          'General Mark Jones, Chief of Staff, U.S. Army', // DoD
        ],
      }),
    );
    expect(out.map((p) => p.fullName)).toEqual(['General Mark Jones']);
  });

  test('invalid names dropped (no last name)', () => {
    const out = svc.extractFromHearing(
      hearing({ witnesses: ['Smith, Secretary, Department of Defense'] }),
    );
    expect(out).toHaveLength(0);
  });

  test('de-dups same witness listed twice in one hearing', () => {
    const out = svc.extractFromHearing(
      hearing({
        witnesses: [
          'General Mark Jones, Chief of Staff, U.S. Army',
          'General Mark Jones, Chief of Staff, U.S. Army',
        ],
      }),
    );
    expect(out).toHaveLength(1);
  });

  test('idempotency: observedAt mirrors hearing date (writer dedup key)', () => {
    const h = hearing({ witnesses: ['General Mark Jones, Chief of Staff, U.S. Army'] });
    const out = svc.extractFromHearing(h);
    expect(out[0]?.observedAt).toEqual(h.date);
  });
});
