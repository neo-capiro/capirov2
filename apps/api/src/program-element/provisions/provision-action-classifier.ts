/**
 * Pure, deterministic classifier for the ACTION a committee-report provision takes
 * (Step 2.4, plan §6 report-language deltas / §10 "add report language" actions).
 * No I/O, no DB, no Nest — the (follow-on) loader and delta engine call this on the
 * verbatim provision text captured from a report.
 *
 * Design notes:
 * - Rules are keyword/phrase regexes tuned to real HASC/SASC/HAC-D/SAC-D phrasing
 *   ("the committee directs the Secretary to provide a briefing...", "recommends an
 *   increase of $...", "none of the funds ... may be obligated").
 * - Evaluation is in a documented PRIORITY ORDER: the first matching rule wins, so a
 *   provision that both briefs AND reports is classified as the briefing (briefings are
 *   the more specific, time-bound directive).
 * - Case-insensitive throughout.
 * - Returns `null` when nothing matches with confidence (AMBIGUOUS / descriptive
 *   narrative) — the caller stores actionType = null rather than guessing.
 */

export type ProvisionActionType =
  | 'directs_briefing'
  | 'directs_report'
  | 'adds'
  | 'cuts'
  | 'transfers'
  | 'restricts'
  | 'encourages'
  | 'expresses_concern';

/**
 * Ordered rule table. The FIRST rule whose any-pattern matches the text wins.
 * Order matters: briefing before report (a "briefing" directive often also says
 * "report"), and the spending/restriction rules before the soft sentiment rules
 * ("encourages" / "concern") so a funded directive is not down-graded to sentiment.
 */
const RULES: ReadonlyArray<{ type: ProvisionActionType; patterns: RegExp[] }> = [
  {
    type: 'directs_briefing',
    patterns: [
      /(provide|deliver)[\s\S]{0,40}briefing/i,
      /briefing[\s\S]{0,20}(to|for) the (congressional )?(defense )?committees/i,
      /shall brief/i,
    ],
  },
  {
    type: 'directs_report',
    patterns: [
      /(submit|provide|deliver)[\s\S]{0,40}report/i,
      /report to the (congressional )?committees/i,
      /shall report/i,
    ],
  },
  {
    type: 'adds',
    patterns: [
      /recommends? an increase/i,
      /\badds?\b[\s\S]{0,20}\$/i,
      /additional \$/i,
      /increase of \$/i,
    ],
  },
  {
    type: 'cuts',
    patterns: [
      /recommends? a (decrease|reduction)/i,
      /reduction of \$/i,
      /reduces?[\s\S]{0,20}\$/i,
      /\bdescope\b/i,
    ],
  },
  {
    type: 'transfers',
    patterns: [/\btransfer(s|red|ring)?\b/i, /realign(s|ment)?/i],
  },
  {
    type: 'restricts',
    patterns: [
      /none of the funds/i,
      /limitation on/i,
      /shall not be (obligated|available|used)/i,
      /no funds[\s\S]{0,30}(may|shall) be/i,
      /\bprohibit/i,
    ],
  },
  {
    type: 'encourages',
    patterns: [/\bencourages?\b/i, /urges the (secretary|department)/i],
  },
  {
    type: 'expresses_concern',
    patterns: [/\bconcern(ed)?\b/i, /\bnotes with concern\b/i, /\bremains concerned\b/i],
  },
];

/**
 * Classify the action a provision takes from its verbatim text.
 * Deterministic: same input → same output. Returns null when no rule matches with
 * confidence (ambiguous / purely descriptive language).
 */
export function classifyProvisionAction(text: string): ProvisionActionType | null {
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return rule.type;
    }
  }
  return null;
}
