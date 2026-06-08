# Defense Budget Intelligence — execution progress

Branch: `feat/defense-budget-intelligence-plan` (off `main` @ 5ca3bcc).
Plan: `docs/plans/2026-06-07-defense-budget-intelligence-gap-analysis-and-execution-plan.md`.
Driver: autonomous overnight run. Each completed step is its own commit; this file is the tracker.

## Working rules
- Each step: read the closest analogous code → implement to convention → verify (typecheck +
  jest/vitest, DB on a scratch DB where needed) → adversarial review → commit. Never break the
  baseline suites.
- **Concurrent work**: a parallel session is editing whitepaper/chat UI files
  (`apps/web/src/components/chat/*`, `WhitePaperEditorPage.tsx`, `theme.css`) in this same working
  tree. Those are left UNTOUCHED and never staged in my commits.
- **Autonomy limits (honest)**: this env has no reliable way to (a) download + pdfplumber-extract
  real congressional PDFs, (b) run `cdk diff`/query prod AWS, (c) call runtime LLMs, or (d) use a
  SAM.gov key. Steps that hinge on those are **scaffolded** (tooling + runbooks + deferred-data
  notes), not faked. Marked SCAFFOLDED below.

## Status
| Step | Title | Status |
|------|-------|--------|
| 0.1 | Source-document registry | ✅ done (commit 7b79862) |
| 0.2 | Reconciliation resolve loop + totals harness | ✅ done (in 5ca3bcc) |
| 0.3 | Mark/enacted coverage FY26–27 | ⏳ SCAFFOLDED — needs real PDFs |
| 0.4 | Ingestion scheduling truth-up | ⏳ partial — diag script + docs; CDK/AWS deferred |
| 1.1 | P-1 procurement ingestion | ⏳ SCAFFOLDED — needs real P-1 PDF |
| 1.2 | Surface projects + proof pack (API+UI) | ✅ done — API+web+tests green |
| 1.3 | Budget-cycle (PB position) + FYDP outyears | ⏳ code done (schema+API+loader+specs); outyear/prior-PB DATA deferred |
| 1.4 | Typed budget-delta engine + materiality | ✅ done — engine+scorer+API+script+web "What changed" panel; writer-severity rewire deferred (engine already emits IntelligenceChange) |
| 1.5 | R-2A deep extraction | ⏳ SCAFFOLDED — needs richer extraction data |
| 2.1 | Program / ProgramAlias / PEProgramMatch | ✅ done (backend+web); explorer-tab wiring deferred (hook added) |
| 2.2 | ProgramOffice + PersonRole + guardrails | ✅ done — foundation (212790e) + follow-on (backfill, read+API roles hydration, matcher-records-PersonRole, web ProgramTeamPanel badges, staleness); adversarial review issues fixed. Backfill+matcher are tooling; live population deferred to deploy-time run |
| 2.3 | Client relevance v2 | ⬜ pending |
| 2.4 | Committee report language capture | ⬜ pending |
| 3.1 | SAM.gov opportunities ingestion | ⏳ needs SAM_GOV_API_KEY/data |
| 3.2 | ActionRecommendation engine + Action Board | ⬜ pending |
| 3.3 | Source-backed artifact generation | ⏳ needs runtime LLM |
| 3.4 | Relationship coverage gaps | ⬜ pending |
| 3.5 | Unified analyst console | ⬜ pending |
| 4.1 | Accuracy harness, golden sets, metrics | ⬜ pending |
| 4.2 | End-to-end acceptance test + launch checklist | ⬜ pending |

## Execution order (value + completability, deps respected)
Code-completable first: 1.2 → 1.4 → 1.3 → 2.1 → 2.4 → 4.1 → 2.2 → 2.3 → 3.2 → 3.4 → 3.5 → 4.2.
Scaffold/partials interleaved: 0.4 (diag+docs), 0.3 / 1.1 / 1.5 (tooling+runbooks), 3.1 / 3.3 (scaffolds).

## Log
- (start) Branched `feat/defense-budget-intelligence-plan` off 5ca3bcc; baseline typecheck clean
  (api+web), jest 715 / vitest 98 green.
- **Concurrent-session collision + worktree pivot**: a parallel session switched the shared
  OneDrive working tree to its own branch (`whitepaper-clean`) mid-task, yanking my checkout. To
  work safely overnight without colliding, I created an **isolated git worktree** for my branch at
  `C:/Users/neoma/capiro-obi` (separate working dir, own node_modules, shared .git). All overnight
  work happens there; the OneDrive tree is left to the other session. My branch retains complete
  Steps 0.1 + 0.2 (verified: resolveReconciliation + budget-reconciliation present).
  NOTE for review/merge: this branch is based on 5ca3bcc (bundles the other session's whitepaper
  backend); if `main` history is rewritten, rebase this branch onto final main before merging.
- **Step 1.2 done** (worktree): API `GET :peCode/projects` + `:peCode/sources` (proof-pack ordered
  R-1→R-2→R-2A→R-3→P-1→P-40, FY desc, page asc) + projectCount/sourceCount on the detail; web
  ProjectsPanel + ProofPackPanel (deep-links `#page=`) wired into the PE page; ContractorsPanel
  named-prime link now appends `#page=`. Tests: proof-pack ordering, controller delegation,
  panel render + deep-link + empty-state. api+web typecheck clean; targeted jest 19 / vitest 9 green.
  Deferred (not in success criteria): FyDetailDrawer per-field open-at-page link — minor follow-up.
- **Step 2.1 backend done** (implemented by a sub-agent in the worktree, then independently
  verified by me): Program / ProgramAlias / PeProgramMatch (global, additive migration w/ pg_trgm
  GIN + functional-unique COALESCE index); `seed-programs.ts` (idempotent, MDAP→Program +
  accepted/mdap_curated matches + aliases); pure `program-match-thresholds.ts` (the §5/§7
  guardrail — fuzzy/usage tiers can NEVER reach 'accepted'); `pe-program-matcher.service.ts`
  (trigram, fuzzy capped <0.90 → candidate/quarantined only) + `match-pe-program.ts`;
  ProgramsService/Controller (`GET /programs`, `/programs/:id`, admin match-queue list + resolve
  w/ AuditLog). Verified: api typecheck clean; 6 suites/81 specs green (incl. table-driven
  thresholds + 0 fuzzy-accept SQL proof); migration applies clean on a fresh scratch DB; seed +
  matcher proofs.
- **Step 2.1 web done** (sub-agent + my verification): web programs-api, ProgramMatchQueuePage
  (capiro_admin review queue: why-shown evidence line + confidence band + status, accept/reject/
  quarantine + AuditLog), ProgramsPanel on the PE profile (accepted + candidate-badged, quarantined
  hidden), thin `GET /program-elements/:peCode/programs` read + controller delegation test, App.tsx
  route. Verified: api+web typecheck clean; FULL suites green (API 99 suites/778, web all pass).
  Deferred (documented): explorer "Programs" search TAB (needs a new /api/explorer/programs facet
  endpoint + panel — risky to the finder); added the `getPrograms`/`useProgramSearch` building block.
- **Step 1.3 code done** (sub-agent + my verification): `ProgramElementBudgetPosition` (global,
  additive migration, natural-key unique, FK→PE cascade + →source_document set-null); pure tested
  `computePbComparison` (new_in_pb/dropped_from_pb, null/zero handling); idempotent
  `upsertBudgetPosition` + column→positions builder; `GET :peCode/positions` + `:peCode/pb-comparison`;
  verify-budget-reconciliation extended to position cycles. Verified: api typecheck clean; 7
  suites/98 specs green; migration applies clean on an independent fresh scratch DB.
  **DATA-PENDING** (built to consume it): FYDP outyears (committed R-1 artifact has no $ columns —
  needs real R-1 PDF re-extraction) + FY2026 prior-PB book (unavailable) → loader writes 0 rows
  today + pb-comparison returns empty until data lands. Headline data criteria deferred by design.
- **Step 1.4 done** (sub-agent built the engine+scorer but STREAM-TIMED-OUT after ~1.9h; I salvaged
  its typecheck-clean core — 37 specs green — and finished the rest): `ProgramElementDelta` (global,
  additive, partial+functional unique latest-wins index); pure table-driven `materiality-scorer.ts`
  (log-scaled $, pct, stage ordering, unusual-pattern boost; clientRelevance is read-time only) +
  `delta-compute.ts` + `delta-engine.service.ts` (idempotent recompute, emits ONE IntelligenceChange
  per NEW material delta — year-derived types REAL today; PB/procurement types dormant until data).
  Added by me: `compute-budget-deltas.ts` script + `deltas:compute` alias; `GET :peCode/deltas`
  (filter deltaType/fy) + `GET deltas/needs-attention?minScore=&fy=` (per-tenant clientRelevance
  boost at read time) + controller delegation tests + DTO fields. Verified: api typecheck clean;
  controller+deltas specs 59 green; 1.4 migration applies clean on fresh scratch DB.
  **Deferred**: the writer-emission severity rewire (the engine already
  emits IntelligenceChange, so alerting works; the writer rewire was the timeout-risky part).
- **Step 2.2 done** (foundation by an agent, follow-on by a 8-agent Workflow + my adversarial-review
  triage). FOUNDATION (commit 212790e): global models ProgramOffice / PersonRole / ProgramOfficeProgramLink
  (additive migration, functional-unique office key, FKs verified on a fresh scratch DB) + the pure
  contact-use guardrail policy (FAR hard rule: contracting_officer/sam_gov => official_procurement_poc,
  NEVER lobbying; source-selection => do_not_contact; 21 specs incl. exhaustive never-lobbying matrix).
  FOLLOW-ON: backfill-program-offices.ts (roster orgs -> offices, people -> roles, idempotent find-or-create
  on the raw functional-unique key, conservative programOfRecord match, never creates people, excludes
  superseded); read-service getProgramElementPersonnel now hydrates roles[] (batched, no N+1) w/ contactUse
  badge + buildWhyShown chain (names the missing hop) + freshness; resolvePersonCandidate CONFIRM now also
  materializes a PersonRole (atomically, idempotent); web ProgramTeamPanel renders the contactUse badge +
  why-shown + 'Stale — verify before use'; classifyRoleStaleness (180d, pure) + reconcile-person-role-staleness.ts.
  ADVERSARIAL REVIEW (4 code-reviewers) caught + I FIXED: (1) **roles hydration leaked quarantined roles** ->
  fetchRolesByPerson now excludes reviewStatus quarantined (keeps accepted+candidate, candidate is badged) +
  web defense-in-depth filter + spec; (2) resolve split-transaction -> candidate.update moved INSIDE the tx
  + idempotent already-resolved guard (no duplicate provenance on re-confirm; spec asserts single source row);
  (3) suggestPerson re-open bug (rejected stayed invisible) -> update now sets status:'open'; (4) backfill
  dry-run count inflated + included superseded -> fixed; staleness reconcile comment over-promised recommendation
  exclusion -> corrected (display shows stale badged; exclusion is the 3.2 generator's job). Wired
  jest.config testMatch to run scripts/**/*.spec.ts (the backfill spec). Verified: api typecheck clean;
  17 suites/223 specs green; web typecheck clean; ProgramTeamPanel 7/7 vitest. **DEPLOY-TIME**: run
  `tsx scripts/backfill-program-offices.ts --commit` (after sync-peo-rosters) to populate offices/roles;
  schedule reconcile-person-role-staleness. Pre-existing fuzzy-search pagination total bug spawned as a
  separate task (out of scope).
- **Step 1.4 web "What changed" panel done** (myself, to avoid another agent timeout): web
  `getProgramElementDeltas` api + `ProgramElementDelta`/`ProgramElementDeltaListResponse` types;
  `WhatChangedPanel.tsx` (top-N materiality-scored deltas — type badge, FY tag, `$Xm → $Ym (±%)`,
  materiality score Tag banded ≥0.7 red / ≥0.4 orange; honest empty state; Array.isArray guard) +
  `materialityColor` export; lazy-wired into `ProgramElementWatchPage` (deltasQuery, Suspense block
  after Programs). Tests: WhatChangedPanel render + max-cap + empty-state + materialityColor bands
  (4 vitest). Verified: web typecheck clean; new panel 4/4 + ProgramElementWatchPage 3/3 vitest green.
