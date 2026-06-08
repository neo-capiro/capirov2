# Defense Budget Intelligence — deploy runbook + remaining work

Branch: `feat/defense-budget-intelligence-plan`. This document is the operator handoff for the
work shipped on this branch and the honest list of what is still blocked or unbuilt.

Plan: `docs/plans/2026-06-07-defense-budget-intelligence-gap-analysis-and-execution-plan.md`
Progress tracker: `docs/plans/PROGRESS-defense-budget-intelligence.md`

## 1. What shipped on this branch (all verified green, per-step commits)

| Step | What | Verified |
|------|------|----------|
| 1.2 | PE projects + proof pack (API + web) | jest + vitest |
| 1.3 | Budget-cycle PB position + FYDP (schema/API/loader) | jest + scratch-DB migration |
| 1.4 | Typed budget-delta engine + materiality + "What changed" panel | jest + vitest |
| 2.1 | Program / ProgramAlias / PeProgramMatch graph + match queue | jest + scratch-DB |
| 2.2 | ProgramOffice / PersonRole + contact-use guardrail + backfill + web badges + staleness | jest + scratch-DB + behavioral checks |
| 2.3 | Client relevance v2 (RLS inputs, scoring service, API, web, writer wiring) | jest + scratch-DB + **RLS behaviorally probed as capiro_app** |
| 2.4 | Committee report provisions (models, classifier, loader/linking, API, panel) | jest + scratch-DB |
| 3.2 | ActionRecommendation engine + CRUD API + ActionBoard web | jest + vitest + scratch-DB RLS |
| 4.1 | Accuracy harness + product/perf metrics | jest |

Every migration was validated with `prisma migrate deploy` on a throwaway scratch DB (never
`migrate dev` against a real DB). RLS tables (`client_facilities`, `action_recommendation`) were
checked for `relforcerowsecurity` + the isolation policy; `client_facilities` was additionally
probed behaviorally (tenant A cannot read tenant B as the non-super `capiro_app` role).

## 2. Deploy-time runbook (after merging + `prisma migrate deploy` to the target DB)

Migrations to apply (additive, in order): `..._add_program_graph`, `..._add_program_element_budget_position`,
`..._add_program_element_delta`, `..._add_program_office_person_role`, `..._add_client_relevance_inputs`,
`..._add_action_recommendation`, `..._add_committee_report_provision`.

Then, to populate + operate (most are idempotent; run dry first where supported):
1. `pnpm --filter @capiro/api seed:programs` (if present) then `match:pe-program` — seed the program graph + propose matches (human-review the candidate queue at `/admin/program-element/match-queue`).
2. `pnpm --filter @capiro/api sync:peo-rosters --commit` then `backfill:program-offices --commit` — offices + person-roles from the committed rosters.
3. Schedule `reconcile:person-role-staleness --commit` (e.g. weekly) to mark roles stale after 180d.
4. `deltas:compute --commit` after each budget ingest → then `generate:actions --commit` (schedule daily, after emit-changes) to produce action cards. Board at `/actions`.
5. Clients populate UEI/CAGE/NAICS/PSC + facilities via the client editor / Facilities tab; relevance computes on demand (no batch needed).
6. `measure:accuracy --json` once human-curated golden sets exist (see §4).

## 3. Spawned follow-up tasks (tracked as chips; not on this branch)

- **RLS hardening of `client_capabilities` + `client_intel_mapping`** — both lack DB RLS policies. The relevance service is currently tenant-safe via a clientId-ownership guard through the RLS-protected `clients` table, but the SOC2-correct fix is DB-level RLS. Requires first converting the cross-tenant *system* readers (delta writer's `getAffectedTenants`) to a bypass path, then enabling FORCE RLS — otherwise the non-super app role gets zero rows. `client_intel_mapping` also needs a `tenant_id` column + backfill.
- **Fuzzy-search pagination total** in `acquisition-personnel-read.service.ts` (pre-existing; reports a wrong total for fuzzy name search beyond page 1).

## 4. Data / infrastructure-blocked steps (NOT completable in this environment)

These could not be done here for lack of the underlying data/infra; the CODE that consumes their
output is built and dormant (honest: no fabricated data). Each needs the listed unblock.

- **0.3 mark/enacted coverage FY26–27**, **1.1 P-1 procurement ingestion**, **1.5 R-2A deep extraction**,
  **2.4 provision EXTRACTION** — all need real congressional/budget **PDFs + a pdfplumber extraction pass**
  on a machine with the documents. The schemas, loaders, classifiers, and panels that consume the
  extracted artifacts are shipped; drop the real `*.json` artifacts into the loaders' `__data__` dirs and run
  the corresponding `parse:*` / `sync:report-provisions --commit`.
- **0.4 ingestion scheduling truth-up** — needs `cdk diff` / prod AWS access to reconcile EventBridge
  schedules. Diagnostic script + conventions exist; the CDK/EventBridge wiring is deferred to an operator
  with AWS creds.
- **3.1 SAM.gov opportunities** — needs a live `SAM_GOV_API_KEY`. `sync-sam-personnel.ts` already proves the
  auth/paging; the opportunities ingestion + matching is specced (plan §3.1) and the ActionBoard already has a
  dormant `monitor_procurement` card type ready to light up.
- **3.3 source-backed artifact generation** — needs a runtime LLM (Anthropic) credential + the existing
  Clio generate-document/verifier machinery. The action cards already carry the FactSheet-able evidence; the
  generator/verifier is specced (plan §3.3).

## 5. Remaining code-completable steps (a fresh session can pick these up)

- **3.4 relationship coverage gaps** — analyze + surface gaps in the person/office/program graph.
- **3.5 unified analyst console + alias manager + audit views** — web-heavy console unifying the surfaces
  built in 2.1/2.2/2.3/3.2 + the existing review queues.
- **4.2 end-to-end acceptance test (§27) + launch checklist** — drive the full pipeline on a synthetic
  fixture (source → delta → project → program → client → action → proof). The artifact-generation step
  depends on 3.3 (LLM), so that row would be stubbed/partial until 3.3 lands.

## 6. Branch hygiene notes

- This branch is based off `5ca3bcc` (which bundles a concurrent whitepaper session's backend + Steps 0.1/0.2).
  If `main` history is rewritten, REBASE this branch onto final main before merging.
- All work was done in an isolated git worktree (`C:/Users/neoma/capiro-obi`) to avoid colliding with the
  concurrent session that owns the OneDrive working tree. No whitepaper/chat/theme.css files were touched.
- `pnpm lint` is known-broken repo-wide (eslint not installed); gates used were typecheck + jest/vitest + prettier.
