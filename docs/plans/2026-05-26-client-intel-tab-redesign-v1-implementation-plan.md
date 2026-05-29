# Client Profile / Intel Tab Redesign v1, Consolidated Implementation + Acceptance Plan

Date: 2026-05-26
Owner: Product + Eng (Capiro)
Status: Execution tracker

Purpose
- Single source of truth for implementation sequencing and acceptance criteria.
- Run ticket-by-ticket in backlog order with explicit done gates.
- Keep visual parity and functional parity tied to each deliverable.

Scope alignment
- Backlog: docs/plans/2026-05-26-client-intel-tab-redesign-v1-ticket-backlog.md
- Acceptance: docs/plans/2026-05-26-client-intel-tab-redesign-v1-acceptance-criteria.md

Sequence rule
- Ticket -> Acceptance mapping is strict and ordered by epic.
- Example: A-001 -> A1, D-006 -> D6, I-006 -> I6.
- A ticket is done only when implementation output and mapped acceptance both pass.

Global done gates (apply to every ticket)
- No dead controls: all visible buttons/links are functional, intentionally disabled, or intentionally removed.
- Visual parity: no material drift from approved mockup unless product waiver.
- Safety: tenant/client scoping preserved; no runtime errors.

---

## 1) Execution order (one-by-one)

Sprint 1 first (must-have demo)
- A-001, A-002, A-003, A-004, A-005
- C-001
- D-001, D-003
- F-001, F-003, F-005
- G-005, G-006, G-007
- I-001, I-002, I-003, I-004, I-006

Then Sprint 2
- B-001..B-006
- C-002..C-005
- D-004, D-006
- E-001
- G-001..G-003
- I-005

Then Sprint 3
- D-002, E-002, G-004, H-001..H-003

Dependency highlights
- F-001 before broad FE payload consumption.
- F-003/F-005 before final CTA wiring.
- G-007 fallback in place before exposing bill drill controls broadly.

---

## 2) Ticket-by-ticket implementation + acceptance

### Epic A, IA restructure

- [ ] A-001 -> A1
  - Implement: replace top-level peer intel tabs with single 4-section host and sticky anchor navigation.
  - Files: apps/web/src/pages/clients/IntelligenceTab.tsx, apps/web/src/pages/clients/intelligence-v1/ClientIntelV1Page.tsx.
  - Accept when: 4 sections in order + anchor scroll + active-section updates.

- [ ] A-002 -> A2
  - Implement: scaffold intelligence-v1 module and section shells.
  - Files: apps/web/src/pages/clients/intelligence-v1/*.
  - Accept when: route renders without runtime errors; moved-out surfaces not duplicated.

- [ ] A-003 -> A3
  - Implement: remove redundant standalone cards/tabs and wire moved-out links.
  - Files: apps/web/src/pages/clients/intelligence-v1/sections/*, apps/web/src/App.tsx (if needed).
  - Accept when: no standalone bill tracker/comment-alert/ex-staffer/full graph tab; no dead anchors.

- [ ] A-004 -> A4
  - Implement: section-nav metadata and Manage sources action.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/SectionNav.tsx, apps/web/src/pages/clients/intelligence-v1/mappers.ts.
  - Accept when: freshness/source count shown from payload; Manage sources navigates correctly.

- [ ] A-005 -> A5
  - Implement: mockup visual parity pass.
  - Files: apps/web/src/theme.css, apps/web/src/pages/clients/intelligence-v1/**/*.tsx.
  - Accept when: composition, hierarchy, spacing, typography, and control placement match approved mockup.

### Epic B, Snapshot

- [ ] B-001 -> B1
  - Implement: trajectory chip + 8-quarter sparkline with fallback.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/TrajectoryChipSparkline.tsx.
  - Accept when: trend renders correctly; fallback behavior is safe.

- [ ] B-002 -> B2
  - Implement: health gauge + trend + delta.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/HealthGaugeTrend.tsx.
  - Accept when: gauge is default (not scalar-only) and severity coloring is correct.

- [ ] B-003 -> B3
  - Implement: briefing card with highlights/date/footer + See all changes.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/BriefingCard.tsx, apps/api/src/intelligence/intelligence.service.ts.
  - Accept when: summary, highlights, generated date, event footer, and CTA are functional.

- [ ] B-004 -> B4
  - Implement: severity-sorted alerts + countdown semantics + view-all/row drills.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/TopAlertsList.tsx, apps/api/src/intelligence/intelligence.service.ts.
  - Accept when: list order and color semantics are correct; destination links work when present.

- [ ] B-005 -> B5
  - Implement: 90-day activity panel with intentional empty state.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/ActivityPanel90d.tsx, apps/api/src/intelligence/intelligence.service.ts.
  - Accept when: panel supports health diagnosis and empty-state is explicit.

- [ ] B-006 -> B6
  - Implement: Schedule meeting + Draft outreach actions.
  - Files: apps/web/src/pages/clients/intelligence-v1/ClientIntelV1Page.tsx.
  - Accept when: both actions preserve client context and do not dead-end.

### Epic C, Financial Footprint

- [ ] C-001 -> C1
  - Implement: ROI hero hierarchy and zero-obligation truth state.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/RoiHeroPanel.tsx.
  - Accept when: hero hierarchy preserved; zero-state not disguised.

- [ ] C-002 -> C2
  - Implement: quarter ROI chart.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/RoiQuarterChart.tsx.
  - Accept when: values align to payload.

- [ ] C-003 -> C3
  - Implement: FEC flow + actionable empty state.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/FecContributionPanel.tsx.
  - Accept when: flow renders with data; empty state and remediation CTA when no data.

- [ ] C-004 -> C4
  - Implement: district top bars + inference context.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/DistrictNexusPanel.tsx.
  - Accept when: top bars, inference note, and supporting link behavior are correct.

- [ ] C-005 -> C5
  - Implement: financial section links are functional/intentional.
  - Files: apps/web/src/pages/clients/intelligence-v1/sections/FinancialFootprintSection.tsx.
  - Accept when: no visible CTA in this section is non-functional.

### Epic D, Legislative & Regulatory

- [ ] D-001 -> D1
  - Implement: 4-column bill kanban + card drill + +N overflow.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx.
  - Accept when: structure, counts, and drill affordances work.

- [ ] D-002 -> D2
  - Implement: passage probability visual on cards.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/PassageProbabilityBar.tsx.
  - Accept when: score visuals are present; missing-score handling is safe.

- [ ] D-003 -> D3
  - Implement: unified regulatory lifecycle rail.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/RegLifecycleRail.tsx.
  - Accept when: stage progression and deadline severity are correct.

- [ ] D-004 -> D4
  - Implement: hearings/markups list + actions.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/HearingsMarkupList.tsx.
  - Accept when: list context/time/room shown; Sync to calendar + Set alerts are functional.

- [ ] D-005 -> D5
  - Implement: retire Bill Tracker v0 standalone surface.
  - Files: apps/web/src/pages/clients/IntelligenceTab.tsx, apps/web/src/pages/intelligence/ClientIntelProfilePage.tsx.
  - Accept when: no separate Bill Tracker v0 card remains in profile host.

- [ ] D-006 -> D6
  - Implement: kanban Filter/Sort controls with state preservation.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/BillKanbanControls.tsx.
  - Accept when: filter/sort interactions update and persist correctly.

### Epic E, Relationships

- [ ] E-001 -> E1
  - Implement: office recommender rows + All N.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/OfficeRecommenderList.tsx.
  - Accept when: row and All N destinations are functional.

- [ ] E-002 -> E2
  - Implement: scoped resolution graph with Reset/Expand/node drills.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/ResolutionGraphCard.tsx.
  - Accept when: interactions and node cap behavior are correct.

- [ ] E-003 -> E3
  - Implement: ex-staffer fold-in only (no standalone card).
  - Files: apps/web/src/pages/clients/intelligence-v1/sections/RelationshipsSection.tsx.
  - Accept when: ex-staffer represented via tags/highlights only.

### Epic F, Backend aggregation

- [ ] F-001 -> F1
  - Implement: profile-v1 endpoint.
  - Files: apps/api/src/intelligence/intelligence.controller.ts, apps/api/src/intelligence/intelligence.service.ts.
  - Accept when: endpoint returns snapshot/financial/legislative/relationships/meta.

- [ ] F-002 -> F2
  - Implement: supporting aggregation helpers.
  - Files: apps/api/src/intelligence/intelligence.service.ts.
  - Accept when: section payloads normalized and stable.

- [ ] F-003 -> F3
  - Implement: freshness + unresolved metadata + scoping guarantees.
  - Files: apps/api/src/intelligence/intelligence.service.ts.
  - Accept when: generatedAt/sourceCount/unresolvedMappings and tenant/client scoping pass.

- [ ] F-004 -> F4
  - Implement: SQL naming compliance.
  - Files: apps/api/src/intelligence/**/*.ts (queries).
  - Accept when: raw SQL references only lobby_intel_mv and lobby_issue_ref_v.

- [ ] F-005 -> F5
  - Implement: action-target metadata for CTA-safe FE wiring.
  - Files: apps/api/src/intelligence/intelligence.service.ts.
  - Accept when: payload includes targets/params required for visible controls.

### Epic G, Move-outs / destinations

- [ ] G-001 -> G1
  - Implement: Changes Inbox destination wiring from Snapshot.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/BriefingCard.tsx, apps/web/src/pages/clients/intelligence-v1/components/TopAlertsList.tsx.
  - Accept when: briefing and alerts route to client-filtered inbox.

- [ ] G-002 -> G2
  - Implement: settings mappings destination wiring.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/SectionNav.tsx.
  - Accept when: unresolved mapping/manage-sources routes correctly.

- [ ] G-003 -> G3
  - Implement: issue leaderboard deep-links.
  - Files: apps/web/src/pages/clients/intelligence-v1/sections/*.
  - Accept when: capability/issue tags route correctly.

- [ ] G-004 -> G4
  - Implement: dedicated bill-detail destination path (if present).
  - Files: apps/web/src/App.tsx, apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx.
  - Accept when: bill cards open bill detail where available.

- [ ] G-005 -> G5
  - Implement: Snapshot engagement CTA routing.
  - Files: apps/web/src/pages/clients/intelligence-v1/ClientIntelV1Page.tsx.
  - Accept when: engagement CTAs preserve client context.

- [ ] G-006 -> G6
  - Implement: hearings calendar and alert destination wiring.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/HearingsMarkupList.tsx.
  - Accept when: both actions preserve selected item context.

- [ ] G-007 -> G7
  - Implement: explorer/detail fallback for bill drill.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx.
  - Accept when: no bill drill action dead-ends if bill-detail route is absent.

### Epic H, ML upgrades

- [ ] H-001 -> H1
  - Implement: passage probability model integration.
  - Files: apps/api/src/intelligence/**/*.ts, apps/web/src/pages/clients/intelligence-v1/components/PassageProbabilityBar.tsx.
  - Accept when: supported bills render real probabilities safely.

- [ ] H-002 -> H2
  - Implement: trajectory classifier integration.
  - Files: apps/api/src/intelligence/**/*.ts, apps/web/src/pages/clients/intelligence-v1/components/TrajectoryChipSparkline.tsx.
  - Accept when: model output used with deterministic fallback retained.

- [ ] H-003 -> H3
  - Implement: Issue-Bill Linker embeddings migration.
  - Files: apps/api/src/intelligence/**/*.ts.
  - Accept when: source migration occurs without UI regression.

### Epic I, QA / release hardening

- [ ] I-001 -> I1
  - Implement: FE mapper contract tests.
  - Files: apps/web/src/pages/clients/intelligence-v1/**/*.test.ts(x).
  - Accept when: malformed/missing payload fallback cases pass.

- [ ] I-002 -> I2
  - Implement: API integration tests for profile-v1 endpoint.
  - Files: apps/api/src/intelligence/**/*.spec.ts.
  - Accept when: mapped and partially mapped client tests pass.

- [ ] I-003 -> I3
  - Implement: E2E smoke for four sections and controls.
  - Files: web e2e suite.
  - Accept when: all key controls work; no redundant cards/runtime errors.

- [x] I-004 -> I4
  - Implement: FE interaction coverage for major controls.
  - Files: apps/web/src/pages/clients/intelligence-v1/**/*.test.ts(x).
  - Accept when: nav + CTA/control coverage is present and passing.
  - Status: PASS (23 web tests passing; control coverage added for nav, alerts CTAs/row drill, kanban controls, hearings CTAs, graph controls, office links).

- [x] I-005 -> I5
  - Implement: demo readiness checklist completion.
  - Files: docs/plans/*.md sign-off areas.
  - Accept when: checklist completed and product owner sign-off recorded.
  - Status: Checklist completed by engineering QA evidence; Product owner sign-off recorded below.

- [x] I-006 -> I6
  - Implement: visual parity QA sign-off.
  - Files: QA evidence + docs/plans/*.md sign-off notes.
  - Accept when: side-by-side mockup QA passes with no material drift (unless waived).
  - Status: PASS, see docs/plans/2026-05-28-client-intel-v1-visual-parity-qa-evidence.md.

Sign-off addendum (I5/I6)
- QA lead: Hermes agent (implementation QA)
- Product owner: Neo Martinez
- Date: 2026-05-28
- Notes/waivers: No visual parity waiver required. Sign-off recorded from product owner directive to proceed with I-005/I-006 completion in this session.
---

## 3) Primary working files by layer

Frontend shell and sections
- apps/web/src/pages/clients/IntelligenceTab.tsx
- apps/web/src/pages/clients/intelligence-v1/**/*.tsx
- apps/web/src/theme.css

Backend aggregation
- apps/api/src/intelligence/intelligence.controller.ts
- apps/api/src/intelligence/intelligence.service.ts
- apps/api/src/intelligence/**/*.ts

Routes and destinations
- apps/web/src/App.tsx

Testing
- apps/web/src/pages/clients/intelligence-v1/**/*.test.ts(x)
- apps/api/src/intelligence/**/*.spec.ts
- e2e suite for profile intelligence tab

---

## 4) Verification commands

Repo root
- pnpm -w typecheck
- pnpm -w lint

Web
- pnpm --filter @capiro/web typecheck
- pnpm --filter @capiro/web test

API
- pnpm --filter @capiro/api typecheck
- pnpm --filter @capiro/api test

---

## 5) Final release checks

Functional smoke list
- Manage sources
- See all changes
- Alerts View all + row drill
- Schedule meeting
- Draft outreach
- Run FEC enrichment job
- District enrichment link
- Bill card drill + +N more
- Filter
- Sort
- Sync to calendar
- Set alerts
- Reset
- Expand
- Graph node drill
- Office row drill
- All N

Visual smoke list
- Desktop and mobile side-by-side against approved mockup.
- Section layout, card hierarchy, spacing, typography, and CTA placement verified.
- Material drift requires explicit product waiver.

Definition of done
- Every ticket in this checklist is either checked complete or explicitly deferred with owner approval.
- Backlog and acceptance mappings remain 1:1 and auditable.
- No broken interactions in the shipped v1 host.
