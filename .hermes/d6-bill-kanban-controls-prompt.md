Task: Implement D-006 (D6) production-ready for Client Intel v1.

Acceptance:
- Implement kanban Filter/Sort controls with state preservation.
- File: apps/web/src/pages/clients/intelligence-v1/components/BillKanbanControls.tsx
- Accept when: filter/sort interactions update and persist correctly.

Instructions:
1) Read first:
   - apps/web/src/pages/clients/intelligence-v1/sections/LegislativeRegulatorySection.tsx
   - apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx
2) Create BillKanbanControls component that exposes controlled props + callbacks.
3) Wire it in LegislativeRegulatorySection replacing static Filter/Sort buttons.
4) Implement filter/sort behavior over kanban cards.
5) Persist control state safely (sessionStorage or localStorage) and restore on mount.
6) Keep 4-column structure and existing visuals/class names as much as possible.
7) No new dependencies.
8) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
9) Return concise changed-files + acceptance mapping.