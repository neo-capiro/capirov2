import {
  FP_UNSPECIFIED,
  isSentinel,
  normalizeRecord,
  parseCsv,
  parseForeignPrincipalFeed,
  groupEnrichments,
  resolveEnrichmentUpdate,
} from './fara-enrichment';

describe('fara-enrichment', () => {
  describe('isSentinel', () => {
    it('treats null/empty/sentinel as sentinel, real values as not', () => {
      expect(isSentinel(null)).toBe(true);
      expect(isSentinel('')).toBe(true);
      expect(isSentinel('   ')).toBe(true);
      expect(isSentinel(FP_UNSPECIFIED)).toBe(true);
      expect(isSentinel('Government of Japan')).toBe(false);
    });
  });

  describe('normalizeRecord', () => {
    it('maps PascalCase / spaced / snake header variants', () => {
      expect(
        normalizeRecord({
          'Registration Number': '1234',
          'Foreign Principal': 'Acme SA',
          'Foreign Principal Country': 'France',
        }),
      ).toEqual({
        registrationNumber: '1234',
        foreignPrincipalName: 'Acme SA',
        country: 'France',
        status: null,
        terminationDate: null,
      });
      expect(
        normalizeRecord({ registration_number: '9', fp_name: 'X', fp_country: 'Spain' })?.country,
      ).toBe('Spain');
    });
    it('returns null without a registration number', () => {
      expect(normalizeRecord({ foreignPrincipal: 'orphan' })).toBeNull();
    });
  });

  describe('parseCsv', () => {
    it('parses quoted fields, embedded commas, and CRLF', () => {
      const csv =
        'Registration Number,Foreign Principal,Foreign Principal Country\r\n6443,"Mubadala, Inc.",United Arab Emirates\r\n';
      const rows = parseCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]!['Foreign Principal']).toBe('Mubadala, Inc.');
      expect(rows[0]!['Foreign Principal Country']).toBe('United Arab Emirates');
    });
    it('drops blank lines and returns [] when only a header exists', () => {
      expect(parseCsv('a,b\n')).toEqual([]);
    });
  });

  describe('parseForeignPrincipalFeed', () => {
    it('parses a JSON array', () => {
      const raw = JSON.stringify([
        { registrationNumber: '1', foreignPrincipal: 'Gov of Japan', country: 'Japan' },
      ]);
      const rows = parseForeignPrincipalFeed(raw, 'application/json');
      expect(rows).toEqual([
        {
          registrationNumber: '1',
          foreignPrincipalName: 'Gov of Japan',
          country: 'Japan',
          status: null,
          terminationDate: null,
        },
      ]);
    });
    it('parses the eFile { WRAPPER: { ROW: [...] } } envelope', () => {
      const raw = JSON.stringify({
        FOREIGN_PRINCIPALS: {
          ROW: [{ Registration_Number: '7', Foreign_Principal: 'KOTRA', Country: 'South Korea' }],
        },
      });
      const rows = parseForeignPrincipalFeed(raw);
      expect(rows[0]!).toMatchObject({
        registrationNumber: '7',
        foreignPrincipalName: 'KOTRA',
        country: 'South Korea',
      });
    });
    it('falls back to CSV when content is not JSON', () => {
      const rows = parseForeignPrincipalFeed(
        'Registration Number,Foreign Principal\n42,Embassy of Qatar\n',
      );
      expect(rows[0]!).toMatchObject({
        registrationNumber: '42',
        foreignPrincipalName: 'Embassy of Qatar',
      });
    });
    it('never throws on empty/garbage input', () => {
      expect(parseForeignPrincipalFeed('')).toEqual([]);
      expect(parseForeignPrincipalFeed('<html>nope</html>')).toEqual([]);
    });
  });

  describe('groupEnrichments', () => {
    it('de-dupes principals (case-insensitive) and joins; picks most-frequent country', () => {
      const rows = [
        { registrationNumber: '5', foreignPrincipalName: 'Gov of Japan', country: 'Japan' },
        { registrationNumber: '5', foreignPrincipalName: 'gov of japan', country: 'Japan' }, // dup name
        { registrationNumber: '5', foreignPrincipalName: 'Toyota', country: 'Japan' },
        { registrationNumber: '5', foreignPrincipalName: 'Acme', country: 'France' },
      ];
      const g = groupEnrichments(rows).get('5')!;
      expect(g.foreignPrincipal).toBe('Gov of Japan; Toyota; Acme');
      expect(g.country).toBe('Japan'); // 3x Japan vs 1x France
    });
    it('emits the sentinel when a registrant has rows but no named principal', () => {
      const g = groupEnrichments([
        { registrationNumber: '8', foreignPrincipalName: null, country: 'Canada' },
      ]).get('8')!;
      expect(g.foreignPrincipal).toBe(FP_UNSPECIFIED);
      expect(g.country).toBe('Canada');
    });
  });

  describe('resolveEnrichmentUpdate', () => {
    const enrich = {
      registrationNumber: '1',
      foreignPrincipal: 'Gov of Japan',
      country: 'Japan',
      status: 'Active',
      terminationDate: null,
    };

    it('fills foreign principal + country when the existing row is a sentinel', () => {
      const upd = resolveEnrichmentUpdate(
        { foreignPrincipal: FP_UNSPECIFIED, country: null, status: null, terminationDate: null },
        enrich,
      );
      expect(upd).not.toBeNull();
      expect(upd!.foreignPrincipal).toBe('Gov of Japan');
      expect(upd!.country).toBe('Japan');
    });

    it('does NOT clobber an existing real foreign principal without force', () => {
      const upd = resolveEnrichmentUpdate(
        {
          foreignPrincipal: 'Hand-verified Principal',
          country: 'Japan',
          status: 'Active',
          terminationDate: null,
        },
        enrich,
      );
      expect(upd).toBeNull(); // FP already real, country/status already set -> nothing to change
    });

    it('overwrites a real foreign principal when force=true', () => {
      const upd = resolveEnrichmentUpdate(
        { foreignPrincipal: 'Stale Principal', country: null, status: null, terminationDate: null },
        enrich,
        { force: true },
      );
      expect(upd!.foreignPrincipal).toBe('Gov of Japan');
    });

    it('fills only the empty country, preserving a real existing principal', () => {
      const upd = resolveEnrichmentUpdate(
        { foreignPrincipal: 'Real Principal', country: null, status: null, terminationDate: null },
        enrich,
      );
      expect(upd).not.toBeNull();
      expect(upd!.country).toBe('Japan'); // filled
      expect(upd!.foreignPrincipal).toBe('Real Principal'); // preserved
    });

    it('treats a brand-new registration (no existing row) as fillable', () => {
      const upd = resolveEnrichmentUpdate(null, enrich);
      expect(upd!.foreignPrincipal).toBe('Gov of Japan');
      expect(upd!.country).toBe('Japan');
    });

    it('returns null when the enrichment has no real data to add', () => {
      const empty = {
        registrationNumber: '1',
        foreignPrincipal: FP_UNSPECIFIED,
        country: null,
        status: null,
        terminationDate: null,
      };
      expect(
        resolveEnrichmentUpdate(
          { foreignPrincipal: FP_UNSPECIFIED, country: null, status: null, terminationDate: null },
          empty,
        ),
      ).toBeNull();
    });
  });
});
