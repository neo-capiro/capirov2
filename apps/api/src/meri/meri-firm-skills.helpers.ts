/**
 * Validation + safe merge for firm/user-authored Meri skills (P3-4).
 *
 * Firms can author their own skills that plug into the P0-5 registry. This is
 * the security-critical core: strict validation/sanitization of a user-submitted
 * skill (id shape, length caps, count caps, tool allowlist, no overriding a
 * built-in/reserved trigger), and a safe merge where built-in skills always win.
 * Pure so it unit-tests under `src/**.spec.ts`. Persistence (a tenant-scoped
 * table) + CRUD endpoints + the authoring UI are the remaining integration
 * (requires a migration); this module is what they call to stay safe.
 */
import type { MeriSkill } from './skills/skill.types.js';

const LIMITS = {
  name: 80,
  addendum: 2000,
  triggers: 5,
  tools: 12,
  sections: 12,
  sectionLen: 80,
  heading: 120,
};

/** Triggers owned by built-in skills/intents; firm skills may not claim these. */
export const RESERVED_TRIGGERS = new Set([
  'generate_briefing',
  'generate_draft',
  'analyze_bill',
  'prep_hearing',
  'draft_coalition_letter',
  'track_amendment',
]);

export interface FirmSkillValidation {
  ok: boolean;
  skill: MeriSkill | null;
  errors: string[];
}

export function validateFirmSkill(
  input: Record<string, unknown>,
  allowedTools: readonly string[],
): FirmSkillValidation {
  const errors: string[] = [];

  const id = String(input.id ?? '').trim();
  if (!/^[a-z0-9_]{2,48}$/.test(id)) errors.push('id must be 2-48 chars of [a-z0-9_]');

  const name = String(input.name ?? '').trim();
  if (!name || name.length > LIMITS.name) errors.push(`name is required (<=${LIMITS.name} chars)`);

  const triggers = Array.isArray(input.triggers)
    ? input.triggers
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  if (triggers.length === 0 || triggers.length > LIMITS.triggers) {
    errors.push(`1-${LIMITS.triggers} triggers required`);
  }
  for (const t of triggers) {
    if (RESERVED_TRIGGERS.has(t)) errors.push(`trigger "${t}" is reserved by a built-in skill`);
  }

  const systemAddendum = String(input.systemAddendum ?? '').trim();
  if (!systemAddendum || systemAddendum.length > LIMITS.addendum) {
    errors.push(`systemAddendum is required (<=${LIMITS.addendum} chars)`);
  }

  const requiredToolsRaw = Array.isArray(input.requiredTools)
    ? input.requiredTools.filter((t): t is string => typeof t === 'string')
    : [];
  const unknownTools = requiredToolsRaw.filter((t) => !allowedTools.includes(t));
  if (unknownTools.length) errors.push(`unknown tools: ${unknownTools.join(', ')}`);
  const requiredTools = requiredToolsRaw.filter((t) => allowedTools.includes(t));
  if (requiredTools.length > LIMITS.tools) errors.push(`too many tools (<=${LIMITS.tools})`);

  let template: MeriSkill['template'] = null;
  const tin = input.template;
  if (tin && typeof tin === 'object') {
    const t = tin as Record<string, unknown>;
    const heading = String(t.heading ?? '').trim();
    const sections = Array.isArray(t.sections)
      ? t.sections
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (heading && sections.length > 0) {
      if (sections.length > LIMITS.sections)
        errors.push(`too many template sections (<=${LIMITS.sections})`);
      template = {
        heading: heading.slice(0, LIMITS.heading),
        sections: sections.slice(0, LIMITS.sections).map((s) => s.slice(0, LIMITS.sectionLen)),
      };
    }
  }

  if (errors.length) return { ok: false, skill: null, errors };
  return {
    ok: true,
    errors: [],
    skill: { id, name, triggers, systemAddendum, requiredTools, template },
  };
}

/**
 * Merge firm skills into the built-in set. Built-ins are authoritative: a firm
 * skill is dropped if any of its triggers is already claimed (by a built-in or
 * an earlier firm skill), so firms can extend but never hijack core behavior.
 */
export function mergeSkills(
  builtIn: readonly MeriSkill[],
  firm: readonly MeriSkill[],
): MeriSkill[] {
  const claimed = new Set(builtIn.flatMap((s) => s.triggers));
  const out: MeriSkill[] = [...builtIn];
  for (const fs of firm) {
    if (fs.triggers.some((t) => claimed.has(t))) continue;
    fs.triggers.forEach((t) => claimed.add(t));
    out.push(fs);
  }
  return out;
}

/**
 * Match a firm skill for one turn (F6b). Built-in skills resolve by classified
 * intent elsewhere; firm skills additionally fire when the user literally says
 * a trigger phrase ("earmark request memo"), since the intent classifier only
 * knows the built-in intents. Safe-merge semantics apply first, so a firm
 * skill whose triggers collide with a built-in can never match.
 */
export function matchFirmSkillForTurn(
  intent: string,
  message: string,
  firmSkills: readonly MeriSkill[],
  builtIn: readonly MeriSkill[],
): MeriSkill | null {
  if (!firmSkills.length) return null;
  const merged = mergeSkills(builtIn, firmSkills);
  const builtInIds = new Set(builtIn.map((s) => s.id));
  const survivors = merged.filter((s) => !builtInIds.has(s.id));
  const byIntent = survivors.find((s) => s.triggers.includes(intent));
  if (byIntent) return byIntent;
  const lower = message.toLowerCase();
  return (
    survivors.find((s) =>
      s.triggers.some((t) => t.length >= 4 && lower.includes(t.toLowerCase())),
    ) ?? null
  );
}
