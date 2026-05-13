import type { Skill } from './skill.types.js';

/**
 * Initial Clio skills library. Drop a new file in this directory and
 * add it to the SKILLS array to expose it. Each skill's `instructions`
 * is shown to the model verbatim when load_skill is called — write it
 * like a system-prompt clause: clear structure, explicit DOs / DON'Ts,
 * examples where they sharpen the output.
 *
 * Categories:
 *   - lobbying    Capiro's domain. Memos, briefs, regulatory work.
 *   - productivity General office work: email, summarization, action
 *                  items, meeting prep.
 *   - research    Federal databases, sources, fact-checking.
 *   - writing     Long-form drafting: blog posts, presentations.
 *   - developer   Code review, refactoring help.
 *   - analysis    Data work, charts, structured comparisons.
 */
export const SKILLS: Skill[] = [
  {
    name: 'draft_policy_memo',
    title: 'Draft a policy memo',
    summary:
      'Use when the user asks for a policy memo, position paper, or analysis of a legislative / regulatory issue.',
    category: 'lobbying',
    recommendedTools: ['get_client_context', 'web_search', 'fetch_url', 'render_artifact'],
    instructions: `# Policy memo skill

Produce a single-page (≤400 word) policy memo with this exact section order:

**TO / FROM / RE / DATE**
Header lines, one per item. "FROM" is the user's name (ask if unknown).

**ISSUE** — 1-2 sentences. State the policy question precisely; no preamble.

**BACKGROUND** — 1-2 paragraphs. Cite specific bills, regulations, or events with dates. Pull sources via web_search + fetch_url when the user hasn't supplied them.

**STAKEHOLDERS** — bulleted list. For each: name, role, known position (with a citation if from public record). Mark "position unclear" honestly; never invent.

**RECOMMENDATIONS** — numbered list, ranked. Each recommendation is one declarative sentence + one supporting clause. Maximum five.

**CITATIONS** — numbered list, primary sources only (Federal Register, congress.gov, court opinions, LDA filings). No blog posts, no opinion columns.

DOs:
- Lead with the issue. The reader is busy.
- Quantify whenever possible ("affects 12,000 healthcare practices" not "many practices").
- If a fact is uncertain, say so explicitly.

DON'Ts:
- No throat-clearing ("It's worth noting that...").
- No filler conclusions ("In conclusion, this is an important issue...").
- No more than five recommendations.

After drafting, ask the user if they want the memo rendered as an artifact (render_artifact tool) for sharing.`,
  },

  {
    name: 'draft_meeting_brief',
    title: 'Draft a meeting brief',
    summary:
      'Use when the user has a meeting coming up (with a member of Congress, agency staff, client, etc.) and needs a pre-read briefing document.',
    category: 'lobbying',
    recommendedTools: [
      'get_client_context',
      'web_search',
      'fetch_url',
      'render_artifact',
    ],
    instructions: `# Meeting brief skill

Produce a meeting brief with these sections in order:

**MEETING** — title, date/time, location (or virtual), expected duration.

**ATTENDEES** — for each non-Capiro participant: name, title, organization. Add a one-line "what they care about" when public record makes that clear.

**OBJECTIVES (3, ranked)** — what does the user want to walk out with? Phrase as outcomes, not topics.

**TALKING POINTS** — bullet list of 4-7. Each is a single declarative sentence. Order from strongest to weakest.

**ASKS** — explicit list of what the user wants the counterparty to do. Each one specific enough to be answerable yes/no.

**CONTEXT / BACKGROUND** — one paragraph on the relationship, recent interactions, relevant news. Use get_client_context when the meeting is with a Capiro client; use web_search + fetch_url for others.

**LIKELY OBJECTIONS + RESPONSES** — for each anticipated pushback, one-sentence response.

Ask the user for: who they're meeting, when, what they want out of it. Don't assume.`,
  },

  {
    name: 'research_lobbyist',
    title: 'Research a lobbyist or firm',
    summary:
      'Use when the user asks "who is X" / "what does Acme Strategies lobby on" / "tell me about the lobbyist behind bill Y".',
    category: 'research',
    recommendedTools: ['web_search', 'fetch_url'],
    instructions: `# Lobbyist research skill

Goal: return a structured profile of a person or firm with citations.

Use web_search + fetch_url against these sources in order of priority:
1. Senate LDA filings database (soprweb.senate.gov)
2. House LDA filings (clerk.house.gov/disclosure)
3. OpenSecrets.org for spending summaries
4. ProPublica's Represent for member-of-Congress lookups
5. Firm's own website for current roster + clients

Output structure:

**SUBJECT** — name + role/firm
**ACTIVE REGISTRATIONS** — current LDA registrations: client, issue codes, recent quarterly amounts. List the 5 most recent / largest.
**KEY ISSUES** — bulleted list of policy areas they're active on
**NOTABLE CLIENTS** — top 5-10 by spend or recency
**TEAM / LEADERSHIP** — for firms, list principal lobbyists from public filings
**RECENT ACTIVITY** — last 3-6 months: filings, meetings, news mentions
**CITATIONS** — every claim above has a numbered footnote linking to the source URL

Be skeptical: LDA filings are self-reported, OpenSecrets aggregates can be stale. Note disagreement between sources.

If the subject isn't lobbying-registered or doesn't appear in public filings, say so clearly — don't pad with marketing copy.`,
  },

  {
    name: 'summarize_federal_register_notice',
    title: 'Summarize a Federal Register notice',
    summary:
      'Use when the user gives you a Federal Register URL or asks to summarize a rule, NPRM, or proposed action.',
    category: 'lobbying',
    recommendedTools: ['fetch_url', 'web_search'],
    instructions: `# Federal Register summarization skill

Always fetch the actual notice via fetch_url before summarizing — do not summarize from memory.

Output structure:

**TITLE** — the notice's title verbatim.
**AGENCY** — issuing agency.
**TYPE** — Final Rule / Proposed Rule (NPRM) / Notice / Direct Final Rule / etc.
**DATES** — effective date, comment period close, hearing dates if any.
**SUMMARY** — 3-5 sentences. What does this do? In plain English.
**WHO IS AFFECTED** — bulleted list of affected industries / categories of people.
**KEY CHANGES** — bulleted list. Each bullet contrasts old behavior with new ("Currently X; the rule would require Y").
**COMMENT PERIOD** — if open, date and submission link. If closed, say so and give the closing date.
**PRACTICAL IMPACT** — one paragraph: what should a Capiro lobbyist care about here?
**CITATIONS** — link to the Federal Register page, link to docket on regulations.gov.

DOs:
- Quote specific language when it matters (regulatory text is contested).
- Note when the notice cross-references other rules; pull those too if relevant.

DON'Ts:
- Don't paraphrase legal definitions; quote them.
- Don't speculate on enforcement.`,
  },

  {
    name: 'draft_outreach_email',
    title: 'Draft an outreach email',
    summary:
      'Use when the user wants to email a Hill staffer, agency contact, or external counterpart with a specific ask.',
    category: 'lobbying',
    recommendedTools: ['get_client_context', 'send_email'],
    instructions: `# Outreach email skill

Produce a short, scannable outreach email. Maximum 150 words. Five lines minimum to look human, ten lines maximum.

Structure:

**Subject line** — concrete, specific, no clickbait. Include the bill number / topic up front.
  Good: "Sec 304 amendment language — request for feedback"
  Bad: "Quick question"

**Opening (1 sentence)** — context. Reference a shared meeting / mutual contact / public record. NEVER fake one.

**Body (2-4 sentences)** — the ask. What do you want from them? Be specific (a meeting, a co-sponsorship, a comment letter signature).

**Close (1 sentence)** — propose a concrete next step ("I can send over the one-pager today" / "Are you free Tuesday at 2?").

**Sign-off** — first name only. The user's signature block is appended outside this drafting.

DOs:
- Lead with the ask.
- Cite specific bills / sections / dockets.
- Use the recipient's first name (if you don't know it, ask).

DON'Ts:
- No "I hope this finds you well" or any variant.
- No paragraphs longer than three sentences.
- No closing with "Just wanted to reach out about...".

After drafting, ask if the user wants you to send via send_email (from their Clio mailbox) or copy-paste it themselves.`,
  },

  {
    name: 'prepare_for_meeting',
    title: 'Prepare me for a meeting',
    summary:
      'Use when the user says "I have a meeting with X tomorrow" / "prep me for my call with Y" and wants a quick research pass + talking points.',
    category: 'productivity',
    recommendedTools: ['get_client_context', 'web_search', 'fetch_url'],
    instructions: `# Meeting prep skill

This is the rapid version of "draft a meeting brief" — when the user wants prep but isn't going to send the brief to anyone.

Output structure (informal, conversational tone):

**Who you're meeting** — one-line summary of the counterparty.
**What they care about** — 2-3 bullets pulled from public record (their recent statements, votes, press releases, filings).
**What you'll want to know** — 3-5 specific questions to ask them.
**What you'll want to say** — 3-5 talking points, ranked.
**Two facts to drop** — concrete data points that will impress them. Cite source.
**One thing to avoid** — a topic, asking style, or framing that will hurt the conversation.

Keep it tight. The user is going to read this on their phone in the cab over.`,
  },

  {
    name: 'summarize_document',
    title: 'Summarize a document',
    summary:
      'Use when the user pastes a long document, asks "what does this say", or gives a URL to read and condense.',
    category: 'productivity',
    recommendedTools: ['fetch_url', 'code_interpreter'],
    instructions: `# Document summarization skill

Output format depends on document type:

**For policy/legal/regulatory docs:**
- Three-bullet TL;DR at the top.
- "Key provisions" section with one paragraph per major section.
- "Notable language" section: quote the 2-3 most consequential sentences verbatim.
- "Open questions" section: what's ambiguous, what's missing, what should the reader check.

**For news / op-ed / blog:**
- One-sentence summary (under 30 words).
- 3-5 bullets of the main claims.
- "Counterpoints" section if the piece is opinionated.

**For internal memos / emails:**
- Action items first (a numbered list).
- Decisions made.
- Open questions / next steps.

DOs:
- Always quote specific language when it changes the meaning.
- Note when a source is biased or one-sided.

DON'Ts:
- Don't add information not in the source.
- Don't water down strong claims to be neutral if the source isn't.`,
  },

  {
    name: 'extract_action_items',
    title: 'Extract action items',
    summary:
      'Use when the user pastes meeting notes, a thread, or a long discussion and wants to know what they actually need to do.',
    category: 'productivity',
    recommendedTools: [],
    instructions: `# Action items skill

Parse the input and produce ONLY a numbered list of action items. No preamble, no summary, no "here are the action items" intro.

Each item has this shape:

  N. [OWNER] [VERB-PHRASE]. (DEADLINE if any)

Examples:
  1. [Neo] Send revised draft to Senator Smith. (Friday)
  2. [Sarah] Confirm meeting room booking. (today)
  3. [Both] Review committee markup before Tuesday call. (Tuesday AM)

Rules:
- Owner is a real name from the source. If unclear, mark [Unclear].
- Verb-phrase starts with the verb.
- Deadlines only when explicitly stated; don't infer.
- If the source contains discussion but no concrete action, return: "No clear action items in this source."

After the list, add a one-line "Pending decisions:" section if there are open questions that aren't action items.`,
  },

  {
    name: 'code_review',
    title: 'Code review',
    summary:
      'Use when the user pastes code, links to a PR, or asks "what do you think of this code".',
    category: 'developer',
    recommendedTools: ['fetch_url', 'code_interpreter'],
    instructions: `# Code review skill

Be honest, terse, and specific. Don't pad with compliments.

Output structure:

**Verdict** — one line. "Ship it" / "Ship after fixes" / "Don't ship — see issues".

**Issues (P0 — blockers)** — anything that would cause a bug, security hole, or data loss. Each has: file:line reference + one-sentence explanation + suggested fix.

**Issues (P1 — should fix before merge)** — anything that hurts maintainability, performance, or readability enough to warrant a revision.

**Issues (P2 — nice to have)** — style nits and minor improvements. Optional.

**Praise** — only when a non-obvious choice was clearly correct. One bullet.

DOs:
- Cite specific lines.
- Suggest a fix, not just "this is wrong".
- Group related issues.

DON'Ts:
- Don't list every type annotation that could be tightened — focus on what matters.
- Don't enumerate things you'd refactor for personal taste.
- Don't speculate about intent when you can ask the author.

If the code is doing something unusual, ask why before reviewing.`,
  },

  {
    name: 'write_blog_post',
    title: 'Write a blog post',
    summary:
      'Use when the user asks for a long-form post for the Capiro blog, a thought-leadership piece, or any 600-1500 word article.',
    category: 'writing',
    recommendedTools: ['web_search', 'fetch_url'],
    instructions: `# Blog post skill

Target length: 700-1100 words unless the user specifies otherwise.

Structure:

**Hook (1-2 sentences)** — a specific, concrete observation. Not a generality.
  Good: "Last quarter, three of our clients quietly lost their committee assignments because nobody flagged the chair's retirement letter."
  Bad: "Lobbying is changing fast."

**Thesis (1 paragraph)** — what's the piece's argument? Stated plainly.

**3-4 supporting sections** — each opens with a sub-header (H2), then 2-3 paragraphs. Each section makes ONE point.

**Counterpoint section** — acknowledge the strongest objection to the thesis. Don't strawman.

**Close** — one paragraph. What should the reader DO differently after reading? Concrete.

Voice:
- First person ("I" or "we" — match Capiro's existing posts).
- Active voice. Short sentences alongside longer ones for rhythm.
- Specifics over generalities. Names, dates, numbers.

DOs:
- Cite primary sources inline (Federal Register, congress.gov, etc.).
- Use concrete examples — invented if necessary, but flag them ("hypothetical:") when not real.

DON'Ts:
- No bullet-point soup. Prose for blog posts.
- No "in today's fast-changing landscape" or any cousin of that.
- No closing with "what do you think? leave a comment".`,
  },

  {
    name: 'create_presentation_outline',
    title: 'Create a presentation outline',
    summary:
      'Use when the user is about to build a deck and needs a slide-by-slide outline.',
    category: 'writing',
    recommendedTools: ['code_interpreter'],
    instructions: `# Presentation outline skill

Output a slide-by-slide outline. Each slide is one line: "**N. Slide title** — body description (1 sentence)".

Default deck length: 8-12 slides for a 20-minute talk. Adjust to the user's request.

Structure pattern:

1. **Title slide** — title, subtitle, presenter.
2. **The problem / why we're here** — set the stakes.
3-5. **Three core points** — one slide per point, each with a specific example.
6-8. **What we're proposing** — the asks / actions.
9. **Counterpoints** — what we know will be challenged.
10. **Close** — what happens next.

After the outline, add a "Speaker notes" section with one paragraph per slide on what the presenter should actually say. The slide bullets are NOT the speech.

If the user wants the deck rendered, offer code_interpreter to generate a starting .pptx via python-pptx — but only if they ask. Outlines first.`,
  },

  {
    name: 'compare_options',
    title: 'Compare options side-by-side',
    summary:
      'Use when the user is weighing 2+ choices: vendors, strategies, candidates, regulatory approaches, etc.',
    category: 'analysis',
    recommendedTools: ['web_search', 'fetch_url', 'code_interpreter'],
    instructions: `# Side-by-side comparison skill

Output a markdown table with:
- ROWS = the criteria the user cares about.
- COLUMNS = the options being compared.

If the user hasn't told you which criteria matter, ASK BEFORE COMPARING. The right criteria are the difference between a useful comparison and a useless one.

After the table, add three sections:

**Where they differ most** — 2-3 bullets on the dimensions where the options diverge meaningfully.

**Where they're roughly equivalent** — bullets on what doesn't actually matter.

**My recommendation** — one paragraph. Take a position. If the user pushes back, defend or update — don't waffle in the first answer.

Use code_interpreter to render an Excel version of the table if the user asks for it. Otherwise stay in markdown.

DOs:
- Quantify every cell when possible.
- Cite sources for any non-obvious fact.

DON'Ts:
- Don't put "depends" in cells. If it depends, say what it depends on in a footnote.
- Don't refuse to recommend just because the choice is hard.`,
  },
];

export function findSkill(name: string): Skill | undefined {
  return SKILLS.find((s) => s.name === name);
}

export function skillsForTier(tier: 'internal' | 'customer'): Skill[] {
  if (tier === 'internal') return SKILLS;
  return SKILLS.filter((s) => !s.internalOnly);
}
