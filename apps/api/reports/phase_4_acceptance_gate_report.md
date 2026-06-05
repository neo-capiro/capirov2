# Step 37 — Final Acceptance Gate Report (PE Watch v1.0)

Generated: 2026-06-01 (HEAD `9dd335e`)
Evaluator: automated acceptance pass, local dev environment.

## VERDICT: 🔴 NO-GO

The release does not meet the Boss Plan §1.4 success metrics. Two blockers are
verifiable from here with certainty (web typecheck fails; data plane is dev-tier
and an order of magnitude below targets). Several metrics could not be measured
truthfully because they require the private-VPC Aurora DB with all Phase 2/3
syncs run against current-FY data and a rendering PE Watch UI — the stated
prerequisite ("every Phase 2 and Phase 3 sync has run at least once against
current FY data") is NOT met in this environment.

Per the prompt, on NO-GO I produce a fix list with file:line refs and do NOT
attempt fixes, do NOT cut the `pe-watch-v1.0` tag, and do NOT deploy.

---

## Pass/fail per §1.4 acceptance criterion

| # | Criterion | Target | Observed | Result |
|---|-----------|--------|----------|--------|
| 1 | ProgramElement count | ≥ 6,300 active | **870** (1,662 quarantined) | ❌ FAIL |
| 2 | Personnel coverage (PEO/PM spot-check) | ≥ 70% | PEs with ANY personnel link: **61 / 870 = 7.0%** | ❌ FAIL |
| 4 | PE history accuracy vs R-Docs | ≥ 95% | Not measurable here (no DB/R-Doc fetch); prior run inconclusive | ⚠️ NOT RUN |
| 5 | Bill–PE linkage precision | ≥ 80% | Not measurable here (no DB) | ⚠️ NOT RUN |
| 6 | Personnel accuracy vs sources | ≥ 85% | Prior gate run: strict 0/4, lenient 25% on determinable sample | ❌ FAIL (last-known) |
| 9 | Conference Brier (real FY24+FY25) | ≤ 0.18 | Spec asserts ≤ 0.20 on **fixtures**, not real enacted | ⚠️ NOT SATISFIED AS SPEC'D |
| 10 | All tests green + typecheck clean | required | API tsc ✅; **web tsc FAILS**; API jest baseline unconfirmed full-run | ❌ FAIL |
| 11 | Lighthouse budget (FCP/LCP) | met | Not run (needs rendered PE Watch w/ real data) | ⚠️ NOT RUN |
| — | SOC 2 controls review | passes | **No SOC 2 control doc exists in repo** | ⚠️ NOT RUN |

(Steps 3, 7, 8, 12 detail below.)

---

## Measured figures (from data plane — `apps/api/reports/`, captured 2026-05-30)

- ProgramElement rows: **870** (target ≥ 6,300) — **13.8% of target**
- ProgramElement quarantine: **1,662** (PE-side reconciliation/quarantine » the
  <100 budget if these surface in the review queue)
- AcquisitionPersonnel rows: **3,544** (unique name_key: 3,544)
- AcquisitionPersonnel source rows: 6,389
- PE codes WITH personnel links: **61** → coverage **7.0%** (target ≥ 70%)
- PE codes WITHOUT personnel links: **809**
- Personnel merge queue (open): **0** ✅ (< 50 budget met — but trivially, low data)
- Personnel quarantine: 0

### Step 2 — 20-PE PEO/senior spot-check
Cannot be performed as specified (requires live lookup of PEO/senior PM names per
PE across Services). Structural coverage is the ceiling: only 61 PEs have ANY
personnel link, so a cross-Service 20-PE sample cannot reach 70% PEO/PM presence.

### Step 3 — PE Watch for 0603270A, 0204134N, 0603250F
- `0204134N` (Navy F/A-18 modernization) is in the **missing-personnel** list →
  Program Team panel renders empty.
- Prior gate run (2026-05-30) reported the PE Watch route renders a **blank shell**
  (`#root` with 0 children) in the headless environment, so panels could not be
  visually verified. Not confirmed rendering "reasonably." ❌/⚠️

### Steps 4, 5, 6 — accuracy spot-checks
- Require the DB + source PDFs/pages. Not reachable from this host (Aurora is
  private-VPC; local `DATABASE_URL` points at localhost with no data).
- Last-known personnel accuracy (prior gate, determinable subset 4/10): strict
  0%, lenient 25% — below the 85% bar; many `publicProfileUrl`s are authwalled /
  non-profile landing pages.

### Step 7 — reconciliation/queue snapshot
- Personnel merge queue: 0 open ✅ (< 50).
- PE side: 1,662 program_element_quarantine rows. If these feed the PE
  reconciliation review queue they blow the <100 budget by ~16×; if quarantine is
  separate from the review queue this is "needs classification." ⚠️

### Step 8 — Watch → parser re-run → IntelligenceChange → Inbox + Briefing
- Not executed (needs a running app + DB). The emission path now exists in code
  (`markDeparted` → `person_departed`; DoW parser → `vacancy_detected`), but the
  end-to-end flow to Inbox + Daily Briefing was not demonstrated. Prior run: "no
  new IntelligenceChange rows in last 15 min (not confirmed)." ⚠️ NOT RUN

### Step 9 — Conference probability Brier backtest
- `conference-probability.service.spec.ts` PASSES (3 tests) but asserts
  `brierScore <= 0.20` on **fixture-like rows**, not ≤ 0.18 on real FY24+FY25
  enacted outcomes. Does not satisfy the criterion as written. ⚠️

### Step 10 — tests + typecheck  ❌ BLOCKER
- `pnpm --filter @capiro/api exec tsc --noEmit`: **PASS** (exit 0).
- `pnpm --filter @capiro/web exec tsc --noEmit`: **FAIL** —
  `apps/web/src/pages/clients/ClientProfilePage.tsx:429:57` TS2322
  `Type 'Capability[]' is not assignable to type 'DowDirectoryTabCapability[]'`.
  (Pre-existing, from the in-flight DoW directory workstream — confirmed via
  stash; not introduced by Step 36 work, but it fails the gate's "typecheck
  clean" requirement.)
- Full API jest suite not run end-to-end this pass; targeted suites green
  (acquisition-personnel 107/107, intelligence 27/27, conference-probability 3/3).
  Prior gate reported 2 API suites / 47 tests failing — must be reconfirmed green
  before GO.

### Step 11 — Lighthouse
- `lighthouse@12.8.2` is a web devDependency, but no FCP/LCP captured: requires a
  rendered PE Watch with real data + populated Program Team panel (blocked by data
  + prior blank-shell runtime). ⚠️ NOT RUN

### Step 12 — audit_logs spot-check
- Not executed (no DB). Note: merge-queue list/resolve DO write audit_logs in
  code (`acquisition-personnel-read.service.ts` actions
  `acquisition_personnel.merge_queue.list` / `.resolve`). Coverage across ALL
  endpoints not verified. ⚠️

### Step 13 — SOC 2 controls review
- **No SOC 2 control documentation found in the repo** (`SOC2*`, `docs/soc2*`
  absent). Cannot review. ⚠️ NOT RUN

---

## Known gaps (root causes)

1. **Data plane is dev-tier, not production-FY.** 870 PEs vs 6,300 target; 7%
   personnel coverage vs 70%. The Step 37 prerequisite (all Phase 2/3 syncs run
   against current FY) has NOT been satisfied. Acceptance cannot pass until a full
   sync run populates current-FY PEs and personnel.
2. **1,662 PEs quarantined** — a large fraction of ingested PEs are being rejected;
   parser/validation tuning likely needed (the count exceeds the surviving 870).
3. **Web typecheck broken** by the DoW directory integration (file:line below).
4. **No SOC 2 control doc** and **no Lighthouse/perf harness wired** for CI.
5. **Brier criterion** is asserted against fixtures, not real enacted outcomes.
6. **Environment can't run the live/UI/DB acceptance steps** (private-VPC Aurora,
   headless blank-shell runtime in prior run).

---

## Fix list (file:line) — DO NOT fix in this step

1. `apps/web/src/pages/clients/ClientProfilePage.tsx:429` — TS2322: the
   `capabilities` prop passed to `DowDirectoryTab` is typed `Capability[]` but the
   component expects `DowDirectoryTabCapability[]`. Reconcile the two capability
   types (shared type or mapper) so web `tsc --noEmit` is clean. (Owned by the DoW
   directory workstream.)
2. Data: run every Phase 2/3 sync against current-FY data
   (`capiro-dev-api-sync-*` task-defs) until ProgramElement ≥ 6,300 active and
   re-measure personnel coverage; investigate the 1,662-row
   `program_element_quarantine` (parser acceptance in the PE ingest path).
3. Re-run the full `pnpm --filter @capiro/api test` and restore any failing
   suites to green (prior gate: 2 suites / 47 tests) before re-gating.
4. `apps/api/src/program-element/models/conference-probability.service.spec.ts:68`
   — backtest asserts ≤ 0.20 on fixtures; add a real FY24+FY25 enacted backtest
   asserting ≤ 0.18 to satisfy §1.4 #9.
5. Add a SOC 2 control mapping doc (e.g. `docs/soc2-controls.md`) and an audit_log
   coverage check across endpoints before the SOC 2 review can pass.
6. Wire a Lighthouse run (CI or scripted) against a rendered PE Watch with real
   data; capture FCP/LCP against the budget.
7. Resolve the PE Watch blank-shell runtime in the headless/eval environment so
   Steps 3, 8, 11 can be executed.

---

## Release action

- Tag `pe-watch-v1.0`: **NOT cut.**
- Staging/prod deploy: **NOT performed.**
- Rationale: NO-GO per criteria above + standing instruction to not push to AWS.
