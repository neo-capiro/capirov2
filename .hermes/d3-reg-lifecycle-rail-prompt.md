Task: Implement D-003 (D3) production-ready for Client Intel v1.

Acceptance:
- Implement unified regulatory lifecycle rail component.
- File: apps/web/src/pages/clients/intelligence-v1/components/RegLifecycleRail.tsx
- Accept when: stage progression and deadline severity are correct.

Instructions:
1) Read first:
   - apps/web/src/pages/clients/intelligence-v1/sections/LegislativeRegulatorySection.tsx
   - apps/web/src/pages/clients/intelligence-v1/mappers.ts
2) Create RegLifecycleRail component and move current lifecycle UI rendering into it.
3) Ensure stage progression is correct for dynamic rails:
   - all steps before current stage = done
   - current stage = current
   - all after = pending
4) Ensure deadline severity is correct/safe:
   - if no deadline -> neutral/warn copy but not critical
   - imminent deadlines become critical, near-term warn
5) Wire section to use component; keep existing styling class names where possible.
6) No new dependencies.
7) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
8) Return concise changed-files + verification summary.