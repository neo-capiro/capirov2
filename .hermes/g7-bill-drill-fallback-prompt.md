Task: G-007 -> G7

Goal
Implement explorer/detail fallback for bill drill so no bill action dead-ends when bill-detail route is absent or bill drill href is missing.

Primary file
- apps/web/src/pages/clients/intelligence-v1/components/BillKanban.tsx

Acceptance
- No bill drill action dead-ends if bill-detail route is absent.
- Cards should always have a safe destination for drill when bill identifier exists.
- Preserve existing behavior for dedicated path templates (:bill / {bill}) and query-param bases.

Implementation guidance
- Read BillKanban.tsx first.
- Update href builder to guarantee a safe explorer fallback destination.
- Keep current template replacement behavior.
- For empty or malformed base href, fallback to `/explorer?bill=<encoded>`.
- Keep component production-safe, deterministic, and type-safe.

After edit
- Run:
  - pnpm --filter @capiro/web typecheck
  - pnpm --filter @capiro/api typecheck
- Summarize changed behavior and why dead-ends are removed.