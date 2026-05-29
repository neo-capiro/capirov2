# Client Profile / Intel Tab Redesign v1, Ticket Backlog

Date: 2026-05-26
Scope: Frontend + API + data/ML + QA

Priority legend
- P0: demo-critical
- P1: core v1
- P2: upgrade/non-blocking

---

## Epic A, IA restructure to 4 sections (P0)

A-001 (P0) Replace IntelligenceTab top-level tabs with sectioned v1 host
- Type: FE
- Files: apps/web/src/pages/clients/IntelligenceTab.tsx
- AC: only one profile intelligence surface with 4 anchored sections; no graph/money-flow/district/ex-staffer peer tabs; sticky section nav highlights active section while scrolling.

A-002 (P0) Create v1 section scaffolding and shared intelligence-v1 module
- Type: FE
- Files: apps/web/src/pages/clients/intelligence-v1/*
- AC: section components compile; route from client profile renders without runtime errors.

A-003 (P0) Deep-links for moved-out features
- Type: FE
- Files: intelligence-v1 section components, App.tsx (if route additions needed)
- AC: links navigate to changes inbox, issue page, mappings page, bill detail page (if present) or explorer fallback; no dead buttons/anchors remain in the shipped v1 host.

A-004 (P0) Section nav meta and manage-sources action
- Type: FE+API
- AC: left nav shows generated/synced timestamp plus data-source count from payload metadata; "Manage sources" button routes to mappings/settings destination.

A-005 (P0) Mockup visual parity implementation
- Type: FE
- AC: v1 host visually matches approved mockup for layout, spacing rhythm, typography scale, color usage, card/surface hierarchy, and section composition on desktop and mobile breakpoints.

---

## Epic B, Snapshot section (P1)

B-001 (P1) Trajectory chip + 8-quarter sparkline component
- Type: FE
- AC: chip and sparkline render from profile-v1 payload; fallback state shown when data missing.

B-002 (P1) Engagement health gauge + 8-week trend
- Type: FE
- AC: score and delta trend visible; no scalar-only fallback as default.

B-003 (P1) Today’s briefing card with inline highlights
- Type: FE+API
- API: include synthesized briefing in profile-v1 payload
- AC: briefing includes amount/deadline emphasis, generated date, event-count footer, and working CTA to client-filtered Changes Inbox.

B-004 (P1) Top 3 alerts unified list
- Type: FE+API
- AC: severity-sorted list includes reg deadline, bill-stage changes, plus-up events; "View all" button routes to client-filtered Changes Inbox; alert rows deep-link to their source record when destination exists.

B-005 (P1) 90-day activity panel
- Type: FE+API
- AC: meetings/outreach/tasks/bills/workflows panel renders and visually supports health score; empty/zero activity state is intentionally styled rather than omitted.

B-006 (P1) Activity CTA wiring
- Type: FE
- AC: "Schedule meeting" and "Draft outreach" buttons route into working engagement flows for the current client; buttons are disabled only when no valid destination exists.

---

## Epic C, Financial Footprint section (P0)

C-001 (P0) ROI hero card + 9-quarter combo chart
- Type: FE+API
- AC: three hero numbers (Lobbying TTM, Obligations TTM, Return ratio) plus bars+line chart.

C-002 (P1) FEC three-column flow visual
- Type: FE+API
- AC: contributors -> committees -> recipients shown in one compact flow panel; when data is missing, card renders explanatory empty state with working remediation CTA.

C-003 (P1) District nexus top 5 bars + talking points
- Type: FE+API
- AC: horizontal bars top 5 districts and generated talking points/inference note; supporting link routes to capability-tags or enrichment destination when available.

C-004 (P0) KPI hierarchy enforcement
- Type: FE
- AC: only ROI is hero-level; FEC and district are supporting visuals.

C-005 (P1) FEC empty-state action and district enrichment links
- Type: FE
- AC: "Run FEC enrichment job" and district enrichment/capability-tag links are functional and preserve current client context.

---

## Epic D, Legislative & Regulatory section (P0/P1)

D-001 (P0) Bill pipeline kanban (4 columns)
- Type: FE+API
- AC: columns Introduced/In Committee/Passed Chamber/Enacted; bill cards include ID + short title; bill cards and "+N more" affordances drill to a working bill destination or explorer fallback.

D-002 (P1) Inline passage probability dots on bill cards
- Type: FE+API/ML
- AC: per-card probability dot bar appears when score available.

D-003 (P0) Regulatory lifecycle rail (unified from comment alerts + bill-reg links)
- Type: FE+API
- AC: rail stages Bill -> ANPRM -> NPRM -> Final -> Effective with active stage and deadline pill.

D-004 (P1) Hearings & markups next 21 days
- Type: FE+API
- AC: sorted list with date pill and one-line context from tracked bill joins; "Sync to calendar" and "Set alerts" actions are functional.

D-005 (P0) Retire Bill Tracker v0 standalone UI
- Type: FE
- AC: no separate v0 tracker card exists after rollout.

D-006 (P1) Bill kanban controls and overflow actions
- Type: FE
- AC: kanban header Filter and Sort controls work against the rendered bill set; per-column overflow actions preserve current filter/sort state.

---

## Epic E, Relationships section (P1)

E-001 (P1) Office recommender top 6 list with weight tags
- Type: FE+API
- AC: rows include rank, office name, committee/district/ex-staffer/FEC tags, composite score; row click and "All N" CTA route to working destination.

E-002 (P2) Scoped network mini-graph (3-column)
- Type: FE+API
- AC: scoped graph reuses existing radial pattern with tighter node cap; reset/expand controls work; node click drills to working destination where supported.

E-003 (P0) Fold ex-staffer network into recommender + graph (no standalone card)
- Type: FE
- AC: ex-staffer appears only as tag/highlight, not separate card.

---

## Epic F, Backend aggregation contract (P0)

F-001 (P0) Add GET /api/intelligence/clients/:clientId/profile-v1
- Type: API
- Files: intelligence.controller.ts, intelligence.service.ts
- AC: returns snapshot/financial/legislative/relationships/meta object with stable schema.

F-002 (P1) Add supporting aggregation helpers
- Type: API
- AC: section builders internally reuse existing service calls and normalize shape.

F-003 (P1) Data freshness + unresolved mapping metadata
- Type: API
- AC: payload includes generatedAt, sourceCount, and unresolvedMappings indicator for section-nav/meta behavior.

F-004 (P0) SQL view naming compliance
- Type: API/Data
- AC: all raw SQL references lobby_intel_mv and lobby_issue_ref_v only.

F-005 (P1) Action-target metadata in profile-v1 payload
- Type: API
- AC: payload exposes destination metadata needed to wire UI controls safely, including alert targets, briefing changes link params, enrichment actions, calendar payloads, and optional bill/explorer drill targets.

---

## Epic G, Move-outs / destinations (P1)

G-001 (P1) Keep and wire global Changes Inbox as destination
- Type: FE
- AC: from Snapshot briefing users can jump to client-filtered inbox.

G-002 (P1) Keep settings/admin mapping queue destination
- Type: FE
- AC: unresolved mapping banner links to /settings/intelligence-mappings.

G-003 (P1) Keep issue leaderboard destination from capability tags
- Type: FE
- AC: issue tags route to /intelligence/issues/:code.

G-004 (P2) Bill detail page destination for enrichment
- Type: FE+API
- AC: bill card deep-link opens bill detail with GAO/CRS enrichment.

G-005 (P1) Wire engagement CTAs from Snapshot
- Type: FE
- AC: Schedule meeting and Draft outreach actions open the current client's meeting/outreach entry points without dropping profile context.

G-006 (P1) Wire calendar and alert destinations from hearings panel
- Type: FE+API
- AC: Sync to calendar exports valid event data; Set alerts opens a working alert/subscription flow scoped to the selected hearing.

G-007 (P1) Explorer fallback for bill drill-outs
- Type: FE
- AC: if dedicated bill detail route is absent, bill cards and overflow affordances route to an explorer/detail fallback instead of dead-ending.

---

## Epic H, ML upgrades (P2)

H-001 (P2) Passage probability model v1 integration
- Type: ML+API
- AC: Section 3 shows real probabilities for supported bills.

H-002 (P2) Trajectory classifier model v1 integration
- Type: ML+API
- AC: Snapshot trajectory chip uses model output over deterministic fallback.

H-003 (P2) Issue-Bill Linker embeddings migration
- Type: API/ML
- AC: kanban input source migrates from keyword matcher to embeddings service with no UI change.

---

## Epic I, QA / release hardening (P0)

I-001 (P0) FE contract tests for profile-v1 payload mapper
- Type: FE test
- AC: malformed/missing fields handled with safe fallbacks.

I-002 (P0) API integration tests for profile-v1 endpoint
- Type: API test
- AC: endpoint returns complete section object for mapped and partially mapped clients.

I-003 (P0) E2E smoke for client profile intelligence tab
- Type: E2E
- AC: four sections render, all mockup buttons/links called out for v1 are clickable and functional, no redundant cards remain, no runtime errors.

I-004 (P0) FE interaction coverage for v1 controls
- Type: FE test
- AC: component/integration tests cover section-nav anchors, briefing CTA, alerts CTA, activity CTAs, kanban controls, hearings CTAs, graph controls, and office recommender links.

I-005 (P0) Demo readiness checklist sign-off
- Type: QA/Product
- AC: checklist complete and signed by product owner.

I-006 (P0) Visual parity QA sign-off
- Type: FE test + QA
- AC: side-by-side QA pass against the approved mockup confirms no material visual drift in section layout, surfaces, typography hierarchy, and control placement.

---

## Recommended sprint cut

Sprint 1 (must-have demo)
- A-001, A-002, A-003, A-004, A-005, C-001, D-001, D-003, F-001, F-003, F-005, G-005, G-006, G-007, I-001, I-002, I-003, I-004, I-006

Sprint 2 (finish v1)
- B-001..B-006, C-002..C-005, D-004, D-006, E-001, G-001..G-003, I-005

Sprint 3 (upgrades)
- D-002, E-002, G-004, H-001..H-003

---

## Dependency notes

- C-001 depends on F-001 payload contract if FE chooses aggregator-only consumption.
- A-004 and several CTA tickets depend on F-003/F-005 metadata if FE wants to avoid hard-coded routes.
- D-001 can ship on keyword matcher first; D-002/H-003 are upgrades.
- E-002 graph depends on scoped graph payload to avoid hairball performance issues.
- Move-outs do not block 4-section profile launch.