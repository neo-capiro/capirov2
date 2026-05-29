Task: Implement D-002 (D2) production-ready.

Acceptance:
- Implement passage probability visual component.
- File: apps/web/src/pages/clients/intelligence-v1/components/PassageProbabilityBar.tsx
- Score visuals present on bill cards.
- Missing-score handling safe (null/undefined/NaN should not crash or fake a score).

Instructions:
1) Read these files first:
   - apps/web/src/pages/clients/intelligence-v1/components/PassageProbabilityBar.tsx
   - apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx
   - apps/web/src/pages/clients/intelligence-v1/sections/LegislativeRegulatorySection.tsx
2) Ensure BillKanban card UI uses PassageProbabilityBar.
3) Ensure PassageProbabilityBar:
   - clamps numeric scores to [0,100]
   - renders a track+fill+label when score is valid
   - renders a neutral explicit missing-score state when score is absent/invalid
4) Only make required changes.
5) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
6) Output concise list of files changed and verification status.