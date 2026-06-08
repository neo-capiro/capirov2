import { buildWhyShown, WhyShownInput } from './person-role-why-shown';

describe('buildWhyShown', () => {
  const base: WhyShownInput = {
    roleTitle: 'Program Manager',
    roleType: 'pm',
    officeName: 'PEO Aviation',
    programName: 'FLRAA',
    officeManagesProgram: true,
    programMappedToPe: true,
    peCode: '0604802A',
  };

  it('renders the FULL chain: role at office; office manages program; program maps to PE', () => {
    const result = buildWhyShown(base);
    expect(result).toBe(
      'Program Manager at PEO Aviation; office manages FLRAA; FLRAA maps to PE 0604802A',
    );
  });

  it('renders the full chain without a peCode (maps to "this PE")', () => {
    const result = buildWhyShown({ ...base, peCode: undefined });
    expect(result).toBe(
      'Program Manager at PEO Aviation; office manages FLRAA; FLRAA maps to this PE',
    );
  });

  it('MISSING office hop: role with no resolved office names the missing office hop', () => {
    const result = buildWhyShown({
      ...base,
      officeName: null,
    });
    expect(result).toBe('Program Manager, but no office resolved for this role yet');
  });

  it('MISSING office->program hop: role at office but no accepted office->program link', () => {
    const result = buildWhyShown({
      ...base,
      officeManagesProgram: false,
      programName: null,
    });
    expect(result).toBe(
      'Program Manager at PEO Aviation, but no accepted office->program link yet',
    );
  });

  it('MISSING office->program hop: link flag false even when a program name is present', () => {
    const result = buildWhyShown({
      ...base,
      officeManagesProgram: false,
    });
    expect(result).toBe(
      'Program Manager at PEO Aviation, but no accepted office->program link yet',
    );
  });

  it('MISSING program->PE hop: office manages program but program not mapped to this PE', () => {
    const result = buildWhyShown({
      ...base,
      programMappedToPe: false,
    });
    expect(result).toBe(
      'Program Manager at PEO Aviation; office manages FLRAA, but no program mapped to this PE yet',
    );
  });

  it('LEGACY fallback: no role chain, shown via the legacy pe_primary source', () => {
    const result = buildWhyShown({
      roleTitle: 'Program Manager',
      roleType: 'pm',
      legacySource: 'dow_directory_rev6_2026_06',
    });
    expect(result).toBe(
      'Listed on this PE via dow_directory_rev6_2026_06 (role mapping pending review)',
    );
  });

  it('LEGACY fallback takes priority over any partial chain pieces present', () => {
    const result = buildWhyShown({
      ...base,
      legacySource: 'pe_match_confirmed',
    });
    expect(result).toBe('Listed on this PE via pe_match_confirmed (role mapping pending review)');
  });

  it('falls back to a generic role label when roleTitle is blank', () => {
    const result = buildWhyShown({
      roleTitle: '   ',
      roleType: 'other',
      officeName: null,
    });
    expect(result).toBe('Role, but no office resolved for this role yet');
  });

  it('NEVER uses the phrase "owns PE" for any chain state', () => {
    const variants: WhyShownInput[] = [
      base,
      { ...base, peCode: undefined },
      { ...base, officeName: null },
      { ...base, officeManagesProgram: false, programName: null },
      { ...base, programMappedToPe: false },
      { roleTitle: 'PM', roleType: 'pm', legacySource: 'dow_directory_rev6_2026_06' },
    ];
    for (const v of variants) {
      const out = buildWhyShown(v).toLowerCase();
      expect(out).not.toContain('owns pe');
      expect(out).not.toContain('owns this pe');
    }
  });
});
