/**
 * A Clio skill is a pre-defined, named workflow with its own
 * instructions + recommended tools. Skills are the "Hermes-style"
 * library: domain expertise the agent can lazily load without
 * polluting every turn's system prompt with everything we know.
 *
 * Runtime contract:
 *   - At chat-time the system prompt lists every skill by
 *     `name + title + summary` (the "index").
 *   - When the model decides a skill applies, it calls `load_skill`
 *     with the name. The tool returns the full `instructions` body.
 *   - The model now has the full skill content in its conversation
 *     context for the rest of the turn (and the agent loop's
 *     subsequent turns within the same session).
 *
 * No DB writes — skills are static code, not user data. Versioning
 * is handled at deploy time, like any other prompt change.
 */
export interface Skill {
  /** Stable identifier used by the model when invoking the skill. */
  name: string;
  /** Human-readable name shown in the UI + the skill index. */
  title: string;
  /**
   * One-sentence trigger description. This is what the model sees in
   * the system prompt — make it descriptive enough that the model
   * knows when to load the skill but short enough that 30 skills
   * don't blow out the system prompt.
   */
  summary: string;
  /** Group label for the Skills page. */
  category:
    | 'lobbying'
    | 'productivity'
    | 'research'
    | 'writing'
    | 'developer'
    | 'analysis';
  /**
   * Full multi-paragraph instructions. Returned verbatim from
   * `load_skill` so the model can follow it during the response.
   * Treat this as a system-prompt-quality piece of writing: clear
   * structure, explicit constraints, examples where helpful.
   */
  instructions: string;
  /**
   * Names of tools the skill recommends the model use. Purely
   * advisory — the registry still gates which tools the agent has
   * access to per tier; this list is included in load_skill's
   * response so the model knows what's available.
   */
  recommendedTools?: string[];
  /**
   * When true, only the internal tier (capiro_admin) can load the
   * skill. Use for Capiro-internal workflows (e.g. impersonation
   * playbooks). Default false.
   */
  internalOnly?: boolean;
}
