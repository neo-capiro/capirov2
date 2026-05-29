Task: Implement C-003 (C3) production-ready end-to-end for Client Intel v1.

Goal:
- Implement FEC flow panel with actionable empty state.
- File: apps/web/src/pages/clients/intelligence-v1/components/FecContributionPanel.tsx.
- Acceptance: flow renders with data; empty state + remediation CTA when no data.

Current context:
- FinancialFootprintSection currently has inline FEC block.
- API getFecMoneyFlow already returns summary + committees data in intelligence.service.ts.
- mappers currently type only mappedEmployer + summary for fecMoneyFlow; extend type if needed for committees and nested fields.

Requirements:
1) Create FecContributionPanel component:
   - Props should accept aggregate payload FEC section + runFecEnabled + runFecHref.
   - Data-present state:
     - Render a 3-column lightweight flow visualization (contributors/employer -> committees -> recipients/candidates)
     - Use existing payload values (mappedEmployer, committees, candidates, totals)
     - Show top entities (small bounded list) with amounts/counts.
   - Empty state:
     - Explicitly explain no matched contributions.
     - Show remediation CTA when runFecEnabled (link to runFecHref).
     - Show disabled guidance text when not enabled.
2) Wire component into FinancialFootprintSection and remove inline FEC block.
3) Update mappers.ts types for fecMoneyFlow to include committees and nested candidate/member data used by component.
4) Add required styles in theme.css under iv1-fec-* classes.
5) Keep compile clean and avoid new dependencies.

Verification:
- pnpm --filter @capiro/api typecheck
- pnpm --filter @capiro/web typecheck

Output summary:
- list files changed
- note confirming the rendered flow uses payload values and empty-state CTA logic.