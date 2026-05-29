Task: Implement H-002 -> H2 (Trajectory classifier integration) production-ready end-to-end.

Source of truth:
- docs/plans/2026-05-26-client-intel-tab-redesign-v1-implementation-plan.md
  - H-002 -> H2
  - Implement: trajectory classifier integration.
  - Files: apps/api/src/intelligence/**/*.ts, apps/web/src/pages/clients/intelligence-v1/components/TrajectoryChipSparkline.tsx.
  - Accept when: model output used with deterministic fallback retained.
- docs/plans/2026-05-26-client-intel-tab-redesign-v1-acceptance-criteria.md
  - H2 requires:
    1) Snapshot trajectory chip can consume model output.
    2) Deterministic fallback remains available if model output is missing.

Current wiring context:
- getClientProfileV1 currently sets snapshot.trajectory from profile.lobbyIntel fields:
  - label: profile.lobbyIntel.trajectory
  - growthRate: profile.lobbyIntel.growthRate
  - totalSpending: profile.lobbyIntel.totalSpending
  - yearlySpend: profile.lda.yearlySpend
- TrajectoryChipSparkline currently infers tone from label text and renders chip + sparkline.

Implementation requirements:
1) Backend model integration
- Add a dedicated trajectory classifier model module under apps/api/src/intelligence/ (e.g., trajectory-classifier.model.ts).
- Implement model-style classifier function using available time-series inputs (quarter/year spend trend, growth signals, volatility, recency) that returns:
  - modelLabel (string enum-ish classification)
  - modelConfidence (0..1)
  - optional modelScore
  - source marker indicating model vs fallback
- Integrate into getClientProfileV1 snapshot.trajectory payload so model output is used when model eligibility/inputs are satisfied.

2) Deterministic fallback retained
- Preserve deterministic fallback classification when model output is unavailable/unsupported.
- Ensure no endpoint failures if model input is sparse or malformed.
- Keep payload shape backward-compatible and safe.

3) Frontend trajectory chip support
- Update TrajectoryChipSparkline.tsx only as needed so it can consume model-informed trajectory labels safely.
- Keep fallback behavior and safe rendering with missing/unknown labels and sparse series.

4) Verification
- Run:
  - pnpm --filter @capiro/api typecheck
  - pnpm --filter @capiro/web typecheck

Constraints:
- No schema migrations.
- Keep changes focused on H-002.
- Avoid touching unrelated routing/other feature logic.

Deliverable:
- Commit-ready H-002 code.
- Final summary: files changed + exactly how model-vs-fallback is chosen.