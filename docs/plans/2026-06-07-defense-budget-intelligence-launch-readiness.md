# Defense Budget Intelligence — Launch Readiness (Step 4.2)

Companion to the execution plan (`2026-06-07-defense-budget-intelligence-gap-analysis-and-execution-plan.md`)
and the deploy/remaining runbook (`docs/runbooks/defense-budget-intelligence-deploy-and-remaining.md`).
Status legend: ✅ done · ⚠️ pending (needs data/ops, not code) · ⛔ blocked (needs an external key/credential/PDF).

## §27 acceptance scenario — PASS (automated)

`apps/api/test/e2e/defense-budget-intelligence.e2e.spec.ts` drives the full pipeline on one shared
store and asserts **each built §27 step** explicitly (81 assertions): SourceDocument + sha256 (0.1) →
page-cited extraction rows (1.2) → reconciliation PASS (0.2) → material typed delta ≥0.4 (1.4) → R-2A
project (1.2) → program match left **candidate** then **accepted** via the resolve path (2.1) → client
relevance ≥0.5 with per-path evidence (2.3) → contact-use guardrail: a procurement POC is **never** an
outreach target (2.2) → ActionRecommendation with all §10 fields, gated on materiality≥0.4 ∧ relevance≥0.5
(3.2) → proof pack resolves every evidence ref (1.2) → uncertainty surfaces an unconfirmed dependency
(3.2) → coverage gap → `schedule_outreach` card (3.4) → owner assigned + status walked + a second card
dismissed with a required reason (3.2). **§27.12 (artifact generation)** is `it.todo` — pending Step 3.3
(runtime LLM). Result: **1 passed, 1 todo**; api typecheck clean.

## Alpha gate (core capability) — ✅ READY

| Criterion | Status | Evidence |
|---|---|---|
| Every PE budget figure traceable to a source document + page | ✅ | Step 1.2 proof-pack (`b48e6b0`); §27.1/.2 asserts |
| Budget changes are typed + materiality-scored | ✅ | Step 1.4 delta engine (`0064296`); 37 specs |
| Program graph with review-gated matching (never fuzzy-auto-accept) | ✅ | Step 2.1 (`92b11f8`); `program-match-thresholds.spec` |
| People hang off offices/roles, not PEs; FAR contact-use guardrail | ✅ | Step 2.2 (`212790e`); `contact-use.policy.spec` (exhaustive never-lobbying matrix) |
| Client relevance on explainable, evidenced paths (RLS-isolated) | ✅ | Step 2.3 (`194a7d9`/`8b949a0`); RLS probed as `capiro_app` |
| Action cards: gated, client-specific, composed from stored facts, with proof + uncertainty | ✅ | Step 3.2 (`89dde05`/`ebefb82`); 99 action+relevance specs |
| Relationship coverage gaps → outreach (read-only on engagement) | ✅ | Step 3.4 (`66b940f`/`e75cf80`) |
| One analyst console for every review queue + alias/merge + quarantine + audit | ✅ | Step 3.5 (`982080c`/`b2e3067`) |
| All migrations additive (no drops; no auth/identity tables touched) + applied to prod | ✅ | 7 migrations `150000–210000`; live on `origin/main` |
| End-to-end §27 scenario automated + green | ✅ | this step (e2e spec) |
| Accuracy/metrics harness exists | ✅ | Step 4.1 (`94a9e04`) |

## Beta gate (operational readiness) — ⚠️/⛔

| Criterion | Status | Note |
|---|---|---|
| Live prod data populated so features show data | ⚠️ | one-time ops run: `seed:programs`→`match:pe-program`, `backfill:program-offices`, `deltas:compute`→`generate:actions` (runbook §2) |
| Real §22 accuracy numbers | ⚠️ | harness ready; needs **human-curated golden sets** (test/__golden__/README.md). CLI reports `n/a` on the synthetic placeholders rather than fake-greening |
| Perf baselines vs §21 (<1s search / <3s profile / <10s card) | ⚠️ | `scripts/perf/*` + `docs/runbooks/perf-baselines.md` ready; needs a seeded env run |
| Live market signal (SAM.gov procurement) | ✅ built / ⚠️ run | Step 3.1 DONE (ingestion + matcher + PE panel); `SAM_GOV_API_KEY` valid in Secrets Manager — run `sync:sam-opportunities` in prod to populate the `monitor_procurement` cards |
| Source-backed artifact generation (one-pagers/memos) | ✅ | Step 3.3 DONE — FactSheet + constrained LLM (existing Anthropic path) + citation verifier + ClioArtifact + action-card Generate/viewer. Completes the §27 north-star |
| RDT&E marks + R-2A-deep coverage | ✅ extracted / ⚠️ load | HASC FY26/27 + SASC FY26 marks + full FY2027 R-1/R-2/performers artifacts committed; verified load → 1,579 deltas on a scratch DB. Run the loaders in prod (recipe in PROGRESS) |
| Appropriations marks + enacted | ⏳ pending publication | Steps 0.3-approps — HAC-D/SAC-D reports + enacted law not published yet; `parse:hac-d-report`/`sac-d`/`public-law` built, auto-ingest on release |
| P-1 procurement coverage | ⛔ extractor | Step 1.1 — Army books on hand but `extract_pdoc.py` yields 0 on the weapon-system/BLIN layout; needs the extractor adapted to P-1/P-40. Schema + loader ready |
| Committee report *language* (provisions) | ⛔ source | Step 2.4-extraction — needs the HASC/SASC committee-report PDFs (the narrative, not the marks); loader (`sync:report-provisions`) + classifier built |
| Ingestion-schedule truth-up | ⛔ | Step 0.4 — needs `cdk diff` / prod AWS |

## §26 negative criteria (must-NOT) — ✅ enforced

| Must NOT | Status | Enforced by |
|---|---|---|
| Render a person as "owning" a PE | ✅ | `buildWhyShown` uses role/office phrasing, never "owns PE"; web grep clean (Step 2.2) |
| Use a procurement official (contracting officer / SAM-sourced) as a lobbying target | ✅ | `contact-use.policy` FAR rule + `action-audience` (Steps 2.2/3.2); specs assert it |
| Use a quarantined/candidate program match in a confident recommendation | ✅ | `action-audience` forces `escalate_uncertainty`; `isExcludedFromRecommendations` (§7) |
| Auto-accept a fuzzy/alias match | ✅ | `program-match-thresholds` caps fuzzy < 0.90 → candidate/quarantined only (Step 2.1) |
| Leak tenant data across tenants | ✅ | RLS on `client_facilities`/`action_recommendation` (FORCE + isolation policy), behaviorally verified |
| Fabricate accuracy/coverage numbers | ✅ | accuracy CLI returns `n/a` on synthetic golden sets; blocked steps scaffolded, never faked |
| Surface a stale relationship as current | ✅ | `staleAt` + "Stale — verify before use" badge (Step 2.2); excluded from outreach gaps (3.4) |

## Demo script (reproduce §27 in the UI — after data population)

1. **Program Elements → Browse** → open a watched PE → see FY history + **What changed** (typed deltas) + **Programs** + **Congressional activity** + Projects/proof-pack (click a page deep-link to the source).
2. **Program Elements → Action Board** (`/actions`) → a client-specific card: what changed, why it matters, recommended action, audience (with contact-use badges), confidence, deadline, evidence chips → expand **Relationship coverage** → assign an owner on a gap → "Assign & create outreach".
3. Walk the card's status; dismiss a second card (reason required).
4. **Program Elements → Analyst Console** (`/admin/analyst-console`, capiro_admin) → review the match/person/merge queues, the alias manager, quarantine, and the audit log; SLA chips show queue age.

## CI: wiring the e2e as a separate job (not auto-added — workflows are prod-sensitive)

The e2e is slower than unit specs; run it as its own job. It's already discoverable via the jest
`testMatch` glob `<rootDir>/test/**/*.e2e.spec.ts` (added in this step). Suggested step:

```yaml
- name: e2e acceptance (§27)
  run: pnpm --filter @capiro/api test -- defense-budget-intelligence.e2e
```

Do NOT add this to `.github/workflows/*` without confirming the CI account/runner; documented here per the
Step 4.2 instruction.
