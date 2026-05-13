import { Injectable } from '@nestjs/common';
import { findSkill, skillsForTier, SKILLS } from './catalog.js';
import type { Skill } from './skill.types.js';

/**
 * Read-only registry for Clio's skills library. Skills are static
 * (defined in `catalog.ts`) — no DB, no admin UI, no per-tenant
 * overrides yet. When that's needed we'll add a `clio_skills` table;
 * for now the code is the source of truth.
 *
 * The service handles:
 *   - Listing skills for a tier (`list()`).
 *   - Looking up by name with internal-tier gating (`get()`).
 *   - Rendering the skill INDEX as a system-prompt fragment so the
 *     model can see what's available without paying for the full
 *     skill body on every turn.
 */
@Injectable()
export class SkillsService {
  list(tier: 'internal' | 'customer'): Skill[] {
    return skillsForTier(tier);
  }

  get(name: string, tier: 'internal' | 'customer'): Skill | undefined {
    const skill = findSkill(name);
    if (!skill) return undefined;
    if (skill.internalOnly && tier !== 'internal') return undefined;
    return skill;
  }

  /**
   * One-line-per-skill listing for the system prompt. Each line:
   *   - <name> (<category>): <summary>
   * Kept short on purpose — full instructions come back via the
   * load_skill tool only when the model needs them.
   */
  renderIndex(tier: 'internal' | 'customer'): string {
    const skills = this.list(tier);
    if (skills.length === 0) return '';
    const byCat = new Map<string, string[]>();
    for (const s of skills) {
      const lines = byCat.get(s.category) ?? [];
      lines.push(`- \`${s.name}\` — ${s.summary}`);
      byCat.set(s.category, lines);
    }
    const sections: string[] = [];
    for (const [cat, lines] of byCat) {
      sections.push(`*${capitalize(cat)}:*\n${lines.join('\n')}`);
    }
    return [
      'You have access to a SKILLS LIBRARY. When a request matches a skill, call `load_skill(name)` to pull its full instructions and follow them. Skills are NOT auto-applied — you decide when one is relevant.',
      '',
      sections.join('\n\n'),
    ].join('\n');
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export { SKILLS };
