Task: Implement E-003 (E3) production-ready for Client Intel v1.

Acceptance:
- Ex-staffer is fold-in only (no standalone card).
- File to change: apps/web/src/pages/clients/intelligence-v1/sections/RelationshipsSection.tsx
- Accept when: ex-staffer is represented only via existing tags/highlights in graph/list.

Instructions:
1) Read RelationshipsSection.tsx first.
2) Ensure there is NO standalone ex-staffer card/surface in this section.
3) Ensure ex-staffer appears only as:
   - office recommender row tags (e.g., ex-staffer)
   - relationship graph highlight context (legend/subtext)
4) If needed, use aggregate.sections.relationships.exStafferCount to drive highlight text; do not add a separate card.
5) Keep existing visual structure and no new dependencies.
6) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
7) Return concise changed-files + acceptance mapping.