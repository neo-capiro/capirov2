Run Phase 1 smoke test in this repo and output a concise machine-readable report.

Repo: C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2

Tasks:
1) Run seed:program-element and verify 10-15 PEs.
2) Verify /program-elements/0603270A panels render.
3) Toggle Watch; reseed with one mark changed; verify IntelligenceChange exists and Changes Inbox shows event.
4) Verify Mark-up Monitor sorts watched PEs by divergence.
5) Verify Daily Briefing for watched defense PE includes PE section.
6) Run tests: pnpm --filter @capiro/api test and pnpm --filter @capiro/web test.
7) Run pnpm typecheck across monorepo.
8) Run Lighthouse on PE Watch and capture FCP/LCP.
9) Verify audit_logs entries for PE endpoints.
10) Run conference probability backtest and capture Brier.

Constraints:
- Do not modify product code unless absolutely required for smoke harnessing; if modified, list files.
- If blocked, state exact blocker.
- Output JSON with keys:
  {
    "tasks": [{"id":1,"status":"pass|fail|blocked","evidence":"..."}],
    "acceptance": {
      "all_phase1_pass":"pass|fail",
      "lighthouse_meets_budget":"pass|fail",
      "tests_green":"pass|fail",
      "no_ts_errors":"pass|fail",
      "audit_logs_complete":"pass|fail"
    },
    "lighthouse": {"fcp_ms": number|null, "lcp_ms": number|null, "notes":"..."},
    "known_fixture_limitations": ["..."],
    "phase23_readiness_checklist": [{"item":"...","status":"ready|not_ready"}],
    "commands_run": ["..."]
  }
