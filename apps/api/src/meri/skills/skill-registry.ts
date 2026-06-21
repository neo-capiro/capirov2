import type { MeriSkill } from './skill.types.js';
import { briefingSkill } from './briefing.skill.js';
import { draftSkill } from './draft.skill.js';
import { LOBBYING_SKILLS } from './lobbying-skills.js';

/**
 * Registered Meri skills (filesystem-driven for v1 — add a module and import it
 * here to register it). Order matters: `matchSkill` returns the first skill
 * whose `triggers` include the classified intent.
 *
 * v1 migrates two skills as proof; the remaining intents still resolve via the
 * legacy inline maps in meri.service.ts (behind CLIO_SKILLS_ENABLED).
 */
export const CLIO_SKILLS: readonly MeriSkill[] = [briefingSkill, draftSkill, ...LOBBYING_SKILLS];

/** The skill activated by a classified intent, or null if none match. */
export function matchSkill(
  intent: string,
  skills: readonly MeriSkill[] = CLIO_SKILLS,
): MeriSkill | null {
  return skills.find((skill) => skill.triggers.includes(intent)) ?? null;
}
