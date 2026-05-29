Task: G-005 -> G5 (production-ready)

Goal
Implement Snapshot engagement CTA routing so engagement CTAs preserve client context.

Primary file to edit
- apps/web/src/pages/clients/intelligence-v1/ClientIntelV1Page.tsx

Acceptance criteria
- Engagement CTAs preserve client context (clientId) when navigating from Client Intel v1 surfaces.
- No regressions to existing CTA routing for changes inbox, bill details, issue leaderboard, or section wiring.
- Typecheck passes for web and api.

Implementation notes
- Read ClientIntelV1Page.tsx first.
- Snapshot/legislative engagement-related CTA should carry client scope.
- Prefer a safe href builder that appends `clientId` query param only when missing.
- Keep links deterministic and avoid hardcoded unscoped `/engagement` from this page.
- If backend contract must change for robust scoped link generation, make the minimal adjustment and update types accordingly.

Do
1) Inspect current CTA props passed from ClientIntelV1Page to section components.
2) Implement scoped engagement href in ClientIntelV1Page.
3) Make minimal backend/type adjustments only if required.
4) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
5) Summarize exact files changed and how acceptance is met.