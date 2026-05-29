Task: Implement C-004 (C4) production-ready end-to-end for Client Intel v1.

Acceptance criteria:
- Implement District Nexus component.
- File: apps/web/src/pages/clients/intelligence-v1/components/DistrictNexusPanel.tsx
- Top bars, inference note, and supporting link behavior are correct.

Current state:
- FinancialFootprintSection currently has inline District Nexus panel (bars + note + link).
- API aggregate profile-v1 already returns district nexus payload:
  sections.financialFootprint.districtNexus.topDistricts + capabilities.
- Keep no new deps.

Implement exactly:
1) Create DistrictNexusPanel.tsx with props:
   - districtNexus payload from aggregate
   - supportHref (string)
2) Render top 5 district bars from payload, sorted descending by jobs.
   - each row: district code, capability label, normalized bar width, jobs label.
3) If no payload rows, render fallback rows currently used in section.
4) Render inference context note beneath bars:
   - must mention inferred from capability/district nexus text.
5) Supporting link behavior:
   - use supplied supportHref for "Add to capability tags →" link.
6) Wire FinancialFootprintSection to use the new component; remove inline district block.
7) Update mappers.ts type only if needed (districtNexus already includes capabilities/topDistricts; ensure compatibility).
8) Add iv1-district-* styles in theme.css if needed; keep visuals aligned with mock.

Backend adjustments:
- Ensure aggregate has fields required by component. If anything missing, patch apps/api/src/intelligence/intelligence.service.ts accordingly.

Verify:
- pnpm --filter @capiro/web typecheck
- pnpm --filter @capiro/api typecheck

Return summary:
- files changed
- confirm acceptance criteria mapping.