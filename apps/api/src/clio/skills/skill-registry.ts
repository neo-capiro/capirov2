import type { ClioSkill } from './skill.types.js';
import { briefingSkill } from './briefing.skill.js';
import { draftSkill } from './draft.skill.js';
import { LOBBYING_SKILLS } from './lobbying-skills.js';

/**
 * Registered Clio skills (filesystem-driven for v1 — add a module and import it
 * here to register it). Order matters: `matchSkill` returns the first skill
 * whose `triggers` include the classified intent.
 *
 * v1 migrates two skills as proof; the remaining intents still resolve via the
 * legacy inline maps in clio.service.ts (behind CLIO_SKILLS_ENABLED).
 */
export const CLIO_SKILLS: readonly ClioSkill[] = [briefingSkill, draftSkill, ...LOBBYING_SKILLS];

/** The skill activated by a classified intent, or null if none match. */
export function matchSkill(
  intent: string,
  skills: readonly ClioSkill[] = CLIO_SKILLS,
): ClioSkill | null {
  return skills.find((skill) => skill.triggers.includes(intent)) ?? null;
}
