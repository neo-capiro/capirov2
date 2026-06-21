/**
 * Deep-tier prompts for the extended-thinking pairwise eval (F3).
 *
 * Twenty prompts of the kind that route to the deep tier (bill analysis,
 * briefings, strategy) — each is answered twice by the runner
 * (scripts/eval-clio-thinking.ts): baseline (no thinking) vs extended
 * thinking, then judged pairwise. No tool access in the eval, so prompts are
 * self-contained reasoning tasks rather than retrieval tasks.
 */

export interface ThinkingEvalPrompt {
  id: string;
  prompt: string;
}

export const THINKING_EVAL_PROMPTS: ThinkingEvalPrompt[] = [
  {
    id: 'bill-impact',
    prompt:
      'A client manufactures composite airframe structures. A new bill creates a DoD pilot program to qualify 12 domestic composite suppliers by FY2029 with $240M authorized over FY27-29. Analyze: direct impact, key stakeholders, likely opposition, and leverage points, in that order.',
  },
  {
    id: 'markup-strategy',
    prompt:
      'Our amendment adding composite suppliers to a Section 848 pilot was left out of the chairman\'s mark. The subcommittee markup is in 9 days; full committee in 3 weeks. Lay out a recovery strategy with a day-by-day plan for the next two weeks.',
  },
  {
    id: 'briefing-cr',
    prompt:
      'Write a briefing for a defense client on the risks of a 6-month continuing resolution: what a CR does to new-start programs, production-rate increases, and RDT&E plus-ups, with recommended client actions. Sections: Executive Summary, Risks, Recommended Actions.',
  },
  {
    id: 'coalition-design',
    prompt:
      'Design a coalition strategy to support domestic carbon-fiber production incentives. Identify 5 plausible member-organization archetypes, what each contributes, the governance model, and the two biggest coalition-management risks.',
  },
  {
    id: 'approps-tradeoff',
    prompt:
      'A client can pursue either an $18.5M RDT&E plus-up via a member request or report language directing a capacity study. They can realistically push only one. Build the decision analysis: criteria, trade-offs, and a recommendation.',
  },
  {
    id: 'hearing-prep',
    prompt:
      'Prepare hearing-prep guidance for a client CEO testifying before HASC on industrial-base resilience: 5 likely hostile questions with suggested answers, 3 affirmative messages to land, and bridging techniques.',
  },
  {
    id: 'german-offset',
    prompt:
      'A European parent company wants its US subsidiary to lobby for ITAR licensing reform. Walk through the FARA/LDA registration analysis: when LDA suffices, when FARA is triggered, and the safest compliance posture, flagging the key statutory tests.',
  },
  {
    id: 'election-scenario',
    prompt:
      'Game out how a change in Senate control would affect a client agenda centered on defense industrial-base spending and permitting reform: committee gavels, floor dynamics, and three hedging moves to make now.',
  },
  {
    id: 'pe-defense',
    prompt:
      'An Air Force program element funding a client technology took a 40% cut in the House mark but level funding in the Senate. Map the conference strategy: who decides, what materials to prepare, and the sequencing of outreach.',
  },
  {
    id: 'grassroots-design',
    prompt:
      'Design a district-level grassroots campaign for a manufacturer with plants in 4 congressional districts to protect a $55M budget line: tactics, sequencing relative to the markup calendar, and metrics.',
  },
  {
    id: 'memo-skeptic',
    prompt:
      'Draft talking points to persuade a deficit-hawk member to support a new $240M authorization, anticipating and pre-empting their three strongest objections.',
  },
  {
    id: 'cr-anomaly',
    prompt:
      'Explain what a CR "anomaly" is and build the case for an anomaly allowing a program new-start, including who must approve it and what the request package contains.',
  },
  {
    id: 'two-client-conflict',
    prompt:
      'Two clients of the same firm end up on opposite sides of a spectrum-allocation fight. Lay out the conflict-management analysis: ethical obligations, screening options, and what to tell each client.',
  },
  {
    id: 'approps-cycle',
    prompt:
      'Build a 12-month engagement calendar for an appropriations-focused client, working backward from enactment: member request windows, subcommittee/full markups, floor, conference, and the right client action in each window.',
  },
  {
    id: 'sbir-transition',
    prompt:
      'A client\'s SBIR Phase II ends in 14 months with no program of record. Analyze the transition options (Phase III, OTA, ManTech, PE insertion) and recommend a sequenced strategy.',
  },
  {
    id: 'state-federal',
    prompt:
      'A client wants both a federal tax credit and state-level incentives for the same facility expansion. Analyze how to sequence federal vs state asks so each strengthens the other, with risks of double-dipping optics.',
  },
  {
    id: 'oppo-response',
    prompt:
      'A competitor planted a story that our client\'s program is "wasteful duplication." The approps markup is in 3 weeks. Build the response plan: rapid-response messaging, third-party validators, and member-office inoculation.',
  },
  {
    id: 'ndaa-vs-approps',
    prompt:
      'Explain to a new client why winning authorization language in the NDAA does not guarantee funding, and design a two-track NDAA + approps strategy for a $30M technology insertion.',
  },
  {
    id: 'fly-in-design',
    prompt:
      'Plan a one-day Hill fly-in for 6 executives targeting 8 offices across both chambers: meeting mix, materials, scheduling logic, roles in each meeting, and follow-up cadence.',
  },
  {
    id: 'earmark-memo',
    prompt:
      'Write an internal memo: should a municipal water client pursue a Community Project Funding request this cycle? Cover eligibility, member fit, competition, compliance burden, and a go/no-go recommendation.',
  },
];
