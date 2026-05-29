Task: Implement H-001 -> H1 (Passage probability model integration) production-ready end-to-end.

Source of truth:
- docs/plans/2026-05-26-client-intel-tab-redesign-v1-implementation-plan.md
  - Epic H, H-001: “Implement: passage probability model integration.”
  - Files: apps/api/src/intelligence/**/*.ts, apps/web/src/pages/clients/intelligence-v1/components/PassageProbabilityBar.tsx
  - Accept when: “supported bills render real probabilities safely.”
- docs/plans/2026-05-26-client-intel-tab-redesign-v1-acceptance-criteria.md
  - H1 requires:
    1) Section 3 uses real passage probability values for supported bills.
    2) Fallback behavior remains safe when probabilities are unavailable.

Current state (must replace/upgrade safely):
- apps/api/src/intelligence/intelligence.service.ts currently uses stage-based fixed constants in getClientProfileV1:
  - enacted=0.98, passed=0.72, committee=0.46, introduced=0.24
  This is heuristic, not model integration.
- Frontend Section 3 already renders bill probability bars via mapped `b.probability`.

Implementation requirements:
1) Backend model integration (required)
- Add a dedicated passage probability model module under apps/api/src/intelligence/ (e.g., passage-probability.model.ts).
- Implement a logistic-regression style predictor using bill-level features available in congress_bill/getTrackedBills output (examples: stage/action text, cosponsors count, recency/age, chamber/sponsor party if available, etc.).
- “Supported bills” must be explicitly defined by model eligibility guard(s) (e.g., required fields and/or supported congress windows).
- Return probability as number in [0,1] for supported bills.
- If unsupported/missing required signals, return null (not crash), and keep API contract safe.
- Preserve compatibility: no breaking response shape changes except allowing probability null where unsupported.

2) Integrate predictor in Intel v1 aggregate
- Wire predictor into getClientProfileV1 kanban bill assembly so probability is computed from model output, not fixed stage constants.
- Keep deterministic safe fallback behavior where model is unavailable:
  - unsupported bills => probability null
  - no exceptions thrown
  - endpoint still returns successfully

3) Frontend safety
- Ensure PassageProbabilityBar continues to render safely for null/undefined/NaN (“No score”).
- If needed, make minimal updates only in PassageProbabilityBar.tsx to support safe rendering semantics (do not regress styles or accessibility).

4) Tests / verification (must run)
- Run:
  - pnpm --filter @capiro/api typecheck
  - pnpm --filter @capiro/web typecheck
- Add/update focused backend test(s) if test scaffolding exists for intelligence model logic; if no harness, at minimum keep code highly unit-testable with pure model function.

Constraints:
- No schema migrations unless absolutely necessary (prefer model-from-existing-fields first).
- Keep implementation concise and maintainable; avoid giant inline logic in intelligence.service.ts.
- Do not touch unrelated features.

Deliverable:
- Commit-ready code changes implementing H-001 acceptance criteria.
- In final summary, list files changed and explain eligibility + fallback behavior for unsupported bills.