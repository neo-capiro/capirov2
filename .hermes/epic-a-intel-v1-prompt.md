Implement Epic A — IA restructure for Client Intelligence tab in Capiro.

Repository root:
C:\Users\neoma\OneDrive\Documents\Claude\Projects\capirov2\git\capirov2

Source-of-truth requirements (must satisfy exactly):

Epic A tasks
- A-001 -> A1
  - Replace top-level peer intel tabs with single 4-section host and sticky anchor nav.
  - Files: apps/web/src/pages/clients/IntelligenceTab.tsx, apps/web/src/pages/clients/intelligence-v1/ClientIntelV1Page.tsx.
  - Accept: 4 sections in order + anchor scroll + active-section updates.

- A-002 -> A2
  - Scaffold intelligence-v1 module and section shells.
  - Files: apps/web/src/pages/clients/intelligence-v1/*.
  - Accept: route renders without runtime errors; moved-out surfaces not duplicated.

- A-003 -> A3
  - Remove redundant standalone cards/tabs and wire moved-out links.
  - Files: apps/web/src/pages/clients/intelligence-v1/sections/*, apps/web/src/App.tsx (if needed).
  - Accept: no standalone bill tracker/comment-alert/ex-staffer/full graph tab; no dead anchors.

- A-004 -> A4
  - Section-nav metadata and Manage sources action.
  - Files: apps/web/src/pages/clients/intelligence-v1/components/SectionNav.tsx, apps/web/src/pages/clients/intelligence-v1/mappers.ts.
  - Accept: freshness/source count shown from payload; Manage sources navigates correctly.

- A-005 -> A5
  - Mockup visual parity pass.
  - Files: apps/web/src/theme.css, apps/web/src/pages/clients/intelligence-v1/**/*.tsx.
  - Accept: composition, hierarchy, spacing, typography, control placement match approved mockup.

Acceptance A1 details (must be explicit in implementation)
- Four anchored sections in this order:
  1) Snapshot
  2) Financial Footprint
  3) Legislative & Regulatory
  4) Relationships
- Left section-nav anchors scroll to correct section.
- Active section indicator updates while scrolling.

Context constraints from product spec
- Keep host in client profile path (ClientProfilePage -> IntelligenceTab).
- Keep moved-out/global/admin experiences as deep-links; do NOT duplicate inline cards.
- Existing destinations available: Changes Inbox, Issue Leaderboard, settings mappings, Explorer.
- Bill detail route may not exist: use explorer/detail fallback for bill drill-outs.
- No new chart dependency for v1. Use existing primitives/CSS/SVG/canvas only.

Mockup reference
file:///C:/Users/neoma/AppData/Roaming/Claude/local-agent-mode-sessions/25a9aaed-5380-4e9c-b366-6220a5ff6c7d/6f7aadb5-dd39-4eb0-9b51-1b079ef1b9f2/local_ff035b1c-4860-477c-88cf-2eca61993df7/outputs/capiro-intel-mockup.html

Files to consider as integration surface
Frontend:
- apps/web/src/pages/clients/ClientProfilePage.tsx
- apps/web/src/pages/clients/IntelligenceTab.tsx
- apps/web/src/pages/intelligence/ClientIntelProfilePage.tsx
- apps/web/src/pages/intelligence/KnowledgeGraphPage.tsx
- apps/web/src/pages/intelligence/ChangesInboxPage.tsx
- apps/web/src/pages/intelligence/IssueLeaderboardPage.tsx
- apps/web/src/pages/explorer/DataExplorerPage.tsx
- apps/web/src/App.tsx
- apps/web/src/theme.css

Backend (read-only for this Epic unless absolutely needed for metadata shape assumptions):
- apps/api/src/intelligence/intelligence.controller.ts
- apps/api/src/intelligence/intelligence.service.ts
- apps/api/src/intelligence/insight-generator.service.ts
- apps/api/src/intelligence/report-card.service.ts

Implementation directives
1) Read existing files first.
2) Keep changes focused on Epic A FE scope.
3) Remove top-level peer tabs from IntelligenceTab.
4) Build intelligence-v1 module with:
   - components/SectionNav.tsx
   - sections/SnapshotSection.tsx
   - sections/FinancialFootprintSection.tsx
   - sections/LegislativeRegulatorySection.tsx
   - sections/RelationshipsSection.tsx
   - mappers.ts
   - ClientIntelV1Page.tsx
5) Ensure every visible anchor/CTA in this phase has a working destination or intentional disabled state (no dead buttons).
6) If a section is displayed elsewhere as standalone in prior host, remove duplicate display in the new host.
7) Prefer existing styling tokens/classes. Minimal additions in theme.css to achieve mockup-like hierarchy and spacing.

After coding
- Run: pnpm --filter @capiro/web typecheck
- If typecheck fails, fix and rerun until green.

Output format
- Summarize changed files.
- Map each A-001..A-005 item to done/partial with notes.
- Call out any unresolved gaps explicitly.