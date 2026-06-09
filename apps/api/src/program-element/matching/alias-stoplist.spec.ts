import { isGenericAlias } from './alias-stoplist.js';

describe('isGenericAlias', () => {
  it('flags shared accounting categories (the false-positive sources)', () => {
    for (const g of [
      'CONGRESSIONAL ADDS',
      'CONGRESSIONAL ADD',
      'CONGRESSIONAL ADD AIRCRAFT SURVIVABILITY EQUIPMENT',
      'CONGRESSIONALLY DIRECTED MEDICAL RESEARCH',
      'PROGRAM WIDE SUPPORT',
      'PROGRAMWIDE ACTIVITIES',
      'PROGRAM MANAGEMENT ADMINISTRATION',
      'MANAGEMENT SUPPORT',
      'MISSION SUPPORT',
      'STUDIES AND ANALYSIS',
      'SMALL BUSINESS INNOVATION RESEARCH',
      'SBIR',
      'STTR',
      'SBIR STTR',
      'MISCELLANEOUS',
      'CLASSIFIED PROGRAMS',
      'COMMON',
      'ENTERPRISE',
      '',
      '   ',
    ]) {
      expect(isGenericAlias(g)).toBe(true);
    }
  });

  it('does NOT flag real programs that merely contain or resemble a generic token', () => {
    for (const real of [
      'SBIRS', // Space-Based Infrared System — must survive (not 'SBIR')
      'SBIRS HIGH',
      'COMMON MISSILE WARNING SYSTEM', // CMWS — 'COMMON' only generic as whole string
      'ENTERPRISE GROUND SERVICES', // EGS — real program
      'GENERAL ATOMICS MQ-9',
      'MQ-8 FIRE SCOUT',
      'TRIDENT II D5',
      'NEXT GEN OPIR GEO',
      'AIR AND MISSILE DEFENSE RADAR',
      'GROUND AIR TASK ORIENTED RADAR',
      'PATRIOT',
      'SUPPORT EQUIPMENT AND FACILITIES', // not exactly 'SUPPORT'
    ]) {
      expect(isGenericAlias(real)).toBe(false);
    }
  });
});
