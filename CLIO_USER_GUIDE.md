# Clio — Complete User Guide

**Clio** is Capiro's AI chief of staff for government-affairs professionals. It answers questions
about your clients, federal & state intelligence, and engagements; drafts briefings, memos, and
outreach; takes actions (notes, email, drafts); and proactively flags things that need attention —
always grounded in Capiro's authoritative data first, the public web only as backup.

> **Availability:** the newest trust features — clickable citations, confidence checks, "remember
> this," and Regenerate/Edit — are merged and ship on the **next deploy**. Everything else is live.

---

## 1. Opening & navigating
- **Open Clio:** click the Clio bubble (the floating button, bottom-right of any page). If you have
  pending proactive alerts, a red badge shows the count.
- **Side drawer:** Clio opens as a right-side drawer. **Drag its left edge** to resize (360px up to
  ~90% of the screen).
- **Context bar:** shows where you are (Engagement Manager · *Client*, Intelligence Center, Portfolio,
  Workspace, Directory, Settings) — so you can say "this client" / "this page."
- **Empty state:** a fresh chat shows a welcome + suggestions to get you started.
- **Typing:** **Enter** sends, **Shift+Enter** for a new line. The send button is disabled while a
  response is streaming.
- **Close:** the **✕** in the header or click the backdrop.
- **Access:** `standard_user` and above (client-portal users don't have Clio).

## 2. Conversations & history
- **New conversation:** the **＋** icon (starts fresh; aborts anything in flight).
- **History rail:** the **history** icon opens a list of past conversations, grouped by client, with
  relative timestamps — click one to reload it.
- **Title & client:** rename the conversation and assign it to a client with the title field +
  dropdown, then **Save**. Assigning a client scopes Clio's context to that client.
- **Archive / restore:** archive finished conversations (and restore them later).

## 3. What you can ask — capabilities
Clio chooses which data tools to call based on your question, then grounds its answer in the results.
**Be specific** — names, bill numbers, agencies, and date ranges sharpen the answer.

**Federal & state intelligence**
- Congressional **bills** (118th/119th) — keyword, policy area, congress, recent activity; sponsors + latest action.
- **LDA** lobbying-disclosure filings — client, registrant, issue area.
- **SEC EDGAR** filings (10-K, 10-Q, 8-K, DEF 14A, S-1…) — company, form type, CIK, date.
- **FARA** foreign-agent registrations — registrant, foreign principal, country, status.
- **Federal grants** (Grants.gov NOFOs) — agency, status, deadlines.
- **GAO** reports & testimonies; **CRS** reports.
- **Committee hearings/markups** — committee, chamber, date.
- **State bills** (OpenStates) — state, subject, session.
- **Policy news** (Roll Call, Politico, Axios, The Hill, Brookings, agency press…).
- **Economic data** — BLS, Census/ACS district demographics, BEA GDP/industry.
- **Federal lobbying intelligence** — surging LDA issues, trending topics, spending, data-source counts.
- **Public web** search + **page scraping** (supplemental, after internal sources).

**Your clients & engagements**
- Client context — profile, recent meetings, threads, contacts, tasks.
- Search across your clients, meetings, mail, notes, and directory notes.

*Example prompts:* "Recent defense-approps bills with sponsors + latest action." · "LDA filings for
*Acme* in 2025." · "Context on *<client>* — meetings, threads, open tasks." · "Committee hearings
this month on energy, both chambers."

## 4. How Clio shows its work (trust layer)
- **Thought-process timeline** (above the answer): Clio's plan for the turn + a live list of the
  tools it's calling, in order, each flipping from **running → done/error**.
- **Confidence dots:** each step shows high / medium / low confidence (green / yellow / orange).
- **Tier badge:** a "deep" indicator when Clio uses its richer retrieval tier (vs. the fast tier for
  quick lookups) — chosen automatically by question type.
- **Collapsed summary:** when done, it folds to "Used N tools · M sources."

## 5. Citations
When Clio uses a source it cites it inline as **`[1]`, `[2]`**. Click a chip to open the **source
drawer** (type, title, snippet, and a link where available). Citations are typed (bill, filing,
client email, meeting note, GAO report, web…), and invented markers are stripped automatically.

## 6. Confidence checks (deliverables)
For **briefings/memos**, Clio runs a second pass that checks each factual claim against the retrieved
sources:
- ✅ all claims supported,
- ℹ️ some claims couldn't be tied to a source,
- ⚠️ **"Low confidence"** banner when >20% are unsupported — with the flagged claims shown (wavy
  yellow underline + tooltip).
Use it as a "verify before you rely on this" signal. Plain chat answers aren't gated this way.

## 7. Conflict warnings
If Clio sees contradictory signals (e.g., what you said vs. what the data shows, or internal vs.
public-web data), it surfaces a **conflict banner** and prioritizes Capiro's internal data unless you
say otherwise — rather than silently picking one.

## 8. Output templates & skills
Some requests trigger a **skill** that gives the output a consistent structure (and you'll see the
planned sections up front):
- **Government Affairs Briefing** → *Executive Summary · Signal Scan · Opportunities · Risks ·
  Recommended Actions.*
- **Outreach Draft** → *Subject Line · Opening · Core Message · Ask/CTA · Close.*
Just ask for a "briefing" or a "draft."

## 9. Deliverables & artifacts
- **Meeting briefs** and **policy memos** are produced as **saved artifacts** (not just chat text),
  linked to the conversation.
- **Versioning:** you can save new versions of an artifact without losing the prior ones.

## 10. Memory — Clio remembers across conversations
- **Automatic:** Clio extracts durable facts from substantial exchanges and shows them as
  **"Clio learned: …"** chips, each with an **undo** to forget it.
- **Explicit:** say **"Remember that I go by Ninja"** / **"Remember our cadence is monthly"** — Clio
  saves it and recalls it in future chats.
- **Scope:** **personal** (just you) or **firm-wide** (shared). Relevant memories are pulled into
  context automatically (semantic recall).

## 11. Conversation controls
- **Stop** — appears while answering; halts generation **and** the server-side model call (so it
  isn't burning tokens for an answer you don't want). The partial text is kept.
- **Regenerate** — on the last answer; re-runs your question for a fresh take.
- **Edit** — on your last message; revise the wording and resend (Clio discards the old answer and
  everything after it).

## 12. Modes
- **Write mode** (toggle): Clio applies its output to the page you're on — e.g., fills/updates an
  **outreach draft** in the Engagement Manager, or updates **workflow fields**, live.
- **Research mode** (toggle) — **Deep Research**, a multi-step investigation:
  1. **Plan** — Clio proposes a research plan and asks a few **clarifying questions**;
  2. **Clarify** — answer them inline (or "Skip — use best judgment");
  3. **Gather** — agentic loop across all data tools + the web;
  4. **Synthesize** — a long, **cited report** you can **Open as page** or **Download as Word**.
  Research sessions are saved (resume, delete, re-export).

## 13. Email (Microsoft 365)
With a connected M365 account (Settings → Integrations), Clio can **list** recent threads (optionally
by client), **reply** to a thread, and **send** email on your behalf. Emails can be associated with a
client for context.

## 14. Notes
Clio can **save notes** for you — and, tied to a meeting, an **encrypted, confidential meeting note**
with an access level (kept private/at-rest-encrypted).

## 15. Proactive alerts
Clio surfaces **alerts** without being asked — e.g., an upcoming meeting that has no prep notes, or a
client with no recent activity. They appear as a **badge** on the Clio button; open Clio to read and
**dismiss** them.

## 16. Tips for best results
Be specific (names/dates/agency) · select or name the client · ask for a format ("as a briefing") ·
iterate with **Edit/Regenerate** instead of retyping · click **citations** on high-stakes items ·
use **Research mode** for "give me the whole landscape," normal chat for quick lookups.

## 17. What Clio will & won't do
- **Says "I don't know"** when Capiro's tools/sources don't cover something, instead of guessing.
- **No invented figures or legal advice** — specific numbers come from tool results; FEC-sourced
  outputs carry an "informational, not legal advice" footer where applicable.
- **Won't fabricate citations.**
- **Tenant-isolated** — Clio only ever sees your firm's data.

## 18. Quick reference
| I want to… | Do this |
|---|---|
| Ask about bills/filings/spending/news | Ask with specifics |
| Structured briefing/memo | "Create a briefing on… / Draft a memo for…" |
| See where an answer came from | Click the `[N]` citation chips |
| Gauge reliability of a deliverable | Read the confidence banner / flagged claims |
| Deep, cited investigation | Toggle **Research**, answer the questions |
| Draft into the current page / workflow | Toggle **Write** |
| Make Clio remember / forget | "Remember that …" / **undo** the chip |
| Stop, redo, or fix a question | **Stop** / **Regenerate** / **Edit** |
| Work with email | Connect M365 → "list/reply/send…" |
| Save a (confidential) note | "Save a note… / save an encrypted meeting note" |
| Review past chats | **History** rail; rename / assign client / archive |
| Handle a proactive nudge | Open Clio → read the alert → dismiss |

---
*Odd behavior? Flag the conversation. The trust timeline + citations show exactly where any answer came from.*
