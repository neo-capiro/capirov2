Task: Implement D-001 (D1) production-ready for Client Intel v1.

Goal:
- Build reusable 4-column bill kanban with card drill affordance and +N overflow indicator.
- File: apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx
- Acceptance: structure, counts, and drill affordances work.

Current context:
- LegislativeRegulatorySection.tsx currently renders bill kanban inline.
- aggregate payload has sections.legislativeRegulatory.kanban.columns with id/label/count/bills.

Implement exactly:
1) Create BillKanban.tsx
   - Props:
     - columns: 4 stages (introduced, committee, passed, enacted) with count and bills
     - billDrillHref: base href fallback
   - Render exactly 4 columns in this order with labels/counts.
   - In each column render cards (max visible 5), each card shows bill identifier, title, probability bar + pct.
   - Card drill affordance must be functional:
     - card is clickable anchor.
     - If billDrillHref looks like a base path, append encoded identifier query param (?bill=... or &bill=...).
     - Never render non-clickable drill affordance.
   - +N overflow row:
     - show only if count > visible cards.
     - value = count - visible.
2) Wire LegislativeRegulatorySection.tsx to use BillKanban component and remove duplicated inline kanban map.
3) Keep fallback behavior with static KANBAN data when aggregate absent.
4) Keep existing class names where possible (iv1-kanban, iv1-bill-col, iv1-bill-card, etc.) to preserve styling.
5) No new dependencies.
6) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck

Return summary:
- files changed
- acceptance mapping