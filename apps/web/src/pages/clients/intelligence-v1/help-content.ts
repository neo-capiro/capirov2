/**
 * Plain-English explainers for every intel calculation and tag on the client
 * Intelligence tab. Audience: lobbyists, NOT engineers — each string says what
 * the number/chip is, where the data comes from, and how to act on it. Centralized
 * here so the copy stays consistent across panels and is easy to review/update.
 */

/** Section- and metric-level explainers, keyed by concept. */
export const HELP = {
  officeRecommender:
    "Your call sheet. We rank congressional offices by how much of this client's tracked legislation each one controls — committees with jurisdiction over the client's bills rank highest, then we layer in bill sponsors, district ties, former-staffer relationships, and campaign-finance context when we have them. The score (0–1) is a relative priority within this client, not a probability. Best practice: work the list top-down and read the tags to see why each office surfaced.",

  healthScore:
    'A 0–100 read on how healthy this client relationship is, from your recent activity — meetings, emails, tasks, and debriefs. More recent and more consistent engagement scores higher. Best practice: treat a falling score as a prompt to re-engage before the client feels neglected.',

  trajectory:
    "Where the client's federal lobbying spend is heading, based on the quarterly amounts they disclose in LDA filings (growing, steady, or declining). Best practice: pair a rising trajectory with new asks; a decline can signal budget pressure worth a conversation.",

  returnRatio:
    "A rough 'return on advocacy': federal dollars obligated to the client divided by what they spent on lobbying over the last twelve months. Very large or blank values usually mean little lobbying spend is on record — not a real windfall. Best practice: read it directionally, not as a precise figure.",

  lobbyingTtm:
    "The client's disclosed federal lobbying spend over the last twelve months, totaled from their LDA filings.",

  obligationsTtm:
    'Federal contract and award dollars obligated to the client over the last twelve months, from USAspending.gov.',

  fec: 'Political contributions from individuals who list this client as their employer, traced from the employer through the committees that received the money to the candidates. Covers roughly the last 24 months. These are individuals’ personal contributions — legally distinct from any company or PAC giving — and are shown for context only, never as advice to make, solicit, or direct a contribution.',

  districtNexus:
    "Where the client's work touches specific congressional districts — by real federal contract dollars when we have them, otherwise by the capability and jobs information entered on the client profile. Best practice: use it to localize your message to a member's home district.",

  trackedBills:
    "Bills we've automatically matched to this client from their LDA issue areas and the capability tags on their profile, grouped by stage (introduced → committee → passed → enacted). Best practice: confirm the client's LDA match and keep capability tags specific (e.g. “electronic warfare”) to improve what gets tracked.",

  billProbability:
    'A directional estimate of how likely a bill is to keep advancing, based on its current stage and recent activity. Use it to prioritize, not as a guarantee.',

  regulatory:
    "Open federal rules and comment periods matched to this client's issue areas. Best practice: watch the comment deadlines — they are concrete, time-boxed chances to weigh in.",

  hearings:
    "Upcoming hearings and markups held by committees with jurisdiction over the client's tracked bills, or that cite those bills directly. Best practice: a scheduled markup is a signal to engage the committee now.",
} as const;

/** Per-tag explainers for the Office Recommender chips, keyed by tag variant. */
export const OFFICE_TAG_HELP: Record<string, string> = {
  committee:
    "This office is a committee with jurisdiction over one or more of the client's tracked bills — it controls whether those bills advance. Usually your highest-leverage first call.",
  sponsor:
    "This member has sponsored one or more of the client's tracked bills — an on-record ally. Best practice: brief them and their staff to keep momentum.",
  district:
    "The client has jobs, facilities, or suppliers in this member's state or district. Best practice: lead with the local economic impact.",
  'ex-staffer':
    "Someone on the client's lobbying team previously worked in this office. Best practice: use that existing relationship for a warm introduction.",
  fec: 'People who list the client as their employer have made FEC-reported political contributions linked to this office. Shown for context only — it is not advice to make, solicit, or direct any contribution.',
};

/** Human-readable labels for the Office Recommender chips, keyed by tag variant. */
export const OFFICE_TAG_LABELS: Record<string, string> = {
  committee: 'Committee',
  sponsor: 'Sponsor',
  district: 'District',
  'ex-staffer': 'Ex-staffer',
  fec: 'FEC',
};
