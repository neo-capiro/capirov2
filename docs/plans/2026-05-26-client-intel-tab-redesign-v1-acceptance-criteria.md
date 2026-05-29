# Client Profile / Intel Tab Redesign v1, Acceptance Criteria & QA Checklist

Date: 2026-05-26
Use: QA, product sign-off, demo readiness

Pass condition
All P0 criteria must pass. P1 may be waived only with explicit product owner approval and documented workaround.

Traceability rule
- Criterion IDs are intentionally sequenced to match backlog ticket IDs by epic and order.
- Example: A-001 <-> A1, D-006 <-> D6, I-006 <-> I6.

---

## A. Structural acceptance (must pass)

A1. Four anchored sections present in this order
- Snapshot
- Financial Footprint
- Legislative & Regulatory
- Relationships
- Left section-nav anchors scroll to the correct section.
- Active section indicator updates as the operator scrolls.
Result: Pass/Fail

A2. Profile page is client-centric only
- No global feed/admin queue as peer cards in profile.
- Moved-out surfaces are linked, not duplicated.
Result: Pass/Fail

A3. Redundancy cuts enforced
- No standalone Bill Tracker v0 card
- No standalone Comment-Period Alerts card
- No standalone Ex-Staffer Network card
- No separate full Knowledge Graph tab competing with section spine
- No 3 equal hero KPI cards in financial section
Result: Pass/Fail

A4. Section-nav meta and source action
- Left nav displays freshness metadata and source-count metadata from the payload.
- "Manage sources" is visible and opens the intended settings/mappings destination.
- No nav CTA is decorative-only.
Result: Pass/Fail

A5. Visual parity with approved mockup
- Section-level composition, card hierarchy, and control placement match approved mockup.
- Typography hierarchy (title/subtitle/value/body/meta) matches intended emphasis order.
- Color semantics and severity mapping remain consistent with design intent.
- Spacing/padding rhythm is consistent across sections and surfaces.
Result: Pass/Fail

---

## B. Snapshot section criteria

B1. Trajectory
- Displays trajectory chip + 8-quarter sparkline.
- Badge is not shown without trend justification.
- Sparkline degrades safely when trend data is partial or missing.
Result: Pass/Fail

B2. Engagement health
- Displays gauge + 8-week trend + delta.
- Scalar-only card is not the default rendering.
- Gauge state color matches health severity.
Result: Pass/Fail

B3. Today’s briefing
- 2–4 sentence summary scoped to this client’s last 24h changes.
- Amounts/deadlines highlighted inline.
- Event count footer visible.
- Generated date visible.
- "See all changes" link opens the client-filtered Changes Inbox.
Result: Pass/Fail

B4. Top alerts
- Top alerts list is severity-sorted and color-coded.
- Sources include regulation deadlines, bill-stage changes, plus-up events.
- Countdown states render correctly for critical, warning, and informational items.
- "View all" link opens the client-filtered Changes Inbox.
- Alert rows are clickable when a backing destination exists.
Result: Pass/Fail

B5. Activity panel
- 90-day activity panel for meetings/outreach/tasks plus supporting workload signals is visible.
- Empty-state rendering is intentional and readable, not a missing chart.
- Activity panel visually supports the health diagnosis.
Result: Pass/Fail

B6. Snapshot CTAs
- "Schedule meeting" opens the correct current-client meeting workflow.
- "Draft outreach" opens the correct current-client outreach workflow.
- If a destination is unavailable, the control is disabled or hidden intentionally rather than dead.
Result: Pass/Fail

---

## C. Financial Footprint section criteria

C1. Hero KPI hierarchy
- Hero presents Lobbying TTM, Federal Obligations TTM, and Return ratio with ROI hierarchy preserved.
- FEC and District are supporting visuals, not co-equal heroes.
- Zero-obligation state is rendered honestly, not disguised as a normal positive KPI.
Result: Pass/Fail

C2. ROI chart
- 9-quarter dual-axis combo: bars for $ flows, line for return ratio.
- Values match backend payload.
Result: Pass/Fail

C3. FEC flow visual
- Three-column flow is shown (contributors -> committees -> recipients) when data exists.
- Not rendered as plain aggregate table by default.
- If data does not exist, explanatory empty state is shown.
- Empty-state remediation/action link is functional.
Result: Pass/Fail

C4. District nexus
- Top-5 districts shown as horizontal bars.
- Inference note/source context is visible when values are inferred.
- Supporting enrichment link is functional if implemented.
Result: Pass/Fail

C5. Financial section links and states
- "Run FEC enrichment job" action works or is intentionally unavailable.
- District enrichment/capability-tag link works or is intentionally unavailable.
- No visible CTA in this section is non-functional.
Result: Pass/Fail

---

## D. Legislative & Regulatory section criteria

D1. Bill kanban
- 4 columns: Introduced, In Committee, Passed Chamber, Enacted.
- Each card shows bill ID + short title.
- Column counts match rendered card groups.
- Bill cards are clickable and drill to the intended destination.
- "+N more" affordances open a working overflow/drill destination.
Result: Pass/Fail

D2. Passage probability
- Inline probability dot/bar on each bill card when available.
- Missing score handled with neutral placeholder.
- Clio fit/score badge appears only when a real score exists.
Result: Pass/Fail

D3. Regulatory lifecycle rail
- Unified rail stages: Bill -> ANPRM -> NPRM -> Final -> Effective.
- Current stage highlighted with comment-deadline pill.
- Standalone comment-alert card absent.
- Deadline severity colors match remaining days.
Result: Pass/Fail

D4. Hearings & markups
- Next 21 days list rendered with date pill + 1-line context.
- Time and room/location metadata visible.
- "Sync to calendar" exports/opens valid event data.
- "Set alerts" opens a working alert/subscription flow.
Result: Pass/Fail

D5. Bill Tracker v0 retired
- No separate Bill Tracker v0 standalone card remains in the profile intelligence host.
Result: Pass/Fail

D6. Kanban controls
- "Filter" control changes the rendered bill set.
- "Sort" control changes ordering using the selected criterion.
- Filter/sort state is preserved while interacting within the kanban.
Result: Pass/Fail

---

## E. Relationships section criteria

E1. Office recommender
- Top 6 offices ranked.
- Each row shows tags from committee/district/ex-staffer/FEC and composite score.
- "All N" link opens a working destination.
- Row click opens a working destination.
Result: Pass/Fail

E2. Resolution graph (if in scope for release)
- Reuses the scoped graph pattern rather than a separate full graph tab.
- Node count capped to avoid hairball UX.
- "Reset" restores the default scoped view.
- "Expand" opens the intended expanded graph experience.
- Clickable nodes drill to working destinations where supported.
Result: Pass/Fail

E3. Ex-staffer fold-in
- Ex-staffer appears as recommender tag and/or graph edge highlight.
- No standalone ex-staffer card.
Result: Pass/Fail

---

## F. Backend aggregation contract criteria

F1. Aggregated payload endpoint
- GET /api/intelligence/clients/:clientId/profile-v1 exists and returns:
  - snapshot
  - financialFootprint
  - legislativeRegulatory
  - relationships
  - meta
Result: Pass/Fail

F2. Supporting aggregation helpers
- Section builders internally reuse existing service calls and normalize shape.
- Section payloads are stable despite legacy endpoint variance.
Result: Pass/Fail

F3. Tenant/client scoping and freshness metadata
- Data is tenant-scoped and client-scoped correctly.
- No cross-client leakage in section payloads.
- Payload includes generatedAt/sourceCount/unresolvedMappings metadata used by the v1 host.
Result: Pass/Fail

F4. SQL view naming compliance
- Raw SQL uses lobby_intel_mv and lobby_issue_ref_v; no dropped table names.
Result: Pass/Fail

F5. Action-target metadata
- Payload includes metadata required to wire visible controls safely, including freshness/source meta, alert targets, briefing deep-link params, optional bill drill targets, and hearing/calendar payloads where needed.
Result: Pass/Fail

---

## G. Move-out linkage criteria

G1. Changes Inbox linkage
- Snapshot briefing has deep-link to client-filtered changes inbox.
- Alerts list "View all" also routes to the client-filtered changes inbox.
Result: Pass/Fail

G2. Entity resolution linkage
- Unresolved mapping banner and/or Manage sources action link to settings/admin mapping queue.
Result: Pass/Fail

G3. Issue page linkage
- Capability/issue tags deep-link to issue leaderboard page.
Result: Pass/Fail

G4. Bill detail linkage
- Bill cards can open bill detail (for GAO/CRS enrichment) when available.
Result: Pass/Fail

G5. Engagement CTA linkage
- Snapshot action buttons open working destinations with current client context preserved.
Result: Pass/Fail

G6. Calendar and alert linkage
- Hearings actions "Sync to calendar" and "Set alerts" open working destinations with current item context preserved.
Result: Pass/Fail

G7. Bill drill fallback linkage
- If bill detail is not available, a working explorer/detail fallback is used.
Result: Pass/Fail

---

## H. ML upgrades criteria

H1. Passage probability model integration
- Section 3 uses real passage probability values for supported bills.
- Fallback behavior remains safe when probabilities are unavailable.
Result: Pass/Fail

H2. Trajectory classifier integration
- Snapshot trajectory chip can consume model output.
- Deterministic fallback remains available if model output is missing.
Result: Pass/Fail

H3. Issue-Bill Linker embeddings migration
- Kanban source can migrate from keyword matching to embeddings service without UI regressions.
Result: Pass/Fail

---

## I. QA / release hardening criteria

I1. FE contract tests
- FE mapper tests cover malformed/missing profile-v1 fields with safe fallbacks.
Result: Pass/Fail

I2. API integration tests
- profile-v1 endpoint tests pass for mapped and partially mapped clients.
Result: Pass/Fail

I3. E2E smoke
- Four sections render.
- All mockup buttons/links called out for v1 are clickable and functional.
- No redundant cards remain and no runtime errors occur.
Result: Pass/Fail

I4. FE interaction coverage
- Component/integration tests cover section-nav anchors and major CTAs/controls:
  - briefing CTA, alerts CTA, activity CTAs
  - kanban controls, hearings CTAs
  - graph controls, office recommender links
Result: PASS (2026-05-28)

I5. Demo readiness checklist sign-off
- Demo readiness checklist completed.
- Product owner sign-off recorded.
Result: PASS (2026-05-28)

I6. Visual parity QA sign-off
- Side-by-side visual QA against approved mockup completed for desktop and mobile.
- No material visual drift accepted without explicit product owner waiver.
Result: PASS (2026-05-28)
Evidence: docs/plans/2026-05-28-client-intel-v1-visual-parity-qa-evidence.md

---

## Appendix, Operator demo checklist

O1. Open 2 representative clients
- One fully mapped, one partially mapped.
Result: Pass/Fail

O2. Run 30-second executive scan
- Can explain trajectory, health, today’s change story, and ROI from top two sections.
Result: Pass/Fail

O3. Run drill-down narrative
- Show bill kanban and lifecycle rail tied to hearing items.
- Show why top recommended office ranks first (visible tags + score).
- Show at least one working bill drill-out.
Result: Pass/Fail

O4. Show move-out boundaries
- Demonstrate “see all changes” and issue deep-link; confirm profile stays focused.
Result: Pass/Fail

O5. Exercise visible controls
- Demonstrate Manage sources, Schedule meeting, Draft outreach, Filter, Sort, Sync to calendar, Set alerts, Reset/Expand, and All N/row drill actions.
- Confirm each visible control is functional, intentionally disabled, or intentionally hidden.
Result: Pass/Fail

Sign-off fields
- QA lead: Hermes agent (implementation QA)
- Product owner: Neo Martinez
- Date: 2026-05-28
- Notes/waivers: No waiver required. Side-by-side parity accepted against approved mockup reference.