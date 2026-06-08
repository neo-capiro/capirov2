/**
 * Pure builder for the human "why is this person shown on this PE?" chain (plan §8/§14).
 *
 * People hang off OFFICES and ROLES, never directly off a PE. The chain a person is
 * surfaced through is therefore:
 *
 *   <role> at <office>  ->  office manages <program>  ->  <program> maps to PE <peCode>
 *
 * `buildWhyShown` renders that chain in plain English and, crucially, names exactly
 * which HOP is missing when the chain is incomplete (a missing office, a missing
 * accepted office->program link, or a missing accepted program->PE match). When a
 * person is only visible via the legacy `pe_primary` shortcut (no PersonRole row at
 * all), it returns a legacy-fallback sentence.
 *
 * Hard rule: the output NEVER uses the phrase "owns PE" and never implies a person
 * owns a PE — the role/office phrasing is deliberate.
 */

export interface WhyShownInput {
  roleTitle: string;
  roleType: string;
  /** Office the role hangs off, if resolved. */
  officeName?: string | null;
  /** Program the chain reaches, if resolved. */
  programName?: string | null;
  /** True iff an ACCEPTED office->program link exists for (office, program). */
  officeManagesProgram?: boolean;
  /** True iff an ACCEPTED program->PE match exists for (program, peCode). */
  programMappedToPe?: boolean;
  /** PE code the person is being shown against. */
  peCode?: string;
  /**
   * Set ONLY for the legacy fallback: the person has no PersonRole row and is shown
   * purely via the legacy pe_primary link. Carries the originating source label.
   */
  legacySource?: string | null;
}

function roleClause(input: WhyShownInput): string {
  const title = input.roleTitle?.trim() || 'Role';
  return input.officeName ? `${title} at ${input.officeName}` : title;
}

/**
 * Build the human chain sentence for a role. Pure: no I/O, no Date.now.
 */
export function buildWhyShown(input: WhyShownInput): string {
  // Legacy fallback: no role chain at all, shown via the old pe_primary shortcut.
  if (input.legacySource) {
    return `Listed on this PE via ${input.legacySource} (role mapping pending review)`;
  }

  const role = roleClause(input);

  // Hop 1 missing: we have a role but no office to hang it off.
  if (!input.officeName) {
    return `${role}, but no office resolved for this role yet`;
  }

  // Hop 2 missing: role at an office, but no accepted office->program link.
  if (!input.officeManagesProgram || !input.programName) {
    return `${role}, but no accepted office->program link yet`;
  }

  // Hop 3 missing: office manages a program, but that program isn't mapped to the PE.
  if (!input.programMappedToPe) {
    return `${role}; office manages ${input.programName}, but no program mapped to this PE yet`;
  }

  // Full chain.
  const peClause = input.peCode
    ? `${input.programName} maps to PE ${input.peCode}`
    : `${input.programName} maps to this PE`;
  return `${role}; office manages ${input.programName}; ${peClause}`;
}
