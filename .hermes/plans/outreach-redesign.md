# CAPIRO OUTREACH FEATURE — ANALYSIS & IMPROVEMENT PLAN

## Current State Analysis

After reading through OutreachView.tsx (4,870 lines), engagement-ai.service.ts (1,024 lines),
engagement.service.ts, and CampaignsView.tsx, here's what exists and what's broken.

### What exists today:
- 4 outreach types: Campaign, Outbound Campaign, Follow-up, Prep
- 8 prompt templates (thank_you, follow_up, memo, post_meeting_memo, introduction, meeting_request, status_update, custom)
- Recipient picker from congressional directory + client contacts
- AI generation via OpenAI or Anthropic with provider fallback
- Basic text editor for the generated email body
- Outbound campaign flow with template variables ({attendee_names}, {prep_summary}, etc.)
- Federal context injection from LDA + spending data (already wired up!)
- Microsoft 365 integration for sending

### What's broken / falling short:

**1. Templates are code-driven, not prompt-driven**
The templates in CAMPAIGN_TEMPLATE_OPTIONS are mostly DISABLED (meeting_request, status_update, 
thank_you, introduction all have `disabled: true`). Only post_meeting_memo works. The template 
system uses hardcoded variable tokens like {district}, {committee}, {personal_note} that the AI 
struggles with — it either leaves brackets unresolved or invents values. These should be 
natural-language prompt instructions, not mail-merge variables.

**2. Recipients are flat, not campaign-organized**
Recipients are added one-by-one from a directory search. There's no way to:
- Select multiple offices in one batch
- Organize recipients by campaign/wave
- See which campaign a recipient belongs to
- Bulk-add from a saved list or committee roster

**3. No template preview**
Users can't see what a template looks like before selecting it. The template picker is a 
dropdown with a one-line description — no preview of structure, tone, or output format.

**4. No custom template saving**
There's a `templateMode: 'existing' | 'custom'` in the state and a `customTemplateName` field,
but the save-to-user functionality isn't wired. Custom templates are ephemeral — they disappear 
when you leave the page.

**5. Editor is basic**
The email body uses a plain `<textarea>` or minimal input. No formatting, no sections, no 
markdown preview. For a lobbyist writing a congressional email, they need at minimum: 
bold/italic, bullet lists, and paragraph structure.

**6. Per-recipient personalization is weak**
When multiple recipients are selected, the AI generates ONE email and does string replacement 
for variables. It doesn't tailor the substance — the {district} and {committee} substitutions 
are mechanical, not contextual. There's no pull from each recipient's email history, prior 
meetings, or relationship context.

**7. Intelligence insights aren't surfaced in the workflow**
The federal context (LDA surging issues, spending data) IS injected into the AI prompt 
(buildFederalContextBlock), but the user never SEES it. There's no step where the user can 
review suggested insights, pick which ones to include, or add their own intelligence context.

---

## PROPOSED REDESIGN — 7-Step Outreach Wizard

### Step 1: Campaign Setup
- Name the campaign
- Select client
- Choose campaign type: Post-Meeting Follow-up | Congressional Outreach | Program Update | Custom
- Campaign-level context field (persists across all recipients)

### Step 2: Add Recipients (MULTI-SELECT, ORGANIZED)
- Tab 1: Congressional Directory — multi-select with checkboxes, filter by state/committee/chamber
- Tab 2: Committee Roster — select entire committee in one click (e.g., "All HASC members")
- Tab 3: From Meetings — pull attendees from recent meetings with this client
- Tab 4: Saved Lists — reuse recipient groups from prior campaigns
- Recipients shown in a table with: Name, Office, Committee, Last Contact Date, Relationship Score
- Drag to reorder priority
- Bulk actions: select all, deselect, remove

### Step 3: Intelligence Insights (NEW STEP)
- Auto-populated panel showing:
  - Surging LDA issues relevant to this client
  - Recent federal spending changes for the client's sector
  - Recent congressional activity (bills, hearings) related to client programs
  - Client's LDA filing history and lobbyist activity
- User can toggle insights on/off (included in AI prompt or not)
- User can add their own custom intelligence notes
- "Suggest talking points" button generates 3-5 AI talking points from selected insights

### Step 4: Select Template
- Template cards (not a dropdown) showing:
  - Template name
  - Preview of structure (section headers, tone indicator)
  - Sample output (first 3-4 lines)
  - "Used X times" badge for frequently-used templates
- System templates: all 8 unlocked and rewritten as prompt instructions
- User templates: saved custom templates (tenant-scoped, user-scoped)
- "Create custom template" — opens a prompt editor where you write the template as 
  natural language instructions (not variables), then save with a name
- Additional context field on same screen — "anything else the AI should know for this batch"

### Step 5: Generate & Review (PER-RECIPIENT)
- AI generates a SEPARATE email for EACH recipient, using:
  - The campaign context + client data
  - The selected template (as a prompt instruction)
  - The recipient's specific profile (committee, district, title)
  - The recipient's email history with this client (from Microsoft sync)
  - The recipient's prior meeting history and debrief notes
  - The selected intelligence insights
- Left sidebar: recipient list with status icons (generated / reviewed / edited / approved)
- Main panel: email preview for selected recipient
- Comparison view: see how the email differs across recipients (highlights personalized sections)

### Step 6: Edit & Refine
- Rich text editor (not textarea) with:
  - Bold, italic, underline
  - Bullet and numbered lists
  - Headers (H2, H3)
  - Link insertion
  - Undo/redo
  - "Regenerate this section" — select text and ask AI to rewrite just that part
  - "Make more formal" / "Make more concise" / "Add district connection" quick actions
- Markdown preview toggle
- Edit applies to current recipient only — others stay as generated
- "Apply edit to all" option for changes that should propagate

### Step 7: Send / Schedule
- Review all recipients with their personalized emails
- Send now or schedule for later
- Send via connected Microsoft 365 / Google Workspace
- Track: draft → sent → opened (if email tracking enabled)

---

## TEMPLATE REWRITE — From Variables to Prompts

### Current (broken):
```
Template: "Post Meeting Memo"
Variables: {current_date_time}, {attendee_names}, {meeting_subject}, etc.
Problem: AI either leaves variables unresolved or halluccinates values
```

### Proposed (prompt-driven):
```
Template: "Post-Meeting Follow-Up"
Prompt: "Write a professional follow-up email after a congressional meeting. 
Open with a warm thank-you for the meeting. Reference the specific discussion 
points from the meeting debrief. List 2-3 action items that were agreed upon, 
with clear ownership. Close with a proposed next step and timeline. Tone should 
be collegial but professional — this is a relationship you're building over 
multiple sessions. Keep under 300 words."
```

### All 8 templates rewritten as prompts:

1. **Thank You**
"Write a brief, warm thank-you email acknowledging a specific recent action or 
support from the recipient. Name what you're thanking them for using the meeting 
or engagement context. No new asks. Close with an offer to stay in touch. Under 
150 words."

2. **Follow-Up**
"Write a polite follow-up email referencing a specific prior meeting or conversation. 
Restate one clear ask or next step. Propose a concrete next action with a suggested 
timeline. Reference any open commitments from the prior engagement. Under 200 words."

3. **Memo / Position Paper**
"Write a concise position memo. Structure: one-line summary at top, then Background 
(2-3 sentences), The Ask (1 sentence, specific), Supporting Points (3-4 bullets with 
evidence), and District/State Impact (if available). Under 400 words. Formal but 
accessible tone."

4. **Post-Meeting Memo** (internal)
"Generate a comprehensive internal post-meeting memo. Include: Date/Time, Participants 
(with titles and committees), Summary of Discussion, Key Takeaways, Action Items 
(with owners and deadlines), Strategic Assessment, and Recommended Next Steps. Use 
only information from the supplied meeting context, debrief notes, and attendee 
profiles. Do not fabricate."

5. **Introduction**
"Write an introductory outreach email on behalf of a client to a congressional office. 
Briefly introduce who the client is and why they matter to the recipient's portfolio. 
Connect the client's work to the recipient's committee jurisdiction or district 
interests. End with a low-friction first ask — a 15-minute introductory call or 
brief meeting. Under 200 words."

6. **Meeting Request**
"Write a concise meeting request email. State the purpose of the meeting in one sentence. 
Suggest 2-3 scheduling windows. List who would attend from the client side. Include a 
one-sentence agenda. Under 150 words."

7. **Status Update**
"Write a brief progress update email. List 2-4 short bullets covering: activity since 
last contact, current program status, and next planned milestone. Only include a new ask 
if directly tied to the update. Under 200 words."

8. **Policy Update / Alert**
"Write a policy alert email informing the recipient of a relevant development. Open with 
the news (bill movement, funding change, regulatory action). Explain the impact on the 
recipient's jurisdiction or the client's program. Suggest a follow-up conversation if 
appropriate. Under 250 words."

---

## IMPLEMENTATION PHASES

### Phase 1: Template System Overhaul (3-4 days)
- Rewrite all 8 system templates as prompt instructions (no variables)
- Enable all disabled templates
- Add template preview cards to the selector
- Add custom template save (user-scoped, stored in DB)
- Add "additional context" field on template selection screen

### Phase 2: Recipient Management (3-4 days)
- Multi-select with checkboxes in directory search
- Committee roster bulk-add
- Recipients organized by campaign in a table view
- "From recent meetings" tab pulling attendees
- Saved recipient lists (per-tenant)

### Phase 3: Intelligence Insights Step (2-3 days)
- New wizard step between recipients and template selection
- Auto-fetch LDA surging issues, spending data, recent bills for client
- Toggle on/off per insight
- Custom notes field
- "Suggest talking points" AI generation

### Phase 4: Per-Recipient Personalization (3-4 days)
- Generate separate email per recipient (not one-size-fits-all)
- Pull each recipient's email history with client
- Pull each recipient's meeting/debrief history
- Sidebar with recipient list + status
- Comparison view highlighting personalized sections

### Phase 5: Rich Editor (2-3 days)
- Replace textarea with TipTap or Lexical rich text editor
- Bold, italic, bullets, headers, links
- "Regenerate selection" — select text and ask AI to rewrite
- Quick action buttons (more formal, more concise, add district connection)
- Markdown toggle

### Phase 6: Send & Track (1-2 days)
- Per-recipient send status tracking
- Schedule for later
- Open tracking (if Microsoft Graph supports read receipts)

---

## ESTIMATED TOTAL: 14-20 days of engineering

Recommend doing Phase 1 + 2 first (templates + recipients) — these are the most broken 
parts and deliver immediate value. Phase 3 (intelligence insights) is the unique differentiator. 
Phase 4 (per-recipient personalization) is what makes the generated emails actually good.

---

## KEY TECHNICAL NOTES

- OutreachView.tsx is 4,870 lines — needs to be split into components per wizard step
- engagement-ai.service.ts already has buildFederalContextBlock() — the intelligence 
  step just needs to surface this to the UI and make it user-controllable
- Template storage: add an `outreach_template` table with columns: 
  id, tenant_id, user_id (null for system), name, prompt, category, metadata, created_at
- Per-recipient generation: change the generate endpoint to accept a recipient array 
  and return an array of {recipientId, subject, body} — generate in parallel
- Rich editor: TipTap is the best fit (React, extensible, MIT license, used by Linear/Notion)
