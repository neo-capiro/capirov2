Task: Implement G-004 (G4) production-ready dedicated bill-detail destination path.

Acceptance:
- Bill cards open bill detail where available.
- Support dedicated destination path when present.
- Keep backward compatibility with existing query-param explorer flow.

Scope required:
- apps/web/src/App.tsx
- apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx

Backend adjustments if needed:
- Ensure profile-v1 link contract provides dedicated bill detail base path template if available.
- Keep tenant scoping and stable payload shape.

Implementation intent:
1) Add a dedicated route path in App for bill detail destination (e.g. /intelligence/bills/:bill).
2) Route should resolve to existing bill-detail experience (can redirect into explorer query flow if that is current source of truth).
3) Update BillKanban href builder:
   - If billDrillHref contains a path placeholder (:bill or {bill}), replace it with encoded identifier.
   - Else preserve existing query-param behavior (?bill= / &bill=).
4) Ensure cards remain clickable when destination exists.
5) If destination missing, fail safely (non-broken navigation).

Then run:
- pnpm --filter @capiro/web typecheck
- pnpm --filter @capiro/api typecheck

Return concise changed-files summary + acceptance mapping.