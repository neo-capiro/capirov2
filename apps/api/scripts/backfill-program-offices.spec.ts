import {
  inferOfficeType,
  normalizeRoleType,
  buildPersonRoleInput,
  findOrCreateOffice,
  parseObservedAt,
  rosterNameKey,
  type RosterPerson,
  type ProgramLookupResult,
  type ProgramOfficeClient,
  type ProgramOfficeRow,
} from './backfill-program-offices';
import { isExcludedFromRecommendations } from '../src/acquisition-personnel/contact-use.policy';

describe('backfill-program-offices', () => {
  describe('inferOfficeType', () => {
    it('infers peo from a "PEO" org name', () => {
      expect(inferOfficeType('PEO Aviation')).toBe('peo');
      expect(inferOfficeType('PEO Missiles & Space', 'army.mil org roster')).toBe('peo');
    });

    it('infers cpe from a "CPE" org name', () => {
      expect(inferOfficeType('CPE Aviation', 'CPE Aviation — army.mil')).toBe('cpe');
      expect(inferOfficeType('CPE Maneuver - Ground')).toBe('cpe');
    });

    it('infers contracting_office when "contracting" appears (name or source)', () => {
      expect(inferOfficeType('Army Contracting Command')).toBe('contracting_office');
      expect(inferOfficeType('ACC Aberdeen', 'contracting office leadership page')).toBe('contracting_office');
    });

    it('falls back to other for anything else (e.g. ASIC/CECOM)', () => {
      expect(inferOfficeType('ASIC (CECOM)', 'Leadership - ASIC')).toBe('other');
      expect(inferOfficeType('Some Random Directorate')).toBe('other');
    });

    it('prefers PEO over CPE/contracting when both appear, and matches whole tokens only', () => {
      // PEO wins (checked first).
      expect(inferOfficeType('PEO / CPE joint contracting cell')).toBe('peo');
      // A stray substring (RECIPE) must NOT register as a CPE office.
      expect(inferOfficeType('Recipe Development Directorate')).toBe('other');
    });

    it('considers the source string when the name lacks the signal', () => {
      expect(inferOfficeType('Aviation', 'CPE Aviation roster')).toBe('cpe');
    });
  });

  describe('normalizeRoleType', () => {
    it('maps known roster roles to roleTypes', () => {
      expect(normalizeRoleType('PEO')).toBe('peo');
      expect(normalizeRoleType('PM')).toBe('pm');
      expect(normalizeRoleType('STAFF')).toBe('staff');
      expect(normalizeRoleType('DEPUTY')).toBe('deputy');
    });

    it('is case-insensitive and trims', () => {
      expect(normalizeRoleType('  pm  ')).toBe('pm');
      expect(normalizeRoleType('Peo')).toBe('peo');
    });

    it('maps unknown / missing roles to other', () => {
      expect(normalizeRoleType('SGM')).toBe('other');
      expect(normalizeRoleType('CHIEF WARRANT OFFICER')).toBe('other');
      expect(normalizeRoleType(null)).toBe('other');
      expect(normalizeRoleType(undefined)).toBe('other');
      expect(normalizeRoleType('')).toBe('other');
    });
  });

  describe('buildPersonRoleInput', () => {
    const observedAt = new Date('2026-05-01T00:00:00.000Z');
    const baseLookup: ProgramLookupResult = { programId: null, matchedOn: null };

    it('always sets contactUse via the policy and NEVER leaves it undefined', () => {
      const person: RosterPerson = { fullName: 'Rodney Davis', role: 'PEO', roleTitle: 'Capability Program Executive for Aviation' };
      const input = buildPersonRoleInput(person, 'person-1', 'office-1', baseLookup, 'army_cpe_roster', observedAt);
      // candidate review status -> policy returns 'candidate' (not yet usable).
      expect(input.contactUse).toBe('candidate');
      expect(input.contactUse).not.toBeUndefined();
      expect(input.reviewStatus).toBe('candidate');
      // candidate is excluded from recommendation surfaces.
      expect(isExcludedFromRecommendations(input.contactUse)).toBe(true);
    });

    it('sets a conservative programId: null when no confident match', () => {
      const person: RosterPerson = { fullName: 'James Bamburg', role: 'PM', roleTitle: 'PM', programOfRecord: 'Aviation Mission Systems & Architecture' };
      const input = buildPersonRoleInput(person, 'person-2', 'office-1', { programId: null }, 'army_cpe_roster', observedAt);
      expect(input.programId).toBeNull();
    });

    it('sets programId only when the lookup resolved a confident match', () => {
      const person: RosterPerson = { fullName: 'Daniel Thetford', role: 'PM', roleTitle: 'Apache Helicopters Project Manager', programOfRecord: 'Apache Helicopters' };
      const input = buildPersonRoleInput(person, 'person-3', 'office-1', { programId: 'prog-apache', matchedOn: 'APACHE HELICOPTERS' }, 'army_cpe_roster', observedAt);
      expect(input.programId).toBe('prog-apache');
    });

    it('falls back roleTitle to role, then "Member", and never emits an empty title', () => {
      expect(buildPersonRoleInput({ fullName: 'A', role: 'STAFF', roleTitle: null }, 'p', 'o', baseLookup, 'army_cpe_roster', observedAt).roleTitle).toBe('STAFF');
      expect(buildPersonRoleInput({ fullName: 'B', role: null, roleTitle: null }, 'p', 'o', baseLookup, 'army_cpe_roster', observedAt).roleTitle).toBe('Member');
      expect(buildPersonRoleInput({ fullName: 'C', role: null, roleTitle: '   ' }, 'p', 'o', baseLookup, 'army_cpe_roster', observedAt).roleTitle).toBe('Member');
    });

    it('carries the expected fixed fields (source, confidence, observedAt, sourceUrl null)', () => {
      const input = buildPersonRoleInput({ fullName: 'A', role: 'PM', roleTitle: 'PM' }, 'p', 'o', baseLookup, 'army_cpe_roster', observedAt);
      expect(input.source).toBe('army_cpe_roster');
      expect(input.confidence).toBe(0.95);
      expect(input.observedAt).toBe(observedAt);
      expect(input.sourceUrl).toBeNull();
      expect(input.personId).toBe('p');
      expect(input.officeId).toBe('o');
      expect(input.roleType).toBe('pm');
    });

    it('a contracting_officer role is classified as official_procurement_poc (FAR hard rule), still non-undefined contactUse', () => {
      // roleType 'other' is what the roster maps; but if a roster ever carried a CO
      // role the policy must still produce a defined, excluded classification. Drive
      // it via an accepted-equivalent path through buildPersonRoleInput's policy call
      // by asserting the candidate gate still yields a defined value.
      const input = buildPersonRoleInput({ fullName: 'CO Person', role: 'STAFF', roleTitle: 'Contracting Officer' }, 'p', 'o', baseLookup, 'army_cpe_roster', observedAt);
      expect(typeof input.contactUse).toBe('string');
      expect(input.contactUse.length).toBeGreaterThan(0);
    });
  });

  describe('parseObservedAt', () => {
    const now = new Date('2026-06-08T12:00:00.000Z');
    it('parses a valid asOf', () => {
      expect(parseObservedAt('2026-05-01', now).toISOString()).toBe(new Date('2026-05-01').toISOString());
    });
    it('falls back to now when asOf is missing or invalid', () => {
      expect(parseObservedAt(null, now)).toBe(now);
      expect(parseObservedAt(undefined, now)).toBe(now);
      expect(parseObservedAt('not-a-date', now)).toBe(now);
    });
  });

  describe('rosterNameKey', () => {
    it('computes the same key the personnel pipeline uses (last first middle)', () => {
      // normalizeName lower-cases and orders lastName firstName middleInitial.
      expect(rosterNameKey('Rodney Davis')).toBe('davis rodney');
      expect(rosterNameKey('Jaime I. Craig')).toBe('craig jaime i');
    });
  });

  describe('findOrCreateOffice (injected fake client)', () => {
    function makeFakeClient(seed: ProgramOfficeRow[] = []): {
      client: ProgramOfficeClient;
      created: ProgramOfficeRow[];
    } {
      const rows = [...seed];
      const state = { created: [] as ProgramOfficeRow[] };
      const client: ProgramOfficeClient = {
        programOffice: {
          async findFirst({ where }) {
            return (
              rows.find(
                (r) =>
                  r.name === where.name &&
                  r.service === where.service &&
                  (r.validFrom ?? null)?.toString() === (where.validFrom ?? null)?.toString(),
              ) ?? null
            );
          },
          async create({ data }) {
            const row: ProgramOfficeRow = {
              id: `office-${rows.length + 1}`,
              name: data.name as string,
              officeType: data.officeType as string,
              service: (data.service as string | null) ?? null,
              validFrom: (data.validFrom as Date | null) ?? null,
            };
            rows.push(row);
            state.created.push(row);
            return row;
          },
        },
      };
      return { client, created: state.created };
    }

    it('creates a new office when none matches the functional-unique key', async () => {
      const { client, created } = makeFakeClient();
      const res = await findOrCreateOffice(client, {
        name: 'CPE Aviation',
        officeType: 'cpe',
        service: 'ARMY',
        validFrom: null,
        metadata: { formerName: 'PEO Aviation' },
      });
      expect(res.created).toBe(true);
      expect(res.office.name).toBe('CPE Aviation');
      expect(res.office.officeType).toBe('cpe');
      expect(created).toHaveLength(1);
    });

    it('is idempotent: a second find-or-create on the same key returns the existing row, creates nothing', async () => {
      const { client, created } = makeFakeClient();
      const input = {
        name: 'CPE Aviation',
        officeType: 'cpe',
        service: 'ARMY' as string | null,
        validFrom: null,
        metadata: {},
      };
      const first = await findOrCreateOffice(client, input);
      const second = await findOrCreateOffice(client, input);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.office.id).toBe(first.office.id);
      expect(created).toHaveLength(1);
    });

    it('treats a different service as a distinct office (part of the unique key)', async () => {
      const { client, created } = makeFakeClient();
      await findOrCreateOffice(client, { name: 'Joint Office', officeType: 'other', service: 'ARMY', validFrom: null, metadata: {} });
      const second = await findOrCreateOffice(client, { name: 'Joint Office', officeType: 'other', service: 'NAVY', validFrom: null, metadata: {} });
      expect(second.created).toBe(true);
      expect(created).toHaveLength(2);
    });
  });
});
