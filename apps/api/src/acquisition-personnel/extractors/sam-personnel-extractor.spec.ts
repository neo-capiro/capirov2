import { describe, expect, test } from '@jest/globals';
import {
  SamPersonnelExtractorService,
  emailToDomain,
  inferRole,
  hasFirstAndLast,
  type SamOpportunity,
} from './sam-personnel-extractor.service.js';

const svc = new SamPersonnelExtractorService();
const knownPes = new Set(['0604201A']);

function opp(over: Partial<SamOpportunity> = {}): SamOpportunity {
  return {
    noticeId: 'abc123',
    title: 'Aircraft Sustainment Services',
    description: 'Work supports PE 0604201A and program of record. Contact below.',
    fullParentPathName: 'DEPT OF DEFENSE.DEPT OF THE ARMY.ARMY CONTRACTING COMMAND',
    department: 'DEPT OF DEFENSE',
    pointOfContact: [
      { fullName: 'Jane A. Smith', title: 'Contracting Officer', email: 'jane.a.smith@army.mil', type: 'primary' },
      { fullName: 'Bob Jones', title: 'Contract Specialist', email: 'bob.jones@army.mil', type: 'secondary' },
    ],
    uiLink: 'https://sam.gov/opp/abc123/view',
    ...over,
  };
}

describe('emailToDomain — NEVER returns a full email', () => {
  test('extracts domain only', () => {
    expect(emailToDomain('jane.a.smith@army.mil')).toBe('army.mil');
    expect(emailToDomain('mailto:x@navy.mil')).toBe('navy.mil');
  });
  test('non-emails return null (no guessing)', () => {
    expect(emailToDomain('Jane Smith')).toBeNull();
    expect(emailToDomain('')).toBeNull();
    expect(emailToDomain(null)).toBeNull();
  });
});

describe('inferRole', () => {
  test('maps titles', () => {
    expect(inferRole('Contracting Officer')).toBe('KO');
    expect(inferRole('Contract Specialist')).toBe('CS');
    expect(inferRole("Contracting Officer's Representative")).toBe('COR');
    expect(inferRole('Buyer')).toBe('OTHER');
    expect(inferRole(null)).toBeNull();
  });
});

describe('SamPersonnelExtractorService.extract', () => {
  test('sample solicitation → KO + Contract Specialist extracted with email_domain (NO full email)', () => {
    const people = svc.extract(opp(), knownPes);
    expect(people).toHaveLength(2);

    const ko = people.find((p) => p.role === 'KO');
    const cs = people.find((p) => p.role === 'CS');
    expect(ko?.fullName).toBe('Jane A. Smith');
    expect(ko?.emailDomain).toBe('army.mil');
    expect(cs?.fullName).toBe('Bob Jones');
    expect(cs?.emailDomain).toBe('army.mil');

    // CRITICAL: no field anywhere contains a full email address.
    const serialized = JSON.stringify(people);
    expect(serialized).not.toMatch(/@army\.mil/);
    expect(serialized).not.toMatch(/jane\.a\.smith/);
    expect(serialized).not.toMatch(/bob\.jones/);
  });

  test('PE attribution from description against known set', () => {
    const people = svc.extract(opp(), knownPes);
    expect(people[0]?.pePrimary).toBe('0604201A');
  });

  test('unknown PE in description ignored', () => {
    const people = svc.extract(opp({ description: 'mentions 0609999Z only' }), knownPes);
    expect(people[0]?.pePrimary).toBeNull();
  });

  test('POC without a valid first+last name is dropped', () => {
    const people = svc.extract(opp({ pointOfContact: [{ fullName: 'Smith', title: 'KO', email: 'x@army.mil' }] }), knownPes);
    expect(people).toHaveLength(0);
  });

  test('isDod recognizes DoD org paths', () => {
    expect(svc.isDod(opp())).toBe(true);
    expect(svc.isDod(opp({ fullParentPathName: 'DEPT OF AGRICULTURE', department: 'USDA' }))).toBe(false);
  });

  test('deterministic / idempotent — same input, same output', () => {
    expect(JSON.stringify(svc.extract(opp(), knownPes))).toBe(JSON.stringify(svc.extract(opp(), knownPes)));
  });
});
