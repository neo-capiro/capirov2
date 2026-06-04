import { buildRecord, importDowDirectoryV6, DOW_V6_SOURCE, DowV6PersonJson } from './dow-directory-v6-importer.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('dow-directory-v6-importer', () => {
  describe('buildRecord', () => {
    it('packs programs + managing section into programOfRecord for PE matching', () => {
      const p: DowV6PersonJson = {
        full_name: 'LTC Bryan Kelso',
        title: 'Product Manager, Soldier Weapons',
        role: 'PM',
        service: 'ARMY',
        organization: 'Capability Program Executive (CPE): Maneuver - Ground',
        sub_organization: 'Soldier Weapons (PdM SW)',
        programs_mentioned: ['XM7 Next Generation Squad Weapon - Rifle', 'XM250 NGSW Automatic Rifle', 'MK22 Precision Sniper Rifle (PSR)'],
        public_profile_url: 'https://www.linkedin.com/in/bryan-kelso-123/',
        link_type: 'linkedin',
        source_page: 129,
        source_section: 'Capability Program Executive (CPE): Maneuver - Ground',
      };
      const r = buildRecord(p);
      expect(r.fullName).toBe('LTC Bryan Kelso');
      expect(r.service).toBe('ARMY');
      expect(r.programs).toEqual([
        'XM7 Next Generation Squad Weapon - Rifle',
        'XM250 NGSW Automatic Rifle',
        'MK22 Precision Sniper Rifle (PSR)',
      ]);
      // distinctive program tokens (XM7, XM250, MK22) must be present for the matcher
      expect(r.programOfRecord).toContain('XM7');
      expect(r.programOfRecord).toContain('MK22');
      expect(r.publicProfileUrl).toBe('https://www.linkedin.com/in/bryan-kelso-123/');
      // sub-org folded into organization (more specific first)
      expect(r.organization).toContain('Soldier Weapons (PdM SW)');
    });

    it('rejects non-http profile links', () => {
      const r = buildRecord({ full_name: 'Jane Doe', public_profile_url: 'mailto:x@y.mil' });
      expect(r.publicProfileUrl).toBeNull();
    });

    it('maps unknown service to null, known service through', () => {
      expect(buildRecord({ full_name: 'A B', service: 'AF' }).service).toBe('AF');
      expect(buildRecord({ full_name: 'A B', service: 'WEIRD' }).service).toBeNull();
    });
  });

  describe('importDowDirectoryV6', () => {
    function tmpJson(rows: DowV6PersonJson[]): string {
      const f = path.join(os.tmpdir(), `dowv6-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(f, JSON.stringify(rows));
      return f;
    }

    it('inserts new people, skips vacancies, and is idempotent on re-run', async () => {
      const rows: DowV6PersonJson[] = [
        { full_name: 'LTC Bryan Kelso', title: 'PM Soldier Weapons', programs_mentioned: ['XM7'] },
        { full_name: 'Vacant', title: 'Project Lead International Ground', status: 'vacant' },
        { full_name: 'Andrew T. Clements', title: 'CPE Ground', service: 'ARMY' },
      ];
      const file = tmpJson(rows);

      const db = new Map<string, { id: string }>();
      let nextId = 1;
      const calls = { insert: 0, mention: 0 };
      const writer = {
        upsertPerson: async (rec: { fullName: string }) => {
          calls.insert += 1;
          const id = `id-${nextId++}`;
          db.set(rec.fullName, { id });
          return { inserted: true, person_id: id };
        },
        addSourceMention: async () => { calls.mention += 1; return true; },
        quarantine: async () => undefined,
      };

      const existingPersonByKey = new Map<string, string>();
      const first = await importDowDirectoryV6(file, { writer, existingPersonByKey });
      expect(first.persons_scanned).toBe(2); // Vacant skipped
      expect(first.persons_inserted).toBe(2);
      expect(first.persons_with_programs).toBe(1);

      // Re-run with same shared map => no new inserts, only mentions.
      const second = await importDowDirectoryV6(file, { writer, existingPersonByKey });
      expect(second.persons_inserted).toBe(0);
      expect(second.persons_addSourceMentioned).toBe(2);

      fs.unlinkSync(file);
    });

    it('uses DOW_V6_SOURCE as the source string', async () => {
      const file = tmpJson([{ full_name: 'Test Person', title: 'Director' }]);
      let capturedSource = '';
      const writer = {
        upsertPerson: async (_r: unknown, source: string) => { capturedSource = source; return { inserted: true, person_id: 'x' }; },
        addSourceMention: async () => true,
        quarantine: async () => undefined,
      };
      await importDowDirectoryV6(file, { writer, existingPersonByKey: new Map() });
      expect(capturedSource).toBe(DOW_V6_SOURCE);
      expect(DOW_V6_SOURCE).toBe('dow_directory_rev6_2026_06');
      fs.unlinkSync(file);
    });
  });
});
