Task: Implement E-002 (E2) production-ready for Client Intel v1.

Acceptance:
- Implement scoped resolution graph component with Reset / Expand / node drills.
- File: apps/web/src/pages/clients/intelligence-v1/components/ResolutionGraphCard.tsx
- Accept when: interactions and node cap behavior are correct.

Instructions:
1) Read first:
   - apps/web/src/pages/clients/intelligence-v1/sections/RelationshipsSection.tsx
   - apps/web/src/pages/clients/intelligence-v1/mappers.ts
2) Create ResolutionGraphCard component and move graph rendering from RelationshipsSection into it.
3) Component requirements:
   - Header actions: Reset and Expand buttons.
   - Node cap behavior:
     - default capped view (e.g., 16 nodes)
     - expanded view up to hard cap (e.g., 30 nodes)
     - reset returns to default cap and clears focused node.
   - Node drills:
     - nodes are clickable with functional href destination
     - pass nodeDrillHrefBuilder prop (with safe fallback if not provided)
     - selected/focused node visual state should update.
   - Keep scoped graph summary text compatible with current aggregate payload.
4) Wire RelationshipsSection to use ResolutionGraphCard.
5) Preserve existing visual classes/UX as much as possible; no new dependencies.
6) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
7) Return concise changed files + acceptance mapping.