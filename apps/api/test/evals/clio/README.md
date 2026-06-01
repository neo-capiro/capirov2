# Clio eval harness (P1-1)

Committed Q&A fixtures + a runner that measures Clio answer quality (pass-rate and
grounded-rate), scoped by skill.

- **Fixtures:** `apps/api/src/clio/evals/fixtures.ts` — typed, ≥50 items, each scoped
  by `skill` (`research` / `briefing` / `draft` / `general` / `citation` / `refusal`).
  Grounded fixtures embed their sources inline.
- **Grader (pure, CI-tested):** `apps/api/src/clio/evals/eval-grader.ts` (+ `.spec.ts`).
- **Fixture validity (CI-tested):** `apps/api/src/clio/evals/fixtures.spec.ts`.
- **Runner (manual — hits the live API, costs tokens):** `apps/api/scripts/eval-clio.ts`.

## Run

```bash
pnpm --filter @capiro/api eval:clio                 # all fixtures
pnpm --filter @capiro/api eval:clio --skill=research # one skill
```

Requires `ANTHROPIC_API_KEY` + `CLIO_MODEL` (optionally `CLIO_INTENT_MODEL`) in
`apps/api/.env` or the environment. Each fixture is answered by `CLIO_MODEL`; sourced
fixtures are then graded for grounding by `CLIO_INTENT_MODEL` reusing the P0-6 verifier.

Gates (exit non-zero if unmet): `CLIO_EVAL_MIN_PASS_RATE` (default `0.8`),
`CLIO_EVAL_MIN_GROUNDED_RATE` (default `0.8`). A full JSON report is written to
`last-report.json` (gitignored).
