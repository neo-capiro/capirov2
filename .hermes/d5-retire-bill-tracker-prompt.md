Task: Implement D-005 (D5) production-ready.

Acceptance:
- Retire Bill Tracker v0 standalone surface from profile host.
- Files:
  - apps/web/src/pages/clients/IntelligenceTab.tsx
  - apps/web/src/pages/intelligence/ClientIntelProfilePage.tsx
- Accept when: no separate Bill Tracker v0 card remains in profile host.

Instructions:
1) Read both files first.
2) Keep IntelligenceTab pointing to ClientIntelV1Page only.
3) In ClientIntelProfilePage.tsx, ensure no standalone Bill Tracker v0 surface is rendered in the profile host.
   - If legacy standalone Bill Tracker card exists, remove it.
   - Do NOT remove other unrelated intelligence surfaces.
4) Keep route/component compile-safe.
5) No new dependencies.
6) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
7) Return concise changed-files + acceptance mapping.