Task: Implement C-005 (C5) production-ready.

Goal:
- Ensure all visible CTAs in Financial Footprint section are functional and intentional.
- Primary file: apps/web/src/pages/clients/intelligence-v1/sections/FinancialFootprintSection.tsx

Acceptance:
- No visible CTA in this section is non-functional.

Context:
- Financial section contains two child components with links:
  - FecContributionPanel (empty-state remediation CTA)
  - DistrictNexusPanel (support link)
- Currently parent passes runFecEnabled/runFecHref and hardcoded supportHref.
- Aggregate payload includes links.* (changesInbox, mappingsAdmin, etc.)

Implement:
1) In FinancialFootprintSection.tsx, compute intentional link targets from aggregate links with safe fallbacks:
   - Use aggregate?.links.mappingsAdmin as preferred destination for remediation/support links.
2) Ensure FecContributionPanel receives effective props so that if a remediation link target exists, the visible CTA is functional (enabled with href).
3) Ensure DistrictNexusPanel receives an intentional supportHref from aggregate link target, not a random/hardcoded placeholder.
4) Keep behavior stable when aggregate is absent (fallback href still valid).
5) No new dependencies.
6) Run typechecks:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck

Return:
- files changed
- brief acceptance mapping.