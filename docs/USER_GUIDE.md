# Capiro — Complete User Guide

> Multi-tenant intelligence and engagement platform for federal lobbying / government‑affairs firms.
> This guide documents **every** feature, insight, and intel surface in the product — including
> capabilities that are actively under development. It is written for end users (lobbyists,
> engagement managers, principals) and for the team building the product.

---

## Table of contents

1. [Orientation — what Capiro is and how it's organized](#1-orientation)
2. [The left navigation, top bar, and global controls](#2-navigation--global-controls)
3. [Dashboard (Home)](#3-dashboard-home)
4. [Meri — the AI government‑affairs analyst](#4-meri--the-ai-analyst)
5. [Intelligence Center (Data Explorer) — 13 federal data sources](#5-intelligence-center)
6. [Changes Inbox + Daily Brief — the signal layer](#6-changes-inbox--daily-brief)
7. [Portfolio (Clients) + Client Intelligence profile](#7-portfolio--client-intelligence)
8. [Engagement Manager (meetings, mail, outreach, reports)](#8-engagement-manager)
9. [Workspace (strategies, workflows, document library)](#9-workspace)
10. [Program Elements (defense budget intelligence)](#10-program-elements)
11. [Directory (people / staffer intelligence)](#11-directory)
12. [Settings & administration](#12-settings--administration)
13. [Data sources & ingestion (under the hood)](#13-data-sources--ingestion)
14. [Insight catalog — every computed metric, defined](#14-insight-catalog)
15. [Roadmap / in‑progress surfaces](#15-roadmap--in-progress)

---

## 1. Orientation

Capiro is a **multi-tenant SaaS** (each lobbying firm is a "tenant" with isolated data,
enforced by row-level security on every query). Within a tenant you work across three pillars:

- **Intelligence** — a continuously synced warehouse of federal & state government data
  (lobbying disclosures, bills, rules, hearings, contracts, budget lines, filings, news).
- **Engagement** — your own meetings, email threads, outreach, and client relationship work,
  pulled in from a connected Microsoft 365 account.
- **Meri** — an AI analyst that sits on top of both, answers questions with citations, and
  drafts briefs/memos/emails.

Everything is **client-scoped**: most screens let you filter to a single client in your
portfolio, and the intelligence layer maps external data (a bill, a contractor, a PAC) to the
clients it affects.

**Architecture (for builders):** `apps/api` is a NestJS service (Clerk auth, tenant context,
Prisma/Postgres + pgvector); `apps/web` is Vite + React + Ant Design. Deployed on AWS ECS behind
one ALB at `app.capiro.ai` (`/api/*` → API, everything else → web). 95 Prisma models back the
feature set.

---

## 2. Navigation & global controls

### Left sidebar (primary navigation)

| Item | Route | What it is |
|------|-------|------------|
| **Dashboard** | `/` | Your morning command center — signals, brief, meetings, deadlines. |
| **Engagement** | `/engagement` | Meetings, mail, outreach, and reporting for client relationships. |
| **Workspace** | `/workspace` | Strategies, workflows, and the document/deliverable library. |
| **Planner** | *(disabled)* | Reserved — calendar/task planning surface, not yet shipped. |
| **Intelligence Center** | `/explorer` | Searchable warehouse of all 13 federal data sources. |
| **Program Elements** | `/program-elements` | Defense RDT&E/procurement budget‑line intelligence. |
| **Portfolio** | `/clients` | Your client roster + per-client intelligence profiles. |
| **Directory** | `/directory` | People intelligence — Hill staffers and contacts. |
| **Stakeholders** | *(disabled)* | Reserved — stakeholder mapping, not yet shipped. |
| **Collaborators** | *(disabled)* | Reserved — team collaboration surface, not yet shipped. |
| **Settings** | `/settings` | Personal, team, branding, integrations, billing, admin. |

The sidebar shows **count chips**: your portfolio client count, and the number of unread
intelligence changes. It collapses to an icon rail.

### Top bar

- **Tenant brand** — your firm's logo/name (white-labelable in Branding settings).
- **Global search** — search box for quick lookups across the app.
- **Quick Log** — one-click logging of an interaction/note without leaving the page.
- **Changes Inbox bell** — opens an inline dropdown of recent intelligence changes (unread
  badge); "View all" deep-links to the full Changes Inbox.
- **Sync Inbox** (bottom of sidebar) — manually pulls fresh mail/calendar from your connected
  Microsoft 365 account. Auto-syncs silently every 15 minutes when an inbox is connected.

### The Meri drawer

A slide-out AI chat panel (the `ChatDrawer`) is available app-wide. See [section 4](#4-meri--the-ai-analyst).

---

## 3. Dashboard (Home)

Route: `/`. Your daily starting point. Per the product direction it is deliberately focused on
**signals + engagement context** (no clutter). It is composed of these blocks:

### 3.1 Greeting row
Time-aware greeting ("Good Morning, Neo."), today's date, the current **Congress session**, a
count of **new signals overnight**, and a **critical actions today** callout when any
critical-severity change exists.

### 3.2 Needs Attention banner
A single-row scroller of up to **10 most urgent items**, severity-ranked
(critical → notable → info). It aggregates three streams:

1. **Comment-period deadlines** — open federal-rule comment windows closing soon, with the
   days-to-deadline and the affected client.
2. **Hearings & markups in the next 7 days** — committee hearings and markups from the
   "coming up" feed.
3. **Tracked changes** — program-element budget moves, per-bill stage alerts, and
   high-severity Federal Register / FEC events mapped to your clients.

Each card deep-links to the relevant detail (the PE watch page, the Changes Inbox, or the
comment-deadlines tab of the Intelligence Center).

### 3.3 Meri Briefing
A full-width AI-synthesized **daily brief** card. Meri summarizes the day's client-relevant
activity in prose; the UI highlights urgency cues (deadlines in red, legislative movement in
amber). Footer shows the synthesizing model and links to "See all changes."

### 3.4 Client Engagement strip
This-week meetings, **grouped by week** with a day strip (Mon–Sun, ET). Click a day to see that
day's meetings with client, attendees, and prep status. Links to the Engagement Manager.

### 3.5 Outreach Drafts
Your recent outreach records (draft / sent / opened / failed) with recipient counts and the
associated client.

### 3.6 Open Workflows
Active workflow instances across **all** clients (cross-client view), with status.

### 3.7 Upcoming Deadlines
Combines workflow due-dates and comment-period deadlines into one chronological list.

---

## 4. Meri — the AI analyst

Meri is Capiro's embedded AI government-affairs analyst. It runs an **agentic, streaming
tool-use loop** (Anthropic-native): you ask a question, Meri decides which internal data tools
to call, pulls grounded data, and answers **with source attribution**. It can also produce and
persist artifacts (briefs, memos) and — when connected — act on your inbox.

### Meri's 22 tools

**Context & search**
1. **get_client_context** — load authorized client context, recent meetings, threads, contacts, tasks.
2. **search_research_sources** — free-text search across clients, meetings, mail, notes, directory notes.
3. **query_intelligence** — surging LDA issues, trending topics, recent bills, federal spending, and counts of every available data source; optionally scoped to a client.

**Federal & state data search**
4. **search_congress_bills** — 118th/119th Congress bills by keyword, policy area, congress, recent activity (sponsor, latest action, cosponsor count).
5. **search_lda_filings** — Lobbying Disclosure Act filings by client, registrant, issue area, keyword.
6. **search_sec_filings** — SEC EDGAR filings (10-K, 10-Q, 8-K, DEF14A, S-1) by company, form type, CIK, date.
7. **search_fara_registrations** — Foreign Agents Registration Act records by registrant, foreign principal, country, status.
8. **search_federal_grants** — Grants.gov NOFOs by agency, keyword, status, date (funding amounts, eligibility, deadlines).
9. **search_gao_reports** — GAO reports/testimonies by keyword, type, topic, agency (with recommendation counts).
10. **search_state_bills** — state legislature bills via OpenStates by state, keyword, subject, session.
11. **search_intel_articles** — aggregated policy news (Roll Call, The Hill, Axios, Politico, Brookings, agency press).
12. **search_committee_hearings** — hearings, markups, meetings by committee, chamber, keyword, date.
13. **search_crs_reports** — Congressional Research Service reports by keyword, topic, author.
14. **query_economic_data** — BLS labor stats, Census ACS district demographics, BEA GDP/industry data.

**Open web (supplemental, used only after internal tools)**
15. **search_public_web** — public internet search for recent developments.
16. **scrape_web_page** — fetch readable text from a public URL (blocks localhost/private targets).

**Create / act (artifacts & email)**
17. **create_meeting_brief** — generate + persist a deterministic meeting brief from authorized data.
18. **draft_policy_memo** — generate + persist a policy memo from client context.
19. **save_note** — save a user-scoped Meri note (and optionally an encrypted meeting note).
20. **send_email** — send via the tenant's connected Microsoft 365 account.
21. **list_emails** — list recent inbox threads, optionally filtered by client.
22. **reply_email** — reply to a thread via Microsoft 365.

### How Meri stays trustworthy
- **Grounded with citations** — answers attribute sources; conflict surfacing is the model's job.
- **Authorization-scoped** — every tool respects tenant/client boundaries; it can only see data you're authorized for.
- **Artifacts are persisted** — briefs and memos Meri produces are saved and appear in the artifact panel.
- **Memory is gated** — durable facts Meri learns are stored only above a confidence bar and default to private scope; firm-wide promotion requires high confidence.
- **Proactive alerts run on a schedule**, not on every message, and surface in the dashboard's intel inbox — not as chat pop-ups.

---

## 5. Intelligence Center

Route: `/explorer` (labeled **Intelligence Center**). A unified, faceted, searchable browser
over **13 federal/state data sources**. Each source is a tab with search, filters, a results
table (25/page), and a detail drawer. `?source=<key>` deep-links a specific tab.

| Source | What it contains |
|--------|------------------|
| **LDA Filings** | Lobbying Disclosure Act — 500K+ filings, ~5 years. Client, registrant, issues, $ spend. |
| **Federal Contractors** | Top contractors with no-bid totals + agency spending mix. |
| **Congress Bills** | Bills with sponsor, latest action, subject tags (118th/119th). |
| **Federal Register** | Proposed/final rules + comment-period deadlines. |
| **Hearings** | Committee hearings & markups by chamber + date. |
| **GAO Reports** | Oversight reports + recommendations by topic/agency. |
| **CRS Reports** | Congressional Research Service briefings. |
| **FEC Contributions** | Itemized political contributions by cycle. |
| **FARA Filings** | Foreign-agent registrations by country/principal. |
| **SEC Filings** | 8-K, 10-Q, S-1, etc. from SEC EDGAR. |
| **News Feed** | RSS-ingested intel articles (Politico, Roll Call, etc.). |
| **State Bills** | State legislation via OpenStates. |
| **Comment Deadlines** | Open comment periods on federal rules, soonest-closing first. |

Supporting intelligence pages:
- **Knowledge Graph** (`KnowledgeGraphPage`) — relationship/entity graph view.
- **Issue Leaderboard** (`/intelligence/issues/:code`) — who's most active on a given lobbying issue code (competitor view).
- **Intelligence Mappings** (Settings) — control how external data maps to your clients.

---

## 6. Changes Inbox & Daily Brief

The **signal layer** that turns raw sync into "what changed and why you care."

- **Changes Inbox** (`/intelligence/changes`, plus the top-bar bell dropdown) — a feed of
  detected `IntelligenceChange` events: program-element budget moves, bill stage changes,
  high-severity Federal Register actions, FEC events. Each carries a **severity**
  (critical / notable / info), the **change type**, related client IDs, related PE codes, and
  related issues. Items can be marked read/consumed; the unread count drives the sidebar chip.
- **Daily Brief** (`/api/intelligence/daily-brief`) — Meri's prose synthesis of the day's
  client-relevant activity, shown on the dashboard.
- **Coming Up** — upcoming hearings/markups (next 7 days) feeding the Needs Attention banner.
- **Comment Alerts** — open federal comment periods with days-to-deadline and client relevance scores.

---

## 7. Portfolio & Client Intelligence

### 7.1 Portfolio (`/clients`)
Your client roster. Per client you can:
- Create / edit / delete clients; **bulk-import** clients from a file.
- Upload a client **logo** (presigned S3 upload).
- Maintain **capabilities** (what the client does/sells) with a full **submission history** log.
- Track **client people** (contacts at the client).
- Add notes.

### 7.2 Client Intelligence profile (Client Intel V1)
The deep per-client intelligence dossier, organized into scroll-spy **sections**:

**Snapshot** — identity + the headline signals:
- **Top Alerts** — the most important items affecting this client right now.
- **Trajectory chip** — a logistic-style classifier on the client's lobbying/spend signal,
  labeled **exploding / growing / stable / declining / contracting / unknown**
  (thresholds: ≥+35% exploding, ≥+12% growing, ≤−8% declining, ≤−30% contracting).
- **District Nexus panel** — economic/representation ties (BLS/Census/BEA + district data).

**Financial Footprint** —
- **ROI Hero** — all-time lobby spend vs. contract wins, and the gap/ratio.
- **ROI-by-quarter chart** — spend/return series over time.
- **FEC Contribution panel** — political giving tied to the client (deduped by candidate ID).

**Legislative & Regulatory** —
- **Bill Kanban** — bills touching the client, arranged by pipeline stage, with controls/filters.
- **Passage Probability bar** — a heuristic 0–1 likelihood derived from each bill's latest action text.
- **Hearings / Markup list** — relevant upcoming/again hearings and markups.
- **Regulatory Lifecycle rail** — where relevant rules sit in the rulemaking lifecycle.
- **Resolution Graph card** — visual of resolution/relationship structure.

**Relationships** —
- **Office Recommender** — ranked congressional offices to target. Score combines
  **committee relevance + district nexus + ex-staffer ties + FEC giving** (base 0.35 plus
  weighted boosters, capped at 1.0). This is the "who should we go see" engine.

Each section degrades independently — a failure in one query shows an error in that panel only,
not a blank page. The profile also exposes an **engagement health trend** (weekly score based on
completed engagement tasks) and a Meri-generated **report card / client briefing**.

---

## 8. Engagement Manager

Route: `/engagement`. Pulls your real client work in from **Microsoft 365** (calendar + mail)
and layers AI prep/debrief and outreach on top. Tabs:

### 8.1 Overview
Client-engagement summary and quick context.

### 8.2 Meetings
- Calendar + mail synced from connected Microsoft 365 accounts (auto every 15 min; manual sync available).
- Meetings carry **attendees**, **attachments**, **client association** (with an association
  score + reason, and manual override). Context is **strictly client-scoped** — only
  client-linked meetings and client-associated email threads; other attendees' domains don't
  leak unrelated context.
- **Meeting Prep** — AI-generated agenda, talking points, risks, follow-ups, and summary
  (status: generated / edited / approved / stale / failed).
- **Meeting Debrief** — post-meeting writeup; can ingest attachments/transcripts. Supports
  **confidential / access-controlled** notes and debriefs.
- **Encrypted meeting notes** — sensitive notes stored encrypted when configured.

### 8.3 Outreach
A guided **outreach wizard** (v2: New Outreach Wizard with steps — Direction, Context,
Recipients, generate/review). Supports:
- **Templates** (hand-authored + AI templates).
- **Intelligence Insights** injected into the draft (relevant signals for the recipient/issue).
- **Email editor**, recipient selection, send/schedule.
- **Campaigns** — multi-recipient outreach campaigns with per-recipient tracking.
- A navigation **lock** while a wizard is in progress (so you don't lose work).

### 8.4 Reports
Engagement reporting, including **target-office reports** and exportable summaries.

**Microsoft 365 connection** is managed via OAuth (Settings → Integrations). Providers modeled:
`microsoft_365`, `google_workspace`, `imap_caldav`, `manual`.

---

## 9. Workspace

Route: `/workspace`. Where strategy and deliverables live.

### 9.1 Overview (`/workspace/overview`)
Workspace landing/summary.

### 9.2 Library / Catalog (`/workspace/library`)
The **document & workflow template library**. Browse templates grouped by category, each with a
name, description, and category badge; add one to create a working instance. Templates back
deliverables like white papers, one-pagers, fact sheets, talking points, coalition materials, etc.

### 9.3 Workflows (`/workspace/workflows`)
Active **workflow instances** (Kanban board + drawer). A workflow instance is a tracked,
multi-step deliverable created from a template. Statuses are config-driven; instances appear on
the dashboard's Open Workflows panel.

### 9.4 Strategies
- **Strategies list** (`/workspace/strategies`) and **new strategy wizard** (`/workspace/strategy/new`).
- **Strategy dashboard** (`/workspace/strategy/:id`) — targets, deadlines, linked workflow
  instances, and data sync. You can add/edit **strategy targets**, **link/unlink workflow
  instances**, **create submissions**, and **sync data** into the strategy.
- **White Paper editor** (`/workspace/strategy/:id/white-paper/:instanceId`) — author a
  white-paper deliverable tied to a strategy.

---

## 10. Program Elements

Route: `/program-elements`. **Defense budget intelligence** built on DoD J-book (budget
justification) ingestion. This is the deepest vertical data set in the product.

### 10.1 Program Element Finder (`/program-elements`)
Search/browse defense **Program Elements (PEs)** — RDT&E and procurement budget lines — filtered
by service (Army / Navy / Air Force / all). Each PE has a code, title, mission narrative,
project breakdown, and multi-year funding.

### 10.2 Program Element Watch (`/program-elements/:peCode`)
The per-PE detail page:
- **FY History chart** — the multi-year funding curve.
- **FY Detail drawer** — per-fiscal-year request detail with **source values** and page-level
  citations (deep-links into the actual J-book PDF page).
- **Contractors panel** — contractors associated with the PE.
- **Bills Touching PE panel** — legislation that references/affects this program element.
- **Program Team panel** — acquisition personnel (PEO/PM org) tied to the PE, with confidence
  pills and source citations.
- **Watch** — subscribe to a PE so its budget moves surface as changes/alerts.

### 10.3 Mark-up Monitor (`/program-elements/mark-up-monitor`)
Tracks each PE through the **defense appropriations/authorization mark-up pipeline**:
- Columns: **HASC, SASC, HAC-D, SAC-D, Conference, Enacted**.
- Shows the President's **Request** vs. each committee's mark, and computes **Divergence**
  (where the chambers/committees disagree) — the early-warning signal for budget fights.

### Provenance
Budget data is public-domain and read-only. Every figure carries a **ProgramElementSource**
citation (document type R/P/O, exhibit type e.g. R-1/R-2/R-2A, fiscal year, source URL, and the
exact PDF page), so you can open the source and verify the line.

---

## 11. Directory

Route: `/directory`. **People intelligence** — congressional staffers and contacts.
- Search **contacts** and **staffers**.
- Per-contact **notes** (add/read).
- **Favorites** — star contacts for quick access.
This feeds the Office Recommender's "ex-staffer ties" signal and outreach recipient selection.

---

## 12. Settings & administration

Route: `/settings`. Tabs are role-filtered (the API enforces the real security boundary):

| Tab | Purpose |
|-----|---------|
| **Personal** | Your profile preferences. |
| **Contact info** | Your contact details (used in outreach/signatures). |
| **Team** | Manage tenant members (admin). |
| **Branding** | White-label logo/name shown in the top bar (admin). |
| **Clients** | Admin client management view. |
| **Integrations** | Connect Microsoft 365 (calendar + mail) via OAuth; see connection status/last sync. |
| **Billing** | Subscription/billing (admin). |
| **Intelligence Mappings** | Control how external intelligence maps to your clients. |
| **Tenants** | Capiro super-admin: cross-tenant administration + **impersonation** (act-as a tenant). |

Other platform surfaces: **Demo Requests** (inbound demo lead capture), **Webhooks**
(Clerk user/event sync), **Health** (service health/observability), **Audit Log** (every
sensitive action is recorded).

---

## 13. Data sources & ingestion (under the hood)

Capiro continuously ingests and normalizes public data via scheduled **sync runs** (tracked in a
`SyncRun` table with inserted/updated/quarantined/duration/error metrics). Sources behind the
features above:

- **Lobbying:** LDA filings, registrants, lobbyists, contributions, issue codes, government entities.
- **Campaign finance:** FEC committees & itemized contributions.
- **Legislation:** Congress bills (actions, committees, subjects); state bills + legislators (OpenStates).
- **Regulatory:** Federal Register documents (rules + comment periods); Regulatory dockets.
- **Oversight/research:** GAO reports, CRS reports.
- **Corporate/foreign:** SEC filings, FARA registrations.
- **Spending:** Federal contractors, agencies, industries; federal grants (Grants.gov).
- **Economics:** BLS series + data points, Census districts (ACS), BEA data.
- **News:** Intel articles (RSS).
- **Defense budget:** Program Elements + sources + projects + yearly values + milestones +
  quarantine, ingested from DoD Comptroller J-books (R-1/P-1 master lists, R-2/R-2A detail
  volumes) using deterministic PDF extraction with page-level provenance.
- **Acquisition personnel:** PEO/PM org people with sources, quarantine, and merge-candidate
  review (fuzzy de-duplication).

Data-quality discipline is built in: a **quarantine** stage for low-confidence records, a
**merge-candidate review queue** for likely-duplicate people, and email-safety rules
(domains only, never full emails). Empty datasets render honest empty states — the product does
**not** fabricate sample data.

---

## 14. Insight catalog — every computed metric, defined

| Insight | Where it appears | How it's computed (plain English) |
|---------|------------------|-----------------------------------|
| **New signals overnight** | Dashboard greeting | Count of tracked changes detected in the last 24h. |
| **Critical actions today** | Dashboard greeting | Count of critical-severity changes. |
| **Needs Attention** | Dashboard | Top 10 of {comment deadlines, hearings/markups ≤7 days, mapped high-sev changes}, severity- then urgency-ranked. |
| **Daily Brief** | Dashboard | Meri prose synthesis of the day's client-relevant activity. |
| **Comment-period alerts** | Dashboard / Intel Center | Open federal comment windows with days-to-deadline and a per-client relevance score. |
| **Trajectory** | Client Snapshot | Logistic classifier on spend growth → exploding/growing/stable/declining/contracting. |
| **ROI (lobby vs. wins)** | Client Financial Footprint | All-time lobby spend vs. all-time contract wins, plus the gap/ratio. |
| **ROI-by-quarter** | Client Financial Footprint | Spend/return time series. |
| **Engagement health trend** | Client profile | Weekly score driven by completed engagement tasks. |
| **Passage probability** | Client Legislative section | 0–1 heuristic from each bill's latest-action text. |
| **Office Recommender score** | Client Relationships | 0.35 base + weighted (committee relevance + district nexus + ex-staffer ties + FEC giving), capped at 1.0. |
| **District Nexus** | Client Snapshot | Economic/representation ties from BLS/Census/BEA + district data. |
| **Mark-up Divergence** | Program Elements | Spread between President's Request and HASC/SASC/HAC-D/SAC-D marks. |
| **FY funding curve** | Program Element Watch | Multi-year request/appropriation series per PE with source-cited values. |
| **Meeting association score** | Engagement | Confidence that a synced meeting belongs to a given client (+ reason, overridable). |
| **Report card / client briefing** | Client profile / Meri | Meri-generated narrative assessment from the client's full data. |
| **Issue leaderboard** | Intelligence | Ranked competitor/registrant activity on a given lobbying issue code. |

---

## 15. Roadmap / in-progress

Surfaces present in the app shell but **not yet shipped** (disabled in navigation):

- **Planner** — calendar/task planning workspace.
- **Stakeholders** — stakeholder mapping.
- **Collaborators** — team collaboration.

Actively-evolving data work (built, expanding coverage):

- **J-book ingestion** — broadening RDT&E/procurement volume coverage (R-2/R-2A detail volumes,
  multi-service); each volume add is an artifact → image build → sync.
- **Acquisition personnel** — improving named-PM coverage from PEO org charts / SAM POCs, with
  the merge-candidate queue and quarantine governing data quality.
- **Knowledge Graph** — entity/relationship visualization over the intelligence warehouse.

> **Legacy redirects:** older `/intelligence/*`, `/admin/*`, `/capiro-admin`, and `/portal/*`
> URLs redirect into their current homes (Intelligence Center, Settings tabs, Portfolio).

---

*Generated from a full read of the Capiro codebase (API modules, web routes/pages, Meri tool
manifest, and the Prisma schema). For the technical/engineering playbook, see the
`capiro-platform-engineering` skill and `infra/cdk/README.md`.*
