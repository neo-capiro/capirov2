Task: Implement E-001 (E1) production-ready for Client Intel v1.

Acceptance:
- Implement office recommender rows + All N CTA component.
- File: apps/web/src/pages/clients/intelligence-v1/components/OfficeRecommenderList.tsx
- Accept when: row and All N destinations are functional.

Instructions:
1) Read first:
   - apps/web/src/pages/clients/intelligence-v1/sections/RelationshipsSection.tsx
   - apps/web/src/pages/clients/intelligence-v1/mappers.ts
2) Create OfficeRecommenderList component that renders:
   - office rows (rank, name, sub, tags, score)
   - header CTA "All N →"
3) Props should include:
   - rows
   - allCount
   - allHref
   - rowHrefBuilder (or equivalent) so each row has functional destination
4) Use safe fallback hrefs:
   - All N fallback: /intelligence/issues
   - Row fallback: /intelligence/issues
5) Wire RelationshipsSection to use component, replacing inline office rows.
6) Keep visual classes and existing styles as much as possible.
7) No new dependencies.
8) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
9) Return concise changed files + acceptance mapping.
