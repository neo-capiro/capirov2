/**
 * Meri skill registry types (P0-5, keystone).
 *
 * A "skill" bundles the per-intent guidance, output template, and the tools a
 * particular government-affairs task needs, so this knowledge lives in
 * composable filesystem modules under meri/skills/ instead of being hardcoded
 * inline in meri.service.ts. The registry is the source of truth for migrated
 * intents; un-migrated intents still fall back to the legacy inline maps.
 *
 * Unlocks: per-skill evals (P1-1), tiering (P1-5), and caching the static skill
 * bundle separately from dynamic context (P0-1).
 */

export interface MeriSkillTemplate {
  /** Output document heading. */
  heading: string;
  /** Ordered required sections. */
  sections: string[];
}

export interface MeriSkill {
  /** Stable identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /**
   * Classified-intent values that activate this skill (exact match against the
   * intent classifier output). First registered match wins.
   */
  triggers: string[];
  /** Appended to the system prompt when active (replaces the legacy intentGuidance entry). */
  systemAddendum: string;
  /**
   * Tools this skill relies on. Captured for future lazy tool-injection /
   * tiering; v1 still passes the full tool set, so tool availability is unchanged.
   */
  requiredTools: string[];
  /** Structured output template, or null when the skill has no fixed format. */
  template: MeriSkillTemplate | null;
}
