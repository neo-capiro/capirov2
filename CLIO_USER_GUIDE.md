# Clio — User Guide

**Clio** is Capiro's AI chief of staff for government-affairs professionals. It answers questions
about your clients, federal & state intelligence, and your engagements; drafts briefings, memos, and
outreach; and can take actions (notes, email) on your behalf — always grounded in Capiro's
authoritative data first, the public web only as backup.

> **Availability note:** The newest trust features — clickable citations, confidence checks,
> "remember this", and Regenerate/Edit — are merged and ship on the next deploy. Everything else
> described here is already live.

---

## 1. Getting started

- **Open Clio:** click the Clio bubble (bottom-right of any page). It opens a side drawer you can
  resize by dragging its left edge.
- **It knows where you are:** the context bar shows your current area (Engagement Manager,
  Intelligence Center, Portfolio, etc.) and the selected client, so you can say "this client" /
  "this page."
- **Conversations:** use the **history** icon to switch sessions, **+** to start a new one. Give a
  conversation a title and assign a client with the title/client controls, then **Save**.
- **Access:** Clio is available to `standard_user` and above. Client-portal users don't have it.

---

## 2. What you can ask (with examples)

Clio decides which data tools to call based on your question, then grounds the answer in the results.
Be specific — names, bill numbers, date ranges, and agencies all sharpen the answer.

**Federal & state intelligence**
- "What recent congressional bills touch defense appropriations? Include sponsors and latest action."
- "Search LDA filings for *Acme Corp* in 2025 — which issues and registrants?"
- "Any FARA registrations tied to *<country>*?"
- "Pull recent SEC 10-K filings for *<company>*."
- "GAO reports on grant oversight in the last year."
- "CRS reports on permitting reform."
- "Committee hearings this month on energy — House and Senate."
- "State bills in TX this session on data privacy."
- "Federal grant opportunities (posted) for broadband, with deadlines."
- "Economic snapshot for CA-12 — demographics and GDP."
- "What's trending in lobbying right now?"

**Your clients & engagements**
- "Give me context on *<client>* — recent meetings, threads, tasks."
- "What outreach have we done for *<client>* lately?"
- "Search my notes and mail for the *<topic>* conversation."

**Deliverables** (Clio produces a structured document — see Skills, §3.5)
- "Create a briefing on *<topic>* for *<client>*."
- "Draft a policy memo for *<client>* arguing *<objective>*."
- "Draft an outreach email to the sponsor's office."

**Email** (requires a connected Microsoft 365 account)
- "List my recent threads with *<client>*."
- "Reply to that thread confirming the meeting."
- "Send an intro email to *<address>* about *<topic>*." *(you review before it sends where applicable)*

**Public web** (supplemental only)
- "Search the web for recent news on *<topic>* and summarize."
- "Pull the readable text from *<url>*."

---

## 3. Key features

### 3.1 Grounded answers + clickable citations
When Clio uses a source, it cites it inline as **`[1]`, `[2]`**. Click a citation chip to open a
**source drawer** with the type, title, a snippet, and a link where available. Clio is built to cite
only real, retrieved sources — invented citation markers are stripped automatically.

### 3.2 The "thought process" timeline
Above a streaming answer you'll see Clio's live steps — which tools it's calling and what each
returned (counts, sample titles, confidence). This is the trust trail: you can see exactly where an
answer came from.

### 3.3 Confidence checks (on deliverables)
For briefings and memos, Clio runs a second pass that checks each factual claim against the retrieved
sources. If too many claims aren't backed by a source, the deliverable shows a **"Low confidence"**
banner and lists the flagged claims (yellow wavy underline). Use it as a prompt to verify before you
rely on the document. (Plain chat answers aren't gated this way.)

### 3.4 Memory — Clio remembers across conversations
- Clio automatically remembers durable facts from your conversations (preferences, names, ongoing
  priorities) and shows them as **"Clio learned: …"** chips, each with an **undo** to forget it.
- Tell it explicitly: **"Remember that I go by Ninja"** / **"Remember our reporting cadence is
  monthly."** It saves the fact and recalls it in future chats.
- Memory is scoped: **personal** (just you) or **firm-wide**. Remembered facts are pulled into
  context on later turns automatically.
- Manage memory anytime via the learned chips (undo) — full edit/inspect surface is on the roadmap.

### 3.5 Skills — structured deliverables
Certain requests trigger a **skill** that gives the output a consistent shape:
- **Government Affairs Briefing** → *Executive Summary · Signal Scan · Opportunities · Risks ·
  Recommended Actions.*
- **Outreach Draft** → *Subject Line · Opening · Core Message · Ask/CTA · Close.*
Just ask for a "briefing" or "draft" and Clio applies the right template + pulls the relevant data.

### 3.6 Control the response: Stop / Regenerate / Edit
- **Stop** — appears while Clio is answering; halts generation immediately (and stops server-side
  work, so it isn't wasting effort on an answer you don't want).
- **Regenerate** — on the last answer; re-runs your question for a fresh take.
- **Edit** — on your last message; tweak the wording and resend. Clio discards the old answer and
  responds to the revised question.

### 3.7 Deep Research mode
Toggle **Research** for a heavier, multi-step investigation. Clio will:
1. **Plan** the research and ask a few **clarifying questions** (answer them inline),
2. **Gather** across all its data tools + the web over several rounds,
3. **Synthesize** a long, **cited report** you can **Open as page** or **Download as Word**.
Use it for "give me the full landscape on X" rather than quick lookups.

### 3.8 Write mode
Toggle **Write** to have Clio apply its output to the page you're on (e.g., fill an outreach draft in
the Engagement Manager) instead of just replying in chat.

### 3.9 Attach files *(if enabled in your build)*
Where supported, drop a PDF/Word/text file into the chat; Clio extracts the text and uses it as
context for the next question. Treated as ephemeral unless you save it.

---

## 4. Tips for the best results
- **Be specific.** "Bills on X since June with sponsors" beats "bills about X."
- **Name the client** (or select it) so Clio scopes to the right context.
- **Trust Capiro data first.** Clio prioritizes internal/federal sources; it treats public-web
  results as supplemental and will say so.
- **Ask for a format.** "As a briefing," "as a memo," "bullet the risks" — Clio structures to match.
- **Iterate with Edit/Regenerate** instead of retyping.
- **Check the citations** on anything high-stakes — click through to the source.

---

## 5. What Clio will and won't do
- **It says "I don't know."** If Capiro's tools and indexed sources don't cover something, Clio tells
  you rather than guessing.
- **No invented numbers or legal advice.** Specific figures come from tool results, not the model;
  outputs that cite FEC sources carry an "informational, not legal advice" footer where applicable.
- **It won't fabricate citations** — markers that don't map to a real source are removed.
- **Tenant-isolated.** Clio only ever sees your firm's data; nothing crosses between firms.

---

## 6. Quick reference

| I want to… | Do this |
|---|---|
| Ask about bills/filings/spending | Just ask, with specifics (names, dates, agency) |
| Get a structured briefing/memo | "Create a briefing on… / Draft a memo for…" |
| See where an answer came from | Click the `[N]` citation chips → source drawer |
| Do a deep, cited investigation | Toggle **Research**, answer the clarifying questions |
| Make Clio remember something | "Remember that …" |
| Forget something it learned | Click **undo** on the "Clio learned" chip |
| Stop / redo / fix a question | **Stop**, **Regenerate**, or **Edit** on the message |
| Draft into the current page | Toggle **Write** |
| Work with email | Connect M365 in Settings → Integrations, then ask |

---
*Questions or odd behavior? Note the conversation and flag it — 👎 feedback on a message helps tune Clio.*
