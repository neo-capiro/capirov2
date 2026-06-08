/**
 * Deterministic narrative assembly for action cards (plan §10). Pure — no DB, no
 * NestJS, NO LLM, NO randomness. Given the stored facts for one action, builds the
 * four card narrative fields (issueTitle / whatChanged / whyItMatters /
 * recommendedAction) plus a suggested artifact type, using fixed string templates.
 *
 * Every number and proper noun in the output comes ONLY from the input facts — this
 * module never invents figures. (LLM polish, if any, is a separate downstream step;
 * this layer guarantees a correct, auditable baseline.)
 *
 * Money convention: delta amounts are $ MILLIONS (project-wide; see
 * program-element-writer). `formatMillions` renders them with an M suffix.
 */

import type {
  ActionType,
  ArtifactType,
  DeadlineSource,
} from './action-recommendation.types.js';

/** A relevance path + its evidence strings (shape mirrors §2.3 PathResult). */
export interface RelevancePathFact {
  path: string;
  evidence: string[];
}

/** The budget delta the card is built around. Amounts are $ MILLIONS. */
export interface DeltaFact {
  deltaType: string;
  amountFrom: number;
  amountTo: number;
  deltaPct: number;
  assertedFy: number | string;
  /** Budget-line position the mark moved FROM (e.g. 'requested'), if known. */
  stageFrom?: string;
  /** Budget-line position the mark moved TO (e.g. 'house_mark'), if known. */
  stageTo?: string;
}

export interface AssembleCardFacts {
  actionType: ActionType;
  clientName: string;
  peCode: string;
  peTitle: string;
  programName?: string;
  delta: DeltaFact;
  relevancePaths: RelevancePathFact[];
  deadline?: string | null;
  deadlineSource?: DeadlineSource | null;
}

export interface AssembledCard {
  issueTitle: string;
  whatChanged: string;
  whyItMatters: string;
  recommendedAction: string;
  suggestedArtifactType?: ArtifactType;
}

/** Render an amount in $ MILLIONS compactly (e.g. 12.5 -> "$12.5M", 800 -> "$800M"). */
function formatMillions(amountM: number): string {
  const rounded = Math.round(amountM * 10) / 10;
  // Drop a trailing ".0" for whole numbers.
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `$${text}M`;
}

/** "+12%" / "-8%" with the sign always shown; rounds to a whole percent. */
function formatSignedPct(pct: number): string {
  const rounded = Math.round(pct);
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

/** Human label for a budget-line position; falls back to the raw value. */
function stageLabel(stage?: string): string {
  if (!stage) return 'current';
  return stage.replace(/_/g, ' ');
}

/**
 * Render a fiscal year as a 2-digit suffix for the "FYxx" label, accepting either a
 * full year (2026 -> "26"), a 2-digit value (26 -> "26"), or a string ("FY2026" /
 * "2026" -> "26"). Any unparseable value is passed through unchanged.
 */
function fyShort(assertedFy: number | string): string {
  const digits = String(assertedFy).replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2);
  return String(assertedFy);
}

/** Human-readable relevance-path phrases, joined for the why-it-matters sentence. */
function describeRelevance(paths: RelevancePathFact[]): string {
  if (paths.length === 0) {
    return 'this client has a tracked interest in this program';
  }
  // Prefer the evidence strings (they are already client-specific); fall back to the
  // path name when a path carries no evidence.
  const phrases = paths.map((p) =>
    p.evidence.length > 0 ? p.evidence.join('; ') : p.path.replace(/_/g, ' '),
  );
  return phrases.join('; ');
}

/** Trailing deadline clause for the recommended action. */
function deadlineClause(deadline?: string | null): string {
  if (!deadline) {
    return ' There is no known deadline.';
  }
  return ` Target completion by ${deadline}.`;
}

/**
 * Assemble the narrative for one card. The `whatChanged` sentence is shared across
 * action types (it states the objective budget fact); `whyItMatters` cites the
 * client-specific relevance paths; `recommendedAction` and `suggestedArtifactType`
 * vary by `actionType`.
 */
export function assembleCard(facts: AssembleCardFacts): AssembledCard {
  const { delta } = facts;
  const direction = delta.amountTo >= delta.amountFrom ? 'increased' : 'decreased';
  const from = formatMillions(delta.amountFrom);
  const to = formatMillions(delta.amountTo);
  const pct = formatSignedPct(delta.deltaPct);
  const fy = `FY${fyShort(delta.assertedFy)}`;
  const stage = stageLabel(delta.stageTo);

  const whatChanged =
    `${facts.peTitle} (PE ${facts.peCode}) ${direction} from ${from} to ${to} ` +
    `(${pct}) in the ${stage} position for ${fy}.`;

  const whyItMatters =
    `This matters to ${facts.clientName} because ${describeRelevance(facts.relevancePaths)}.`;

  const programLabel = facts.programName ?? facts.peTitle;
  const { issueTitle, recommendedAction, suggestedArtifactType } = byActionType(
    facts.actionType,
    {
      clientName: facts.clientName,
      peCode: facts.peCode,
      programLabel,
      fy,
      deadline: facts.deadline,
    },
  );

  return { issueTitle, whatChanged, whyItMatters, recommendedAction, suggestedArtifactType };
}

interface ActionTemplateCtx {
  clientName: string;
  peCode: string;
  programLabel: string;
  fy: string;
  deadline?: string | null;
}

/** Per-action-type title, recommended action, and suggested artifact. */
function byActionType(
  actionType: ActionType,
  ctx: ActionTemplateCtx,
): { issueTitle: string; recommendedAction: string; suggestedArtifactType?: ArtifactType } {
  const dl = deadlineClause(ctx.deadline);
  switch (actionType) {
    case 'protect_funding':
      return {
        issueTitle: `Protect ${ctx.programLabel} funding (PE ${ctx.peCode})`,
        recommendedAction:
          `Engage relevant committee staff to defend the ${ctx.fy} mark for ` +
          `${ctx.programLabel} and prevent erosion in conference.${dl}`,
        suggestedArtifactType: 'committee_staff_memo',
      };
    case 'restore_cut':
      return {
        issueTitle: `Restore cut to ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Build the case to restore the reduction to ${ctx.programLabel} in the ` +
          `${ctx.fy} markup and secure an offset.${dl}`,
        suggestedArtifactType: 'committee_staff_memo',
      };
    case 'add_report_language':
      return {
        issueTitle: `Add report language for ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Draft proposed report language directing emphasis on ${ctx.programLabel} ` +
          `and circulate to committee staff for the ${ctx.fy} report.${dl}`,
        suggestedArtifactType: 'committee_staff_memo',
      };
    case 'oppose_restriction':
      return {
        issueTitle: `Oppose restriction on ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Prepare talking points opposing the proposed restriction on ` +
          `${ctx.programLabel} and brief allied offices ahead of the ${ctx.fy} vote.${dl}`,
        suggestedArtifactType: 'talking_points',
      };
    case 'district_one_pager':
      return {
        issueTitle: `District impact one-pager for ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Produce a district-impact one-pager tying ${ctx.programLabel} to ` +
          `${ctx.clientName}'s local footprint for the member's office.${dl}`,
        suggestedArtifactType: 'member_one_pager',
      };
    case 'monitor_procurement':
      return {
        issueTitle: `Monitor procurement on ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Track SAM.gov and contracting activity tied to ${ctx.programLabel}; ` +
          `log new solicitations and award actions without contacting procurement officials.${dl}`,
        suggestedArtifactType: 'procurement_watch_note',
      };
    case 'client_alert':
      return {
        issueTitle: `Alert ${ctx.clientName}: ${ctx.programLabel} change (PE ${ctx.peCode})`,
        recommendedAction:
          `Send ${ctx.clientName} a concise alert summarizing the ${ctx.fy} change to ` +
          `${ctx.programLabel} and the recommended next step.${dl}`,
        suggestedArtifactType: 'client_email',
      };
    case 'schedule_outreach':
      return {
        issueTitle: `Schedule outreach on ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Schedule outreach to the identified audience to advance ${ctx.clientName}'s ` +
          `position on ${ctx.programLabel} for ${ctx.fy}.${dl}`,
        suggestedArtifactType: 'internal_brief',
      };
    case 'escalate_uncertainty':
      return {
        issueTitle: `Confirm match before acting on ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Do not contact any audience yet. Confirm the program match underlying this ` +
          `card before taking any action on ${ctx.programLabel}.${dl}`,
        suggestedArtifactType: 'internal_brief',
      };
    case 'update_compliance_notes':
      return {
        issueTitle: `Update compliance notes for ${ctx.programLabel} (PE ${ctx.peCode})`,
        recommendedAction:
          `Update the compliance record for ${ctx.programLabel} to reflect the ` +
          `${ctx.fy} change and any contact-use constraints.${dl}`,
        suggestedArtifactType: 'internal_brief',
      };
    default: {
      // Exhaustiveness guard: a new ActionType must be handled above.
      const _never: never = actionType;
      throw new Error(`Unhandled actionType: ${String(_never)}`);
    }
  }
}
