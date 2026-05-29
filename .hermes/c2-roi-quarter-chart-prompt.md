Task: Implement C-002 (C2) production-ready end-to-end for Client Intel v1.

Scope and acceptance:
- Implement quarter ROI chart component.
- File: apps/web/src/pages/clients/intelligence-v1/components/RoiQuarterChart.tsx
- Ensure chart values align to payload (no hardcoded fake values).
- Make backend adjustments as necessary so payload includes quarter chart data.
- Keep single host architecture and existing section ordering.
- No new chart dependencies; use CSS/SVG/native primitives.

Required backend adjustment:
- In apps/api/src/intelligence/intelligence.service.ts, add quarter series data under sections.financialFootprint.series.
- Quarter payload should include 8 recent quarters and values used by chart.
- Keep type-safe compile-clean.

Required frontend updates:
1) Add RoiQuarterChart component that renders:
   - bars for lobbying and obligations by quarter
   - inline ratio line/markers or labels (lightweight native SVG/CSS)
   - quarter labels from payload
2) Wire component into FinancialFootprintSection replacing the current hardcoded quarter block.
3) Update mappers.ts types for any new payload fields.
4) Add/adjust theme.css styles as needed.

Constraints:
- Keep existing ROI hero hierarchy and truth-state behavior unchanged.
- Use payload-first rendering with sensible fallback for missing points.
- Keep code concise and consistent with nearby v1 components.

Verification to run:
- pnpm --filter @capiro/api typecheck
- pnpm --filter @capiro/web typecheck

Return:
- files changed
- short note proving chart values are payload-driven.