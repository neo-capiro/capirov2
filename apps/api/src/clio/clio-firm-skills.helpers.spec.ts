import { describe, expect, test } from '@jest/globals';
import { mergeSkills, validateFirmSkill } from './clio-firm-skills.helpers.js';
import type { ClioSkill } from './skills/skill.types.js';

const ALLOWED = ['query_intelligence', 'search_congress_bills', 'search_public_web'];

const valid = {
  id: 'whip_count',
  name: 'Whip Count',
  triggers: ['whip_count'],
  systemAddendum: 'Estimate the vote count and per-member leanings with sources.',
  requiredTools: ['query_intelligence', 'search_public_web'],
  template: { heading: 'Whip Count', sections: ['Yes', 'No', 'Undecided'] },
};

describe('validateFirmSkill', () => {
  test('accepts a well-formed skill', () => {
    const r = validateFirmSkill(valid, ALLOWED);
    expect(r.ok).toBe(true);
    expect(r.skill?.id).toBe('whip_count');
    expect(r.skill?.requiredTools).toEqual(['query_intelligence', 'search_public_web']);
  });

  test('rejects a bad id', () => {
    expect(validateFirmSkill({ ...valid, id: 'Bad ID!' }, ALLOWED).ok).toBe(false);
  });

  test('rejects unknown tools (not in the allowlist)', () => {
    const r = validateFirmSkill({ ...valid, requiredTools: ['delete_everything'] }, ALLOWED);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('unknown tools');
  });

  test('rejects claiming a reserved built-in trigger', () => {
    const r = validateFirmSkill({ ...valid, triggers: ['generate_briefing'] }, ALLOWED);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('reserved');
  });

  test('requires name + systemAddendum + at least one trigger', () => {
    expect(validateFirmSkill({ ...valid, name: '' }, ALLOWED).ok).toBe(false);
    expect(validateFirmSkill({ ...valid, systemAddendum: '' }, ALLOWED).ok).toBe(false);
    expect(validateFirmSkill({ ...valid, triggers: [] }, ALLOWED).ok).toBe(false);
  });

  test('clamps an oversized template section', () => {
    const r = validateFirmSkill(
      { ...valid, template: { heading: 'H', sections: ['x'.repeat(200)] } },
      ALLOWED,
    );
    expect(r.ok).toBe(true);
    expect(r.skill?.template?.sections[0]!.length).toBeLessThanOrEqual(80);
  });
});

describe('mergeSkills', () => {
  const builtIn: ClioSkill[] = [
    {
      id: 'briefing',
      name: 'B',
      triggers: ['generate_briefing'],
      systemAddendum: 'x',
      requiredTools: ['a'],
      template: null,
    },
  ];
  test('appends firm skills with new triggers', () => {
    const firm: ClioSkill[] = [
      {
        id: 'wc',
        name: 'WC',
        triggers: ['whip_count'],
        systemAddendum: 'y',
        requiredTools: ['a'],
        template: null,
      },
    ];
    const merged = mergeSkills(builtIn, firm);
    expect(merged.map((s) => s.id)).toEqual(['briefing', 'wc']);
  });
  test('drops a firm skill that tries to claim a built-in trigger', () => {
    const firm: ClioSkill[] = [
      {
        id: 'evil',
        name: 'Evil',
        triggers: ['generate_briefing'],
        systemAddendum: 'y',
        requiredTools: ['a'],
        template: null,
      },
    ];
    const merged = mergeSkills(builtIn, firm);
    expect(merged.map((s) => s.id)).toEqual(['briefing']); // evil dropped
  });
});
