# Defense Budget Intelligence Module — Gap Analysis & Execution Plan

Date: 2026-06-07. Prepared against the "PE as spine of the defense-lobbying graph" target
architecture and its 29-section success criteria. Every claim below was verified against the
codebase at `main` (last commit `04e8fea`); file paths are cited so each item is checkable.

How to use this document: Section 3 is the gap table. Section 4 is the execution plan — each
step has a copy-pasteable agent prompt and verifiable success criteria. Paste the **Shared
Context Preamble** (§4.0) at the top of every agent prompt.

---

## 1. Executive summary

The codebase is **much further along on "budget truth" than the target plan assumes, and much
further behind on the graph and action layers.**

What is genuinely strong today:

- Deterministic, page-provenance-preserving ingestion of R-1, R-2/R-2A (all services, FY2027),
  R-3 named primes, HASC/SASC marks, NDAA conference, with committed offline extraction
  artifacts (`apps/api/scripts/__data__/`, `__tools__/*.py` pdfplumber) — no LLM in the
  extraction path. This matches the plan's "most important design principle."
- Per-field, per-source value log (`ProgramElementYearSourceValue`) + source priority +
  cross-source conflict review queue (`ReconciliationReviewQueue`) + rebuild-from-log
  (`rebuild-program-element-years.ts`).
- Review-gated entity resolution discipline already exists where it matters most: PE↔person
  candidates are **never auto-applied** (`ProgramElementPersonCandidate`), personnel merge
  candidates and quarantine tables exist, and the curated MDAP→PE map
  (`ProgramElementAcquisitionProgram`) is explicit and auditable.
- A typed budget-change emitter already runs in the writer: `pe_mark_added | pe_mark_changed |
  pe_value_increased | pe_value_decreased | pe_milestone_slip` with %-based severity, scoped to
  tenants via watches and `ClientCapability.peNumber`
  (`program-element-writer.service.ts:608-719`).
- A real PE profile UI exists (KPIs, FY chart with all four marks, per-field source attribution
  drawer, R-3 primes with page citations, bills panel, program team, markup monitor).

The five structural gaps that block the target product:

1. **No budget-cycle dimension.** `ProgramElementYear` is one row per (peCode, fy) with stage
   columns. PB vs prior-PB comparison, FYDP outyears, and "position by cycle" are impossible in
   the current shape. This is the single most important schema gap.
2. **No Program / ProgramAlias / ProgramOffice / PersonRole entities.** People link to PEs via
   `pePrimary` (review-gated, but still the PE→Person shortcut the plan forbids); organizations
   are free text; there is no canonical program graph and no alias table.
3. **The R-2A is only shallowly extracted.** Projects (code/title/mission/page) are captured —
   but accomplishments/planned programs, change summaries, and the **Other Program Funding
   Summary** (the PE→P-1 bridge) are not. P-1/procurement ingestion is parser-complete but has
   zero data. Projects/sources are in the DB but not surfaced by the PE detail API or UI.
4. **No action layer.** Change events land in a Changes Inbox; there is no materiality engine,
   no ActionRecommendation entity (audience/deadline/owner/proof/uncertainty/status), no
   artifact generation bound to source evidence, no SAM opportunities at all (only SAM
   personnel), no report-language capture, no coverage-gap output, no contact-use guardrails.
5. **Operational drift.** PE budget-cycle jobs are seasonal/manual by design (correct), but the
   schedule matrix admits a LIVE-DRIFT warning on derived jobs; HAC-D/SAC-D and enacted
   (public-law) artifacts are absent (`__data__/` has HASC FY26/27, SASC FY26, conference FY26
   only); there is no source checksum/document registry; reconciliation UI is read-only.

Order of attack: finish PE truth (Phase 0–1), then build the program/people graph (Phase 2),
then the action layer (Phase 3), then verification/launch (Phase 4). This mirrors the plan's
MVP1→2→3 and avoids the plan's named mistake — we do **not** start with people.

---

## 2. Verified current state by layer

### Layer 1 — Budget source layer: PARTIAL (strongest layer)

| Source | Status | Evidence |
|---|---|---|
| R-1 master (FY2027) | ✅ Ingested, page provenance | `scripts/sync-comptroller-jbooks.ts`, `__tools__/extract_jbook_r1.py`, `__data__/jbook_r1_fy2027.json` |
| R-2/R-2A (all services FY2027) | ✅ Missions + projects + pages; ❌ no accomplishments/change-summary/other-program-funding | `scripts/sync-jbook-r2.ts`, `__tools__/extract_jbook_r2.py` (greps for "Change Summary"/"Other Program Funding"/accomplishments: zero hits) |
| R-3 performers | ✅ Named primes w/ page cites | `ProgramElementPerformer`, `__data__/jbook_performers_*.json` (20+ files) |
| HASC / SASC marks | ✅ HASC FY26+FY27, SASC FY26; ❌ SASC FY27 pending publication | `__data__/armed_services_*.json`, `parsers/armed-services-report-parser.service.ts` |
| HAC-D / SAC-D marks | ⚠️ Parser exists, **no artifacts committed** | `parsers/defense-approps-report-parser.service.ts`; no `__data__` files |
| Conference / enacted | ⚠️ Conference FY26 only; public-law parser exists, **no artifact** | `__data__/ndaa_conference_fy2026.json`, `scripts/parse-defense-approps-public-law.ts` |
| P-1 / P-doc procurement | ❌ Parser + extractor exist, URLs = `PASTE_URL_HERE`, zero data | `parsers/pdoc/`, `__tools__/extract_pdoc.py`, `__config__/comptroller-document-urls.yaml` |
| Prior-year PB books | ❌ Not ingested; no cycle dimension to store them | — |
| USAspending awards | ✅ Daily sync + TAS/PA + district enrichment + MDAP attribution | `scripts/sync-federal-award.ts`, `enrich-award-pe-tas.ts`, `FederalAward` model |
| SAM.gov | ⚠️ Personnel (COs) only; **no opportunities** | `scripts/sync-sam-personnel.ts`; no `SamOpportunity` model anywhere |
| Bill text / GovInfo | ✅ Cached, PE-code regex extraction | `BillText`, `extract-bill-pe-codes.ts`, `external/govinfo/` |
| Report language | ❌ Not stored at all | repo-wide grep "reportLanguage": zero hits |
| Source checksums / document registry | ❌ None (dedup is by natural keys only) | repo-wide grep checksum/sha256: zero hits in ingestion |

### Layer 2 — PE/project normalization: PARTIAL

- ✅ Canonical PE registry (`ProgramElement`, soft-retire via `retiredAt`), unit normalization,
  rebuild-from-log, `pg_trgm` matching, embeddings (`embed-program-elements.ts`).
- ✅ Projects are first-class (`ProgramElementProject`) — **but not returned by
  `getProgramElement` / any PE endpoint, and not rendered anywhere in the web app**
  (only consumer: `acquisition-personnel-read.service.ts`).
- ❌ No alias management (PE titles, program names, acronyms).
- ❌ No PE version history (rename/split/merge/transfer continuity).
- ❌ No FYDP/outyears; single-FY values only.

### Layer 3 — Diff/change layer: PARTIAL

- ✅ Writer emits typed change events w/ severity (>25% critical, >10% notable) to affected
  tenants (watches ∪ capability.peNumber) — `program-element-writer.service.ts:685-719`.
- ✅ Cross-source conflict detection + review queue (>10% non-enacted; ANY enacted delta).
- ✅ Markup monitor UI (marks vs request divergence) and conference-probability model with
  FY24/25 backtest (`models/conference-probability.*`).
- ❌ No PB vs prior PB (blocked by missing cycle dimension), no new-start/termination/transfer
  detection, no quantity/unit-cost movement (no P-1 data), no outyear deltas, no materiality
  engine beyond raw %-thresholds, no deadline/urgency dimension.

### Layer 4 — Entity graph: WEAK (the core gap)

- ✅ `AcquisitionPersonnel` + sources + quarantine + merge queue + staleness/supersede +
  review-gated PE-person matcher (3 signals, service-aware; `matching/pe-person-matcher.service.ts`).
- ✅ Curated MDAP→PE bridge (`ProgramElementAcquisitionProgram`, `seed-acq-program-map.ts`) and
  R-3 performer→award UEI confirmation (`enrich-award-pe-tas.ts`).
- ✅ PEO/CPE rosters loaded as people with org strings + `programOfRecord`
  (`sync-peo-rosters.ts` — explicitly "does NOT set pe_primary").
- ❌ No `Program`, `ProgramAlias`, `ProgramOffice`, `PersonRole` entities. Organization is free
  text. The plan's required chain (PE → Project → Program → Office → PersonRole) cannot be
  represented.
- ❌ No contact-use classification (lobbying contact / procurement POC / context-only).
- ⚠️ Client relevance: `ClientCapability` has `peNumber` (single PE), tags, sector,
  `districtNexus` free text, funding ask — but no structured NAICS/PSC/UEI/CAGE, no
  `ClientFacility` entity, no multi-path relevance scoring. `ClientIntelMapping` covers
  LDA/FEC/contracting entity resolution with auto-confirm rules (`entity-resolution.service.ts`).
- ✅ District nexus from award place-of-performance (`popState`/`popCongressionalDistrict`).

### Layer 5 — Action layer: WEAK

- ✅ Changes Inbox + portfolio alerts + acknowledge/dismiss/snooze (`AlertState`), ClientBrief
  promotion, LLM daily brief with `suggestedActions[]`, Clio agent with PE tools
  (`search_program_elements`, `get_pe_budget_timeline`, `get_pe_contractors`, `get_pe_bills`),
  workflows with AI-fill + `generate-document`.
- ❌ No ActionRecommendation entity, no action board, no owner/due-date/status on actions, no
  dismissal-reason capture, no district one-pager generator, no committee-staff memo generator
  bound to PE evidence, no relationship-coverage-gap output, no proof-pack UI (provenance rows
  exist but `ProgramElementSource` is never surfaced), no compliance guardrail badges.

### UI surfaces vs plan §12

| Plan surface | Status |
|---|---|
| 12.1 Defense Budget Overview | ⚠️ Partial: Markup Monitor + Changes Inbox exist; no materiality-gated overview w/ client/stage filters + confidence badges |
| 12.2 PE Profile | ⚠️ Strong core; missing: Projects, What-changed, Congressional activity (report language), Program matches, proof pack, uncertainty panel, recommended actions |
| 12.3 People & Programs panel | ⚠️ Program team panel exists (confidence bands, sources drawer, CRM link); missing program candidates, guardrails, "why shown", freshness badge |
| 12.4 Action Board | ❌ Missing entirely |
| 12.5 Analyst Review Queue | ⚠️ Person-candidates page + personnel merge tab exist; reconciliation page is **read-only** (no resolve actions); no quarantine UI, no alias manager, no unified console, no audit-log view |

---

## 3. Gap table (plan requirement → disposition)

Legend: ✅ done · 🟡 partial · ❌ missing · ➕ covered by plan step (§4)

| # | Plan requirement (section) | Status | Plan step |
|---|---|---|---|
| 1 | R-1/R-2/R-2A ingestion w/ provenance (§4.1) | ✅/🟡 | 1.5 deepens R-2A |
| 2 | P-1 ingestion (§4.1) | ❌ | 1.1 |
| 3 | Prior-PB ingestion + comparison (§4.1, §6) | ❌ | 1.3 |
| 4 | HAC-D/SAC-D/enacted coverage (§4.1) | 🟡 | 0.3 |
| 5 | Checksum/duplicate-source detection, version tracking (§4.2) | ❌ | 0.1 |
| 6 | Reconciliation ≥98% + analyst resolution (§4.2, §23) | 🟡 | 0.2 |
| 7 | Provenance fields incl. extraction method, review status (§4.3) | 🟡 | 0.1, 1.2 |
| 8 | PE→Project→Program→Office→PersonRole model (§5, §14) | ❌ | 2.1, 2.2 |
| 9 | PE versioning / cross-year continuity / aliases (§5) | ❌ | 2.1 (aliases), 4.1 backlog (continuity) |
| 10 | Other-funding linkage (§5, §7) | ❌ | 1.5 |
| 11 | Delta types: new start, termination, transfer, outyear, quantity (§6) | ❌ | 1.4 |
| 12 | Materiality scoring + Needs Attention gating (§6) | ❌ | 1.4, 3.2 |
| 13 | PE↔program evidence-tiered confidence + quarantine thresholds (§7) | ❌ | 2.1 |
| 14 | Person-role model + contact-use classification + guardrails (§8, §9, §17) | ❌ | 2.2 |
| 15 | Client inputs: UEI/CAGE/NAICS/PSC, facilities, competitors (§9, §13) | 🟡 | 2.3 |
| 16 | Client relevance scoring, multi-path (§9) | 🟡 | 2.3 |
| 17 | Action types + action cards (§10) | ❌ | 3.2 |
| 18 | Proof pack UI + claim→evidence drill-down (§11) | 🟡 data exists | 1.2 |
| 19 | Report language capture + linkage (§4.1, §8 of arch) | ❌ | 2.4 |
| 20 | SAM opportunities linkage (§16) | ❌ | 3.1 |
| 21 | Award/competitor/district context (§16) | ✅/🟡 | 2.3 consumes |
| 22 | Compliance guardrails (§17) | ❌ | 2.2, 3.2 |
| 23 | Draft artifacts: one-pager, memos, talking points (§15, §18) | 🟡 generic only | 3.3 |
| 24 | Workflow states/owners/dismissal reasons (§19) | 🟡 | 3.2 |
| 25 | Search/exploration across graph (§20) | 🟡 flat search | 2.1, 3.5 |
| 26 | Analyst tooling: alias manager, audit log, confidence tuning (§23) | 🟡 | 3.5 |
| 27 | Accuracy targets + review SLAs measurement (§22) | ❌ | 4.1 |
| 28 | End-to-end acceptance test (§27) | ❌ | 4.2 |
| 29 | Relationship coverage gaps (§14) | ❌ | 3.4 |

Corrections to assumptions worth recording (things that looked missing but exist): budget-delta
→ change-event emission (writer), review-gated person matching, MDAP→PE curated bridge, district
attribution on awards, conference-probability model w/ backtest, R-2A projects in DB,
page-provenance rows for R-1/R-2/R-3.

---

## 4. Execution plan

Phases are dependency-ordered. Within a phase, steps marked ∥ can run in parallel. Each step
lists: objective, the agent prompt (paste the preamble first), and success criteria. Estimated
sizes assume one focused agent session per step.

```text
Phase 0  (hardening)        0.1 ∥ 0.2 ∥ 0.3 ∥ 0.4
Phase 1  (PE truth)         1.1 ∥ 1.2 → 1.3 → 1.4 ; 1.5 after 1.1
Phase 2  (graph)            2.1 → 2.2 ; 2.3 ∥ 2.4 after 2.1
Phase 3  (action layer)     3.1 ∥ 3.4 ; 3.2 after 1.4+2.x ; 3.3 after 3.2 ; 3.5 after 2.x
Phase 4  (launch)           4.1 → 4.2
```

### 4.0 Shared Context Preamble (paste at the top of EVERY agent prompt)

```text
CONTEXT — Capiro monorepo (pnpm + turbo). API: NestJS + Prisma + Postgres (RLS multitenancy)
in apps/api; web: Vite + React + AntD in apps/web; infra: AWS CDK in infra/cdk.

Hard conventions you MUST follow:
1. Public-domain federal data lives in GLOBAL tables: no tenant_id, no RLS (see
   ProgramElement, FederalAward in apps/api/prisma/schema.prisma). Tenant-scoped data always
   has tenant_id + RLS and is queried via this.prisma.withTenant(tenantId, tx => ...).
2. Migrations: apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>/migration.sql,
   additive and reversible; never destructive to existing rows. Update schema.prisma to match.
3. PDF extraction is DETERMINISTIC and OFFLINE: python pdfplumber tools live in
   apps/api/scripts/__tools__/, their JSON outputs are committed to apps/api/scripts/__data__/,
   and TypeScript sync scripts (apps/api/scripts/sync-*.ts / parse-*.ts) load artifacts into
   the DB. NO PDF parsing and NO LLM calls at runtime or in the data path. Sync scripts are
   idempotent (upsert by natural key), default to DRY RUN, and take --commit.
4. Provenance: every material row carries source, sourceUrl, pageNumber where applicable,
   confidence, observed/synced timestamps. Follow ProgramElementSource conventions
   (deep link = `${sourceUrl}#page=${pageNumber}`).
5. Entity-resolution discipline: machine matches go to a review-queue table
   (status open|confirmed/accepted|rejected, resolvedByUserId, resolvedAt, decisionNotes) and
   are NEVER auto-applied unless the documented auto-accept rule is met. Mirror
   ProgramElementPersonCandidate / AcquisitionPersonnelMergeCandidate / ReconciliationReviewQueue.
6. Money convention: PE year values are stored in $ MILLIONS (see program-element-writer
   buildYearTitle comment). Normalize on ingest (normalize-units.ts).
7. Tests: jest in apps/api (pnpm --filter @capiro/api test -- <paths>), vitest in apps/web
   (pnpm --filter @capiro/web test). Typecheck: pnpm --filter @capiro/api typecheck and
   --filter @capiro/web typecheck. New code ships with specs; do not break the existing suite
   (baseline: API 639+ green, web 89+ green). Match surrounding code style; do NOT run
   prettier across pre-existing files.
8. Key modules: apps/api/src/program-element (PE core), acquisition-personnel (people),
   intelligence (changes/alerts/briefs), clients (capabilities), federal-spending,
   external/govinfo, clio (agent runtime + tools). Web PE pages:
   apps/web/src/pages/program-element/*.
9. Before coding, READ the files you will modify and the closest analogous existing feature;
   copy its patterns (controller guards, DTO validation, query invalidation, AntD usage).
10. Deliverable hygiene: small reviewable diff, a docs/plans/ entry if you make design
    decisions, and a verification section in your final message: commands run + outputs.
```

---

### PHASE 0 — Pre-production hardening

#### Step 0.1 — Source-document registry with checksums

Objective: a `SourceDocument` table so every extracted row ties to a fingerprinted, versioned
source file (plan §4.2: 100% checksum duplicate detection, 100% version tracking; §4.3
provenance fields incl. extraction method).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Add a SourceDocument registry for defense-budget source files and wire existing
provenance to it.

1. Prisma migration adding model SourceDocument (global table, no RLS):
   id uuid pk; sourceKey text unique (stable human key, e.g. 'jbook_r1_fy2027' — derive from
   existing artifact/config naming); fiscalYear int; budgetCycle text
   ('pb'|'hasc'|'sasc'|'hac_d'|'sac_d'|'conference'|'enacted'|'supplemental');
   component text nullable (ARMY|NAVY|AF|SF|DW|...); documentType text
   ('r1'|'r2'|'p1'|'p40'|'committee_report'|'conference_report'|'public_law'|'other');
   title text; sourceUrl text; sha256 char(64) nullable; byteSize int nullable;
   pageCount int nullable; downloadedAt timestamptz nullable; artifactPath text nullable
   (path under scripts/__data__/); extractionMethod text
   ('structured_import'|'deterministic_pdf'|'manual'); extractionToolVersion text nullable;
   ingestedAt timestamptz; supersededByDocumentId uuid nullable (new version chain);
   metadata jsonb default '{}'. Index on (documentType, fiscalYear, budgetCycle, component).
2. Add nullable sourceDocumentId FK columns (additive) to: program_element_source,
   program_element_project, program_element_performer, program_element_year_source_value.
   Do NOT backfill destructively; write scripts/backfill-source-documents.ts that (a) creates
   one SourceDocument per committed artifact in scripts/__data__/ (compute sha256 of the
   artifact JSON; where the artifact embeds the source PDF URL, store it; fiscal year and
   cycle from the artifact/filename), and (b) links existing provenance rows by matching
   sourceUrl. Dry-run by default, --commit to write, prints a reconciliation table
   (rows linked / unlinked by table).
3. Extend the artifact-loading sync scripts (sync-comptroller-jbooks.ts, sync-jbook-r2.ts,
   sync-jbook-performers.ts, parse-hasc-sasc-reports.ts, parse-defense-approps-reports.ts,
   parse-ndaa-conference.ts, parse-defense-approps-public-law.ts) to upsert their
   SourceDocument first (sha256 of artifact; skip-and-log when an identical sha256 was already
   ingested for the same sourceKey) and stamp sourceDocumentId on rows they write.
4. Python extractors: add a small shared helper in __tools__ that emits, into every artifact
   JSON, a `_document` header: {source_url, sha256_of_pdf (when the PDF is local), page_count,
   extracted_at, tool, tool_version}. Update extract_jbook_r1.py minimally to demonstrate; do
   not regenerate committed artifacts.
5. Specs: registry upsert idempotency (same sha256 → no duplicate, returns existing);
   changed sha256 for same sourceKey → new row + supersededByDocumentId chain on the old one;
   backfill linker matches by sourceUrl.

SUCCESS CRITERIA (all must pass; show outputs):
- pnpm --filter @capiro/api typecheck green; full API jest suite green including new specs.
- prisma migrate dev runs clean on a fresh DB and on an existing dev DB (additive only).
- Running backfill-source-documents.ts --commit on a dev DB seeded with current artifacts
  creates ≥1 SourceDocument per __data__ budget artifact and links ≥95% of
  program_element_source rows (report printed; unlinked rows enumerated with reasons).
- Re-running any one sync script twice produces zero new SourceDocument rows the second time
  (checksum dedup proven in the run log).
```

#### Step 0.2 — Close the reconciliation loop (resolve actions + totals checks)

Objective: reconciliation queue becomes operable (plan §4.2 reconciliation ≥98%; §23 analyst
tools; UI §12.5), and extraction is validated against source totals.

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK A — Make the reconciliation review queue resolvable end-to-end.
Today GET /program-elements/admin/reconciliation-queue exists and the web page
apps/web/src/pages/admin/PeReconciliationPage.tsx renders rows but has NO resolve actions.
1. API: POST /program-elements/admin/reconciliation-queue/:id/resolve
   body {decision: 'keep_current'|'accept_conflicting'|'manual_value', manualValue?, notes?}.
   capiro_admin guard (copy the guard pattern from the existing admin endpoints).
   accept_conflicting/manual_value must write through the EXISTING writer path so
   ProgramElementYearSourceValue history and is_winner flags stay consistent
   (read apps/api/src/program-element/reconciliation/reconciliation.service.ts and
   program-element-writer.service.ts first; do not bypass them). Set status, resolvedByUserId,
   resolvedAt, resolutionNotes. Emit an AuditLog row (see existing AuditLog usage).
2. Web: add Resolve actions (keep / accept / manual entry w/ value input + notes) to
   PeReconciliationPage with optimistic update + invalidation, matching
   PersonCandidatesPage.tsx interaction patterns. Add a status filter (open|resolved).

TASK B — Extraction-totals reconciliation harness.
3. scripts/verify-budget-reconciliation.ts: for each (fiscalYear, budgetCycle, component)
   present in the DB, sum program_element_year values by field and compare against control
   totals. Control totals come from a new committed file
   scripts/__data__/control_totals.json — seed it for FY2027 PB by summing the R-1 artifact
   itself (document this provenance in the file) with room for hand-entered totals from the
   R-1 summary page later. Output: table of |extracted − control| with PASS at ≤0.5% (rounding
   tolerance) per group, exit code 1 on any FAIL, and a --json flag for CI use.
4. Wire it into scripts/preflight-ingestion.ts (read it first) so PE loads fail loudly when
   reconciliation breaks.

SUCCESS CRITERIA:
- API + web typecheck and test suites green; new specs cover: resolve transitions (each
  decision), writer-path consistency (accepting a conflict flips is_winner and updates the
  canonical year row), and authz (non-capiro_admin → 403).
- On dev data: resolving an open entry updates the PE year value visibly via
  GET /program-elements/:peCode/timeline (show before/after).
- verify-budget-reconciliation.ts on dev DB: FY2027 PB groups all PASS ≤0.5%; intentionally
  corrupting one year row (in a test or scratch DB) flips it to FAIL exit 1 (demonstrate).
- PeReconciliationPage screenshot or DOM dump showing resolve controls + status filter.
```

#### Step 0.3 — Complete mark/enacted coverage for FY2026–27 ∥

Objective: fill HAC-D, SAC-D, and enacted gaps so the stage ladder PB→HASC/SASC→HAC-D/SAC-D→
conference→enacted is fully populated where documents exist (plan §4.1).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Produce and load committee-appropriations and enacted artifacts.
Parsers already exist (defense-approps-report-parser.service.ts,
parse-defense-approps-public-law.ts, conference parser). What is missing is DATA.

1. Locate the official documents: FY2026 HAC-D report, FY2026 SAC-D report (congress.gov /
   govinfo, committee report numbers for the FY26 DoD appropriations act), the FY2026 enacted
   DoD appropriations act (public law) PE tables, and — if published — FY2027 HAC-D/SAC-D and
   SASC FY2027. Record exact citations + URLs.
2. Download PDFs locally; run/extend __tools__/extract_armed_services_report.py-style
   extraction (there may already be an approps-specific extractor — check __tools__ first;
   extend rather than fork). Emit committed artifacts following existing naming
   (e.g. defense_approps_hac_d_fy2026.json) including the _document header from step 0.1 if
   merged, else source_url+pages per row.
3. Run the existing parse scripts in dry-run, eyeball the reported row counts and a sample of
   20 random PEs against the PDF pages, then --commit.
4. For any document that does not exist yet (e.g. FY27 SASC not filed), write that finding
   into docs/runbooks/budget-cycle-coverage.md with a coverage matrix (FY × stage × status ×
   artifact path) and the procedure + extraction command to fill each upcoming gap during the
   FY27 cycle (who runs what, when, with which tool).

SUCCESS CRITERIA:
- New artifacts committed; loaders run clean with --commit; SyncRun rows recorded.
- SELECT count(*) of program_element_year rows with non-null hac_d_mark (FY2026) > 500 and
  sac_d_mark (FY2026) > 500 (defense approps tables are dense; if materially lower, explain
  with evidence from the document structure).
- 20-PE random spot-check table included in your report: artifact value vs PDF page value,
  100% match (list any mismatch + root cause + fix).
- enacted (FY2026) populated for the same scope; per-PE stage ladder visible in
  GET /program-elements/:peCode/timeline for 3 sample PEs (show JSON).
- docs/runbooks/budget-cycle-coverage.md committed with complete FY26/FY27 matrix.
- verify-budget-reconciliation.ts (from 0.2) still PASS after loads.
```

#### Step 0.4 — Ingestion scheduling truth-up ∥

Objective: eliminate the LIVE-DRIFT (derived jobs without live EventBridge rules) and gate
seasonal PE jobs properly (plan §21 nightly ingestion; §25 GA "repeatable and monitored").

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Reconcile the declared ingestion schedule with what is actually deployed.

1. Read docs/plans/2026-06-01-production-ingestion-scheduling-schedule-matrix.md and
   infra/cdk/lib/ingestion-schedule.ts, including the LIVE-DRIFT comment block. Produce a
   drift table: job → declared cadence → CDK rule present? → IAM role valid (ecs:RunTask +
   iam:PassRole)? → last SyncRun in dev/prod (query the sync_run table via a small
   scripts/diag-schedule-drift.ts you write; pattern: scripts/diag-ingestion-health.ts).
2. Fix the CDK so every TIER 1–3 job in the matrix has a working EventBridge→ECS rule with a
   correct events role; remove or rename orphan rules (the legacy capiro-dev-emit-changes-daily
   orphan is called out in the code — handle it explicitly).
3. Add CloudWatch alarms per the existing RUNBOOK
   (apps/api/src/program-element/RUNBOOK.md): error_count, stale-sync, hung-duration for the
   PE-relevant jobs at minimum.
4. Seasonal (TIER 4) PE jobs must NOT get blind cron: implement the "gate on artifact
   availability" pattern — a weekly check job (or preflight extension) that alerts when a new
   budget document is expected (per docs/runbooks/budget-cycle-coverage.md) but no artifact is
   committed.
5. Update the schedule-matrix doc to match deployed reality, and extend
   docs/runbooks/out-of-band-ingestion-deploy.md with the new procedure.

SUCCESS CRITERIA:
- cdk diff (env=dev) output included and reviewed: every TIER 1–3 job has a rule + valid role;
  cdk synth green. No orphan/dead rules remain (list them as removed).
- scripts/diag-schedule-drift.ts committed; its post-fix run shows zero drift rows in dev.
- Alarms visible in synthesized template (grep the synth output; include snippet).
- Docs updated; drift table included in your final report.
- API/web suites untouched and green.
```

---

### PHASE 1 — PE truth completion (closes plan MVP 1)

#### Step 1.1 — P-1 procurement ingestion ∥

Objective: procurement master lines land with provenance (plan §4.1 P-1 required for MVP;
enables quantity/unit-cost deltas §6 and the RDT&E→procurement bridge §7).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Stand up P-1 (procurement master) ingestion end-to-end for FY2027 PB.

Existing assets to read first: apps/api/src/program-element/parsers/pdoc/ (pdoc-parser.service.ts,
pdoc-line-extractor.service.ts + spec), __tools__/extract_pdoc.py,
scripts/parse-pdoc-army.ts, __config__/comptroller-document-urls.yaml (P-1 URL present;
service P-doc volumes say PASTE_URL_HERE).

1. Resolve the real FY2027 P-1 document: prefer the machine-readable XLSX P-1 from the DoD
   Comptroller budget-materials page over PDF (design principle: structured > PDF). If XLSX is
   available, write __tools__/extract_p1_xlsx.py (openpyxl, deterministic) emitting an
   artifact with: appropriation account, budget activity, line number, item nomenclature,
   ID code, PE-style line item code where present, FY values (prior/current/BY1 incl. quantity
   and cost columns as the P-1 provides), page/sheet refs. Else use extract_pdoc.py on the
   P-1 PDF. Fill in the YAML config URLs you used.
2. Commit artifact(s) (p1_fy2027*.json). Extend/author scripts/sync-p1.ts following the
   sync-comptroller-jbooks.ts pattern: upsert ProgramElement rows for procurement lines ONLY
   when they carry true PE-style codes; otherwise write ProgramElementProcurementLine rows
   (model exists) keyed naturally, with dollars in $M, quantity, unitCost, sourceUrl + page,
   and SourceDocument linkage (step 0.1). Do not invent PE codes for procurement-only lines.
3. Make sure the markup monitor and PE list endpoints don't break with appropriationType
   'PROC' rows (read listProgramElements filters; adjust tests).
4. Specs: parser fixtures (real sampled rows), idempotent re-run, unit normalization,
   quantity/unit-cost extraction.

SUCCESS CRITERIA:
- Artifacts committed; sync-p1.ts dry-run prints expected row counts; --commit loads them;
  re-run is a no-op (proven in log).
- ≥90% of P-1 lines for the chosen volumes load with non-null dollars; quantity present where
  the source shows quantity (sample 15 lines vs source, 100% match, table in report).
- program_element_procurement_line populated (show count by component) with page-level
  provenance on every row.
- verify-budget-reconciliation.ts extended with a P-1 control group and PASS.
- API typecheck + jest green including new specs.
```

#### Step 1.2 — Surface projects + proof pack (API + UI) ∥

Objective: R-2A projects and page-level citations become user-visible; every PE claim gains a
"show me the source" affordance (plan §5 project decomposition; §11 proof pack; §12.2).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Expose ProgramElementProject and ProgramElementSource through the PE API and UI.

Facts: both tables are populated (R-2A FY2027) but getProgramElement returns only the base row
+ years + billCount (program-element-read.service.ts:218-283), and nothing in apps/web renders
projects or sources.

1. API:
   - GET /program-elements/:peCode/projects → projects ordered by projectCode with title,
     mission, budgetActivity, fy, sourceUrl, pageNumber, confidence.
   - GET /program-elements/:peCode/sources → grouped citations: {docType, exhibitType, fy,
     sourceUrl, pageNumber, pageEnd, snippet, publisher, sourceDocument {title, budgetCycle,
     sha256?}}. Order: R-1, R-2, R-2A, P-1, committee, conference, law.
   - Extend the detail payload with projectCount + sourceCount (cheap counts, keep the
     existing detailCache semantics — read how it caches and how watch state is layered on).
2. Web (apps/web/src/pages/program-element/):
   - New ProjectsPanel: project code, title, mission (collapsible), FY tag, and a source chip
     per project deep-linking `${sourceUrl}#page=${pageNumber}` in a new tab. Place it above
     the contractors panel; lazy-load like the other panels.
   - New ProofPackPanel ("Sources & evidence"): the grouped citations list; each row = doc
     badge (R-1/R-2/R-2A/...), FY, publisher, page(s), snippet (expandable), open-at-page
     link. Also fix ContractorsPanel named-prime links to append #page= (audit found the
     fragment is not constructed there).
   - FyDetailDrawer: where a field's source attribution matches a known ProgramElementSource /
     SourceDocument, render the open-at-page link beside the source label.
3. Empty-state copy must be honest (e.g. "No R-2A projects extracted for this PE - this PE may
   be procurement-only or pre-FY27").
4. Tests: API specs for both endpoints (existing read-service spec patterns); web vitest for
   panel rendering incl. deep-link construction.

SUCCESS CRITERIA:
- For a known project-rich PE (pick one from program_element_project, e.g. an 0602xxx PE with
  ≥3 projects), GET .../projects returns them all with page numbers (show JSON).
- UI renders Projects + Proof pack on that PE; deep links contain #page=<n>; show DOM snippet
  or screenshot.
- PE with zero projects shows the honest empty state, not an error.
- API jest + web vitest green; typechecks green; no regression in ProgramElementWatchPage
  load (panels remain lazy).
```

#### Step 1.3 — Budget-cycle (PB position) dimension + FYDP outyears

Objective: store every (PE, FY, value) per budget cycle so PB vs prior-PB and outyear deltas
become computable (plan §4.1 prior-year books REQUIRED; §6 outyear change; §5 confidence
separation). This is the keystone schema change — do it before the delta engine.

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Introduce a budget-position model with cycle + outyears, without breaking the existing
ProgramElementYear consumers.

Design (additive; ProgramElementYear remains the "current consolidated stage ladder" the UI
uses today):
1. Migration: model ProgramElementBudgetPosition (global): id; peCode FK; positionCycle text —
   the book/stage that asserts the values ('pb_fy2026'|'pb_fy2027'|'hasc_fy2027'|...|
   'enacted_fy2026'); assertedFy int — the fiscal year the dollars are FOR; amount
   decimal(14,2) $M; quantity decimal nullable; valueKind text ('total'|'quantity'|'unit_cost');
   sourceDocumentId FK nullable; sourceUrl/pageNumber nullable; createdAt. Unique
   (peCode, positionCycle, assertedFy, valueKind). Indexes on (peCode, assertedFy) and
   (positionCycle).
   This single shape stores: FY27 PB's FY27 request AND FY27 PB's FY28-31 outyears AND FY26
   PB's FY27 projection — which is exactly what PB-vs-prior-PB needs.
2. Extractor: extend __tools__/extract_jbook_r1.py (and the R-2 funding-table path in
   extract_jbook_r2.py if present) to capture ALL fiscal-year columns the exhibit prints
   (PY/CY/BY1/BY2..BY5 i.e. FYDP outyears), not only the budget year. Regenerate the FY2027
   R-1 artifact (commit alongside, do not delete the old one; bump artifact version in
   filename or _document header).
3. Loader: extend sync-comptroller-jbooks.ts to write BudgetPosition rows
   (positionCycle='pb_fy2027', assertedFy=each column year). Keep existing
   ProgramElementYear behavior untouched.
4. Prior PB: locate the FY2026 PB R-1 (machine-readable XLSX if available — prefer it), build
   its artifact, load as positionCycle='pb_fy2026'. This is the one PRIOR-year book required
   for MVP comparison.
5. Read API: GET /program-elements/:peCode/positions?fy=<assertedFy> → list of
   {positionCycle, amount, quantity, sourceUrl, pageNumber}; and
   GET /program-elements/:peCode/pb-comparison → for each assertedFy present in ≥2 PB cycles:
   {assertedFy, pbCurrent, pbPrior, deltaAbs, deltaPct}.
6. Specs: position upsert idempotency; pb-comparison math incl. null/zero handling (a PE absent
   from prior PB → flagged 'new_in_pb', present-then-absent → 'dropped_from_pb' — return these
   as flags, the delta engine in step 1.4 consumes them).

SUCCESS CRITERIA:
- Migrations clean on fresh + existing dev DB; API suite green.
- FY2027 PB outyears loaded: for a sampled PE, positions show BY1..BY5 with amounts matching
  the R-1 PDF page (5-PE spot-check table in report, 100% match).
- FY2026 PB loaded; GET .../pb-comparison returns sane deltas for ≥80% of PEs present in both
  books; new_in_pb / dropped_from_pb flags demonstrably correct for 3 known examples each
  (list the PEs and the evidence).
- verify-budget-reconciliation.ts extended to reconcile each loaded position cycle to its
  control total; PASS.
- Existing PE profile UI unchanged and green (no consumer of ProgramElementYear regressed).
```

#### Step 1.4 — Typed budget-delta engine + materiality scoring

Objective: turn raw changes into classified, materiality-scored deltas (plan §6 full delta-type
table + materiality factors + alert threshold; the upgrade path from the writer's existing
emissions).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Build the BudgetDelta engine on top of existing data, replacing ad-hoc severity with
materiality scoring.

Existing behavior to study first: program-element-writer.service.ts emits pe_mark_added/
pe_mark_changed/pe_value_increased/pe_value_decreased/pe_milestone_slip with %-based severity
to tenants from watches ∪ ClientCapability.peNumber. Keep that emission path working.

1. Migration: model ProgramElementDelta (global): id; peCode; assertedFy; deltaType text —
   'pb_vs_prior_pb'|'mark_vs_request'|'mark_vs_mark'|'conference_vs_marks'|
   'enacted_vs_request'|'new_start'|'termination'|'zeroed'|'transfer_candidate'|
   'quantity_change'|'unit_cost_change'|'outyear_shift'|'project_level_change';
   fromRef/toRef text (positionCycle or field names); amountFrom/amountTo/deltaAbs/deltaPct
   decimals; explanation text nullable (from R-2 change summaries when step 1.5 lands);
   evidence jsonb (source rows/pages used); materialityScore float; materialityFactors jsonb
   (per-factor contributions); computedAt; supersededAt nullable. Unique on
   (peCode, assertedFy, deltaType, fromRef, toRef) latest-wins via supersededAt.
2. service program-element/deltas/delta-engine.service.ts + scripts/compute-budget-deltas.ts
   (idempotent, --commit, --fy filter): computes all delta types from ProgramElementYear,
   ProgramElementBudgetPosition, and ProgramElementProcurementLine.
   Definitions (write these into the service doc comment):
   - new_start: PE/project absent from prior PB AND prior FY years, present now.
   - termination/zeroed: present prior, absent or 0 across BY+outyears now.
   - transfer_candidate: termination in one PE + new_start in another within same component
     AND (title trigram ≥0.6 OR same project title) — mark as CANDIDATE only, never asserted.
   - outyear_shift: |ΔFYDP total| ≥ max($20M, 15%) between PB cycles.
   - quantity/unit_cost: from P-1 lines across cycles (when both loaded).
3. Materiality scoring (0-1): weighted factors — dollarMagnitude (log-scaled), pctMagnitude,
   stageSignificance (enacted>conference>marks>pb), clientRelevance (any tenant has
   capability.peNumber or watch on the PE — computed per-tenant at read time, NOT stored
   globally), deadlineProximity (placeholder hook until step 3.x wires real calendars),
   unusualPattern (new_start/termination/transfer_candidate boost). Make weights a config
   object with documented defaults; unit-test the scorer with table-driven cases.
4. Rewire writer emissions: keep changeTypes, but severity now derives from materialityScore
   thresholds (≥0.7 critical, ≥0.4 notable) — preserve the old behavior for fields where no
   delta row exists yet. Emit one IntelligenceChange per NEW material delta (score ≥0.4) with
   data containing deltaId + evidence refs; idempotent (no re-emission on recompute without
   change).
5. API: GET /program-elements/:peCode/deltas (paginated, filter by deltaType/fy) and
   GET /program-elements/deltas/needs-attention?minScore=0.4&fy= for the future overview
   surface. Add to the existing controller respecting its guard/caching patterns.
6. Web (minimal this step): add a "What changed" section to the PE profile listing the top 5
   deltas (type badge, from→to, $ and %, evidence chip linking to proof pack rows).

SUCCESS CRITERIA:
- compute-budget-deltas.ts on dev data produces: pb_vs_prior_pb rows for PEs in both books;
  ≥3 verified new_start and ≥3 verified termination/zeroed examples with evidence
  (list them; verify against the books); transfer candidates ONLY as candidates.
- Table-driven scorer spec green: monotonicity (more $ → ≥ score), stage ordering, boosts.
- Re-running the engine without data changes emits zero new IntelligenceChange rows (idempotency
  proven in log).
- Needs-attention endpoint returns deltas sorted by materialityScore; a PE with a known big
  FY27 mark divergence appears above small-noise PEs (show JSON).
- PE profile shows the "What changed" section (DOM/screenshot evidence).
- API + web suites green.
```

#### Step 1.5 — R-2A deep extraction: change summaries, accomplishments, Other Program Funding

Objective: capture the narrative and the PE↔procurement bridge the FMR mandates (plan layer-A
"first program bridge"; §5 other-funding linkage; feeds delta explanations and §7 evidence).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Deepen extract_jbook_r2.py to capture three R-2/R-2A sections it currently skips, and
model them.

Current extractor gets: PE mission narratives + project code/title/mission + pages. Missing:
(a) "Change Summary Explanation" / FY change narrative, (b) "Accomplishments/Planned Programs"
per project, (c) "Other Program Funding Summary" tables (related P-1/R-1 line references).

1. Extend __tools__/extract_jbook_r2.py deterministically (pdfplumber text + table heuristics;
   study how the existing project segmentation works and extend in the same style). Emit per-PE:
   change_summary {text, page}, per-project accomplishments [{fy, title, text, page}], and
   other_program_funding [{line_item_code, line_title, appropriation, related_pe_or_line_no,
   fy_values?, page}]. Regenerate ONE service's artifact first (Army) to validate; then the
   rest. Keep old artifact files; version via filename or _document header.
2. Migrations:
   - ProgramElementProject: add columns accomplishmentsJsonb (default '[]'),
     changeSummary text nullable, changeSummaryPage int nullable.
   - New model ProgramElementOtherFunding (global): id; peCode; projectCode nullable;
     relatedLineCode text; relatedLineTitle text; relatedAppropriation text;
     relatedPeCode varchar(16) nullable (when the reference IS a PE);
     relatedProcurementLineId uuid nullable (resolve to program_element_procurement_line
     when P-1 from step 1.1 contains it — resolver in the loader, exact line-number+account
     match only, no fuzz); sourceUrl/pageNumber; sourceDocumentId; confidence. Unique
     (peCode, projectCode, relatedLineCode, relatedAppropriation).
3. Loader: extend sync-jbook-r2.ts to upsert the new fields/rows. Resolution stats printed:
   how many other-funding refs resolved to loaded P-1 lines vs stored unresolved.
4. API/UI: projects endpoint (step 1.2) now includes accomplishments + changeSummary;
   ProofPack gains the other-funding rows under a "Related funding lines" group with an
   explanatory caption ("As stated in the PE's own R-2A Other Program Funding Summary").
   Delta engine (step 1.4): when a delta exists for (peCode, fy) and changeSummary mentions
   that FY, attach it as `explanation` (exact-section copy, never generated).
5. Specs: extractor fixtures from 2-3 real R-2A pages (commit small fixture excerpts as the
   existing parser fixtures do); loader idempotency; resolver exact-match behavior.

SUCCESS CRITERIA:
- Regenerated artifacts committed for all services; loader --commit clean; re-run no-op.
- For 5 sampled PEs with known Other Program Funding tables (cite PDF pages), DB rows match
  the table contents 100% (table in report).
- ≥60% of other-funding refs that name P-1 lines resolve to loaded P-1 rows (report the
  number; if lower, show why with examples — unresolved is acceptable, misresolved is not:
  0 tolerated).
- A delta row now carries a non-null explanation copied from a change-summary (show one).
- API + web suites green; proof pack shows the new group.
```

---

### PHASE 2 — Program graph & people roles (closes plan MVP 2)

#### Step 2.1 — Program, ProgramAlias, PEProgramMatch (evidence-tiered)

Objective: the canonical Program entity + alias dictionary + review-gated PE/project→program
matching with the plan's confidence tiers (§7 evidence table + thresholds; §13 matching
objects).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Introduce the Program graph spine.

1. Migrations (global tables):
   - Program: id; canonicalName; component nullable; capabilityArea nullable; acquisitionPathway
     nullable; mdapCode nullable (from ProgramElementAcquisitionProgram seed); description;
     status; metadata jsonb; timestamps.
   - ProgramAlias: id; programId FK; alias; aliasNormalized (upper, punctuation-stripped);
     aliasType ('canonical'|'acronym'|'pe_title'|'project_title'|'p1_line_name'|'mdap_name'|
     'office_usage'|'congressional'|'sam_usage'|'award_usage'); source; sourceUrl nullable;
     confidence; timestamps. Unique (programId, aliasNormalized, aliasType). Trigram index on
     aliasNormalized.
   - PeProgramMatch: id; peCode; projectCode nullable; programId FK; score float;
     evidenceTier text ('exact_pe_number'|'exact_project_title'|'r2a_office_named'|
     'other_funding_link'|'official_office_page'|'sar_msar'|'sam_match'|'award_match'|
     'press_release'|'news_only'); evidence jsonb (each item: {kind, sourceUrl, pageNumber?,
     quote?}); status ('accepted'|'candidate'|'quarantined'|'rejected') — DEFAULT derived from
     score per plan thresholds: ≥0.90 auto-accept ONLY when evidenceTier is official+exact;
     0.70-0.89 candidate; 0.50-0.69 quarantined; <0.50 store as weak signal (status
     'quarantined', flag weakSignal=true, never surfaced); resolvedByUserId/resolvedAt/
     decisionNotes. Unique (peCode, coalesce(projectCode,''), programId).
2. Seeding script scripts/seed-programs.ts (idempotent, --commit):
   a. One Program per distinct MDAP code in program_element_acquisition_program
      (canonicalName=acqProgramName, mdapCode=code); migrate that table's PE links into
      PeProgramMatch rows (evidenceTier='exact_pe_number' analog: 'mdap_curated', score=1.0
      where the seed's confidence=1.0, status accepted, evidence carries source
      'seed_curated_v1'). Keep ProgramElementAcquisitionProgram as-is (award attribution
      still reads it) — PeProgramMatch is the graph's source of truth going forward.
   b. Aliases from: MDAP names, PE titles of matched PEs, R-2A project titles, P-1 line names
      (step 1.1), R-3 performer projectName values.
3. Matching service program-element/matching/pe-program-matcher.service.ts + script
   scripts/match-pe-program.ts: propose NEW candidate matches via aliasNormalized trigram
   against PE/project titles (reuse pg_trgm patterns from pe-person-matcher), boosted by
   other-funding links (step 1.5: a resolved P-1 line shared with a program's known lines)
   and component agreement. Output goes to PeProgramMatch as candidate/quarantined per the
   thresholds. NEVER auto-accept from fuzzy paths.
4. Review queue: extend the admin API + a new web page (pattern: PersonCandidatesPage) listing
   candidate/quarantined PeProgramMatch rows with evidence rendering ("Why: project title
   exact match + R-2A p.144 + P-1 line 027" style — build the string from evidence jsonb) and
   accept/reject/quarantine actions + audit log.
5. PE profile: new "Programs" panel — accepted matches (program name + office when 2.2 lands +
   confidence band + Why-shown evidence line + status badge); candidates shown ONLY with a
   'Candidate — requires review' badge; quarantined never shown.
6. API: GET /programs/:id (profile: aliases, PEs, awards via mdapCode, performers),
   GET /programs?q= (alias search). Wire into the explorer search sources.

SUCCESS CRITERIA:
- Seed creates ≥1 Program per curated MDAP code with accepted PE links (counts in report).
- Matcher run on dev data yields candidates with sane evidence; ZERO fuzzy auto-accepts
  (prove via SQL: no accepted rows without official/exact evidence tier or curated seed).
- Review UI: accepting a candidate flips PE profile Programs panel (demonstrate before/after);
  rejecting removes it; audit log row written.
- Thresholds enforced in unit tests (table-driven: score→default status).
- The §7 UI criterion is met: for every shown match the panel renders program name, why-shown
  evidence summary, source evidence links, confidence band, status, last reviewed (DOM
  evidence).
- API + web suites green.
```

#### Step 2.2 — ProgramOffice + PersonRole + contact-use guardrails

Objective: people hang off offices/roles, not PEs (plan §8 required model + §17 compliance
guardrails; plan's "most important technical decision" §14).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Replace free-text org/person→PE shortcuts with ProgramOffice + PersonRole, with
compliance classifications.

Existing assets to study: AcquisitionPersonnel (pePrimary/peSecondary, organization free text),
sync-peo-rosters.ts + __data__/peo_roster_*.json (org rosters w/ roles; deliberately does not
set pe_primary), sync-cpe-roster.ts, sync-dod-orgcharts.ts, ProgramElementPersonCandidate
review queue, staleness/supersede machinery.

1. Migrations (global):
   - ProgramOffice: id; name; officeType ('peo'|'pm'|'cpe'|'pae'|'directorate'|'command'|
     'contracting_office'|'other'); service; parentOfficeId nullable; sourceUrl; status;
     validFrom/validTo nullable (time-versioned reorgs); metadata; timestamps. Unique
     (name, service, coalesce(validFrom,'-infinity')).
   - PersonRole: id; personId FK acquisition_personnel; officeId FK nullable; programId FK
     nullable; roleTitle; roleType ('peo'|'pm'|'deputy'|'chief_engineer'|'contracting_officer'|
     'staff'|'other'); sourceUrl; sourceQuote nullable; observedAt; effectiveStart/End nullable;
     confidence; reviewStatus ('accepted'|'candidate'|'quarantined'); contactUse
     ('lobbying_contact'|'program_ownership_context'|'official_procurement_poc'|
     'internal_owner'|'relationship_owner'|'do_not_contact_procurement_sensitive'|
     'candidate'|'quarantined'); timestamps.
   - ProgramOfficeProgramLink: officeId; programId; relation ('manages'|'executes'|'supports');
     sourceUrl; confidence; reviewStatus; unique (officeId, programId).
2. Backfill scripts/backfill-program-offices.ts: create ProgramOffice rows from the distinct
   roster orgs (peo_roster_*.json carry org + formerName + service + source) and from
   acquisition_personnel.organization values that match roster orgs; create PersonRole rows
   for roster people (roleTitle/role from the artifacts; contactUse default
   'program_ownership_context'; contracting officers from sam personnel source get
   'official_procurement_poc'). Do NOT delete or rewrite acquisition_personnel fields;
   pePrimary stays as legacy display until parity.
3. Guardrail policy in code (single module, e.g. acquisition-personnel/contact-use.policy.ts):
   classification rules + the FAR-derived hard rule: roleType='contracting_officer' or
   source='sam_gov' people are NEVER surfaced as lobbying contacts and carry
   'official_procurement_poc'; anyone associated ONLY via source-selection-adjacent signals is
   excluded from recommendation surfaces entirely. Unit-test the policy.
4. Matcher evolution: pe-person-matcher continues to propose person→PE candidates, but
   confirmation now ALSO records a PersonRole (officeId resolved from the person's org when
   known) — adapt PersonCandidatesPage resolve flow. New office→program candidates go through
   ProgramOfficeProgramLink with reviewStatus='candidate' (sources: roster
   programOfRecord values matched against ProgramAlias — trigram, candidate only).
5. UI:
   - ProgramTeamPanel: each person now shows a contactUse badge (AntD Tag: 'Official
     procurement POC', 'Program ownership context', 'Candidate — requires review'), a
     freshness line ("last observed <date> · source <host>"), and a "Why shown" line built
     from PersonRole (role @ office → office manages program → program mapped to this PE) —
     when the chain is partial, say exactly which hop is missing.
   - Directory drawer: render roles with effective dates and contactUse.
6. Staleness: extend pe-staleness/staleness jobs to mark PersonRole rows stale when
   observedAt > 180d without re-assertion; stale roles render with a 'Stale — verify before
   use' badge and are excluded from future action recommendations.

SUCCESS CRITERIA:
- Backfill creates offices for all roster orgs (counts; zero duplicates on re-run) and
  PersonRole rows for ≥95% of roster people (unmatched listed with reasons).
- Policy spec green: a sam_gov contracting officer can never be classified
  'lobbying_contact' (explicit test); source-selection exclusion test present.
- PE profile person panel shows badge + why-shown + freshness for every person (DOM evidence
  for one PE with roster-sourced people).
- Confirming a person-candidate creates a PersonRole row (show SQL before/after).
- The §8 failure condition is impossible in UI copy: grep the web bundle for the phrase
  pattern "owns PE" → zero occurrences; the why-shown line uses role/office phrasing.
- API + web suites green; existing directory features unregressed.
```

#### Step 2.3 — Client relevance v2: identifiers, facilities, multi-path scoring ∥ (after 2.1)

Objective: client inputs and relevance scoring per plan §9 and §13 (client-to-award,
client-to-facility/district required matches).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Upgrade client modeling so PE/program changes can be scored for client relevance on
explainable paths.

Existing: Client + ClientCapability (peNumber single, tags, sector, districtNexus TEXT,
fundingAsk), ClientIntelMapping (lda/fec/contracting resolution), FederalAward
(recipientUei, pop districts), term-expansion.ts acronym map, embeddings infra.

1. Migrations (tenant-scoped, RLS — follow Client table patterns):
   - Client: add columns uei varchar(12) nullable, cageCode varchar(5) nullable,
     naicsCodes text[] default '{}', pscCodes text[] default '{}'.
   - ClientFacility: id; tenantId; clientId; name; addressLine/city/state/zip; congressional
     district varchar(2) nullable + districtSource ('user'|'geocoded'); employeeCount int
     nullable; notes; timestamps. RLS like client_people.
   - ClientCapability: add peNumbers text[] default '{}' (multi-PE; keep peNumber for
     backcompat, read path unions them), keywords text[] default '{}' (explicit match
     keywords, distinct from display tags).
2. Relevance service intelligence/client-pe-relevance.service.ts: for (clientId, peCode)
   compute matchPaths[]: capability_keyword (keywords ∪ expanded tags vs PE title/mission/
   project text — reuse term-expansion + trigram/embedding floors already in
   intelligence.service.ts), capability_pe_direct (peNumbers), prior_award (client uei/name
   via ClientIntelMapping ↔ FederalAward.peCode or program mdapCode), facility_district
   (ClientFacility district ∈ award pop districts for the PE, or member-district relevance
   later), ecosystem (client maps to a performer/awardee on the PE). Each path returns
   {path, score, evidence[]}. Overall score = documented combination (max + diversity bonus),
   0..1. Cache per the service's existing caching patterns.
3. Wire into getAffectedTenants in program-element-writer (additive: keep watches +
   peNumber, add relevance ≥0.5 clients) and into the delta engine's per-tenant materiality
   (clientRelevance factor now real). Keep per-tenant computation OUT of global tables.
4. API: GET /intelligence/clients/:clientId/pe-relevance?minScore=&page= → ranked PEs with
   paths + evidence; GET /program-elements/:peCode/client-relevance (tenant-scoped) for the
   PE profile.
5. UI: Client workspace gains a "Defense budget exposure" card (top relevant PEs + why);
   PE profile gains a "Client relevance" panel listing tenant clients with paths + evidence
   chips. Facilities editor: simple CRUD table in client settings (state+district dropdowns;
   district validated format e.g. 'TX-12').
6. Specs: each path scored in isolation w/ fixtures; combination function table-driven; RLS
   isolation test (tenant A cannot see tenant B relevance — follow existing RLS spec
   patterns).

SUCCESS CRITERIA:
- For a seeded demo client with capability keywords matching a known PE mission + a facility
  in a district that has awards on that PE: relevance returns ≥2 distinct paths with evidence
  (show JSON).
- Writer emission now includes relevance-matched clients (prove: create capability w/ keyword,
  trigger a year-value change in a spec, IntelligenceChange.relatedClientIds contains the
  client).
- §9 minimum recommendation fields are derivable: client, issue, budget change, why-it-matters
  (paths), PE/project, evidence, confidence — show one assembled JSON example.
- RLS spec green; API + web suites green.
```

#### Step 2.4 — Committee report language capture ∥ (after 2.1)

Objective: store and link report-language provisions with page provenance (plan §4.1 full
module; §6 report-language action deltas; feeds §10 "add report language" actions).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Extract, store, and link congressional report LANGUAGE (not just dollar tables) to
PEs/projects/programs.

Existing: committee dollar-table parsers (armed-services/defense-approps/conference) read
committed artifacts; GovInfoCache + govinfo.service.ts fetch documents; BillText stores bill
full text; extract-bill-pe-codes.ts does PE-code regex.

1. Extend the report extractors (__tools__/extract_armed_services_report.py and the approps
   extractor) with a language pass: segment the report's narrative sections into provisions
   (heading + paragraphs + page span) deterministically (font/indent/heading heuristics in
   pdfplumber — keep it conservative: a provision must have a heading line and ≥1 paragraph).
   Emit provisions artifact per report (committee_provisions_<report>_<fy>.json):
   {heading, text, pageStart, pageEnd}.
2. Migration: model CommitteeReportProvision (global): id; sourceDocumentId FK; committee
   ('hasc'|'sasc'|'hac_d'|'sac_d'|'conference'); fy; heading; text; pageStart/pageEnd;
   actionType nullable ('directs_briefing'|'directs_report'|'adds'|'cuts'|'transfers'|
   'restricts'|'encourages'|'expresses_concern'|null) — classify by DETERMINISTIC keyword
   rules ("directs the Secretary"/"shall provide a briefing"/"recommends an increase" etc.;
   rules unit-tested; null when ambiguous, no LLM); timestamps.
   Link table ProvisionPeLink: provisionId; peCode nullable; projectCode nullable;
   programId nullable; matchBasis ('pe_code_regex'|'project_title'|'program_alias');
   confidence; reviewStatus (alias matches default candidate; pe_code_regex exact →
   accepted). Unique (provisionId, coalesce(peCode,''), coalesce(programId::text,'')).
3. Loader scripts/sync-report-provisions.ts: loads artifacts, runs linking (PE regex from
   extract-bill-pe-codes patterns; project/program alias trigram → candidates), idempotent.
4. Surfaces: PE profile "Congressional activity" panel — provisions touching this PE
   (committee badge, actionType tag, heading, expandable text, page deep link); delta engine
   gains deltaType='report_language_action' rows (materiality boost for
   directs_*/restricts). Program profile shows program-linked provisions.
5. Run for the FY2026 HASC artifact's underlying report first (its PDF is already known from
   __data__), then FY2027 HASC + the 0.3-acquired approps reports.

SUCCESS CRITERIA:
- Provisions artifacts committed for ≥2 reports; loader idempotent (re-run no-op proven).
- For 10 sampled provisions, text and page spans match the PDF exactly (table in report).
- PE-code-bearing provisions linked accepted; alias-only links are candidates ONLY (SQL
  proof: no accepted alias-basis rows without review).
- actionType classifier spec green incl. ambiguous→null cases; zero false 'directs_*' in the
  10-sample check.
- PE profile renders the panel with page deep links (DOM evidence).
- API + web suites green.
```

---

### PHASE 3 — Action layer (closes plan MVP 3)

#### Step 3.1 — SAM.gov opportunities ingestion + matching ∥

Objective: budget movement connects to live market activity (plan §16 linkage path; §7
SAM-evidence tier for program matching).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Ingest SAM.gov opportunities and match them to programs/PEs/clients.

Existing: scripts/sync-sam-personnel.ts already calls the SAM opportunities v2 search API
(SAM_GOV_API_KEY) but only extracts contracting-officer PEOPLE. Reuse its client/auth/paging.

1. Migration: model SamOpportunity (global): id; noticeId unique; solicitationNumber nullable;
   title; noticeType ('sources_sought'|'presolicitation'|'solicitation'|'combined'|
   'special_notice'|'award_notice'|...); agency; office; pscCode; naicsCode; postedDate;
   responseDeadline nullable; archiveDate nullable; description text; pocName/pocEmail
   nullable (public SAM POC only); placeOfPerformance jsonb; sourceUrl; active boolean;
   raw jsonb; lastSyncedAt. Indexes: (active, responseDeadline), naicsCode, pscCode, office.
   Link table SamOpportunityMatch: opportunityId; programId nullable; peCode nullable;
   matchBasis ('program_alias'|'office'|'psc_naics_component'|'description_pe_code');
   confidence; reviewStatus (description_pe_code exact → accepted; alias/office combos ≥0.65
   → candidate; below → quarantined per plan §7 SAM tier 0.65-0.85); unique
   (opportunityId, coalesce(programId::text,''), coalesce(peCode,'')).
2. scripts/sync-sam-opportunities.ts: incremental via SyncRun --since, DoD filters, daily
   cadence (add to ingestion-schedule per step 0.4 conventions; active notices daily, archived
   weekly per SAM docs). Matching pass: PE-code regex on description (accepted); ProgramAlias
   trigram on title+description w/ component+office agreement (candidate); PSC/NAICS alone is
   NEVER sufficient (quarantined hint only).
3. Surfaces: PE profile "Procurement activity" panel (active notices: type, title, office,
   deadline w/ countdown, POC labeled 'Official procurement POC' with the contact-use
   guardrail badge from 2.2); Program profile same; client relevance service (2.3) gains
   procurement_match path (client naics/psc ∩ opportunity + capability keyword hit).
   Delta/alert hook: a material delta on a PE with an active matched notice closing ≤21d
   raises deadlineProximity in materiality (wire the placeholder from 1.4).
4. Specs: matcher table-driven; deadline countdown; guardrail badge always rendered for POC.

SUCCESS CRITERIA:
- Sync pulls real DoD notices in dev (count by noticeType in report); re-run incremental.
- ZERO auto-accepted alias matches (SQL proof); description_pe_code accepted matches verified
  on 5 samples against the notice text.
- A PE with a matched active notice renders the panel w/ countdown + POC guardrail (DOM
  evidence).
- Client with overlapping NAICS + keywords sees procurement_match path in relevance JSON.
- EventBridge rule added per 0.4 pattern (cdk synth snippet).
- API + web suites green.
```

#### Step 3.2 — ActionRecommendation engine + Action Board

Objective: the module's core output: materiality-gated, client-specific action cards with
proof, uncertainty, owner, deadline, status (plan §10 full card spec; §19 workflow states;
§12.4 board).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Build action recommendations end-to-end.

Inputs that now exist: ProgramElementDelta w/ materiality (1.4), client relevance paths (2.3),
provisions (2.4), SAM matches (3.1), PersonRole + contactUse (2.2), proof-pack provenance
(0.1/1.2).

1. Migration (tenant-scoped, RLS): model ActionRecommendation: id; tenantId; clientId;
   peCode nullable; programId nullable; deltaId nullable; issueTitle; actionType
   ('protect_funding'|'restore_cut'|'add_report_language'|'oppose_restriction'|
   'district_one_pager'|'monitor_procurement'|'client_alert'|'schedule_outreach'|
   'escalate_uncertainty'|'update_compliance_notes'); whatChanged text; whyItMatters text;
   recommendedAction text; targetAudience jsonb (typed refs: committee/office/personRole ids +
   contactUse echoed); suggestedArtifactType nullable; deadline date nullable;
   deadlineSource text nullable ('sam_response'|'markup_window'|'hearing'|'manual'|null →
   render "no known deadline"); ownerUserId nullable; priority int; confidence jsonb
   (per-component: delta/programMatch/peopleMatch/clientRelevance bands); uncertainty text;
   evidence jsonb (proof refs: sourceDocumentId+page / deltaId / provisionId / opportunityId);
   status ('new'|'triaged'|'assigned'|'drafting'|'ready_for_review'|'sent_to_client'|
   'outreach_completed'|'monitoring'|'dismissed'|'archived'); dismissalReason text nullable;
   outcome text nullable; timestamps. Indexes (tenantId, status, deadline), (tenantId, clientId).
2. Generator intelligence/action-recommendation.service.ts + scripts/generate-actions.ts
   (after emit-changes in the schedule): for each NEW material delta × relevant client
   (relevance ≥0.5): assemble the card DETERMINISTICALLY from templates per actionType —
   composed strictly from stored facts (delta numbers, stage, provision actionType, SAM
   deadline, relevance paths). Audience selection: accepted PersonRoles of offices linked to
   accepted program matches + committee relevance (HASC/SASC for authorization deltas,
   HAC-D/SAC-D for approps) — ALWAYS carrying contactUse; NEVER include
   official_procurement_poc as lobbying audience (policy module from 2.2 enforced in the
   generator + spec). Cards referencing any candidate/quarantined match MUST set
   actionType='escalate_uncertainty' or carry explicit uncertainty text — no silent use
   (plan §7: quarantined never used in recommendations).
   Gating: materialityScore ≥0.4 AND relevance ≥0.5; dedupe on (clientId, deltaId,
   actionType); idempotent re-runs.
3. API: CRUD under /intelligence/actions (list w/ filters status/client/deadline-sort,
   PATCH status/owner with transition validation per the §19 state list, dismissal requires
   dismissalReason). AuditLog on transitions.
4. Web: ActionBoardPage (/actions): deadline-ranked card list + kanban-by-status toggle
   (reuse workspace KanbanBoard patterns); card shows EVERY §10 required field incl.
   confidence bands and uncertainty; evidence chips open the proof pack / source pages;
   owner assignment (tenant users); dismissal modal w/ reason. Changes Inbox rows that have a
   generated action deep-link to it.
5. Specs: generator gating (immaterial/irrelevant → no card), guardrail enforcement,
   transition validation, dismissal-reason requirement, idempotency.

SUCCESS CRITERIA:
- On dev data: a seeded scenario (material FY27 HASC increase on a PE matched to a program
  and a relevant client w/ facility) generates a card containing ALL §10 required fields —
  paste the JSON in the report and check each field off.
- The §2 narrative bar: the card's assembled text reads like the plan's exemplar ("increased
  by $X in the House position... Senate silent... maps to <capability>... contact <office>")
  built ONLY from stored facts (show the template inputs).
- Negative tests green: no card for sub-threshold deltas; procurement POC never in lobbying
  audience; quarantined program match → escalate_uncertainty only.
- Board UI: deadline-first ordering, status transitions persist, dismissal captures reason
  (DOM evidence).
- Daily generate-actions wired into the schedule (0.4 pattern). Suites green.
```

#### Step 3.3 — Source-backed artifact generation (one-pagers, memos, talking points)

Objective: user-ready drafts with citations and caveats (plan §15 district artifacts; §18
artifact quality criteria: 100% source-backed claims, editable, audience-specific).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Generate editable, source-backed artifacts from action cards.

Existing machinery to reuse: workflows generate-document path, ClioArtifact storage, Clio
prompt/citation helpers (clio-citations.helpers.ts), insight-generator LLM patterns,
generate-report-card-docx.ts (docx generation exists).

1. Artifact types (server-side service intelligence/artifact-generator.service.ts):
   'internal_brief' | 'client_email' | 'member_one_pager' | 'committee_staff_memo' |
   'talking_points' | 'procurement_watch_note'. Input = ActionRecommendation id. Build a
   FactSheet first: a typed, deterministic bundle of every claim the artifact may use —
   {claimText, value, sourceDocumentId/page or deltaId/provisionId/opportunityId} — from the
   card's evidence. THEN let the LLM (existing Anthropic integration patterns) write prose
   with HARD constraints: it may only reference FactSheet claims by id (structured output:
   array of paragraphs, each listing claimIds used); a post-pass verifier (pattern:
   clio-verifier.helpers.ts) rejects any paragraph with zero claimIds or numerals not present
   in claimed facts; uncertain mappings from the card's uncertainty field MUST appear in a
   caveats section. District one-pager additionally pulls ClientFacility + district awards
   (FederalAward pop district) + employeeCount when present.
2. Persist as ClioArtifact-compatible records linked to the action (extend schema minimally if
   a link column is needed); status flows into the card ('drafting'→'ready_for_review').
3. API: POST /intelligence/actions/:id/artifacts {type}; GET list; PATCH content (editable —
   store user edits, never regenerate over them silently).
4. Web: from the action card — "Generate <type>" menu; artifact editor view (simple rich
   text or markdown textarea is fine) w/ a Sources appendix rendered from claimIds → human
   citations ("R-2A, p.144; House report p.93; SAM notice <id>"); export .docx via the
   existing docx pathway; copy-to-clipboard.
5. Specs: FactSheet assembly; verifier rejects unsourced numerals (adversarial fixture);
   caveats always present when uncertainty non-empty; edit preservation.

SUCCESS CRITERIA:
- For the 3.2 demo card: generate member_one_pager and committee_staff_memo; BOTH contain a
  sources appendix where every numeric claim maps to a claimId (paste artifacts in report;
  manually verify 100% of numerals are claimed — list each).
- Verifier demonstrably rejects a doctored generation containing an unsourced number (spec).
- Talking points differ by audience (staff memo vs member one-pager differ in framing —
  show both).
- Editing then regenerating does not clobber edits (creates a new version).
- §15 failure condition avoided: district one-pager includes facility/jobs/awards when data
  exists, and the district score never appears without the one-pager affordance.
- Suites green.
```

#### Step 3.4 — Relationship coverage gaps ∥

Objective: show where the team has/lacks coverage for the offices that matter (plan §14).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Compute and surface relationship-coverage gaps per client issue.

Existing: engagement module (Meetings, MailThreads, OutreachRecords, EngagementContacts w/
directoryEntryId + acquisitionPersonnelId links), directory (members + staffers + favorites +
notes), ClientPerson, action cards (3.2) with targetAudience office/person refs.

1. Service intelligence/coverage-gap.service.ts: for a (clientId, ActionRecommendation|peCode):
   relevant offices = targetAudience ∪ committee offices from provisions ∪ member offices from
   facility districts (2.3). For each office/person: lastTouch = max(meeting attendee match,
   outreach record, mail thread participant — reuse engagement queries; match contacts via
   EngagementContact links), owner = the engagement record's user, strength =
   recency-banded ('active' <30d, 'warm' <120d, 'cold' ≥120d, 'none'). Output the §14 example
   shape: strong/weak/none lists + why-now (the delta/deadline) + suggested next step
   (assign owner → becomes a schedule_outreach action via 3.2 API).
2. API: GET /intelligence/actions/:id/coverage and GET /intelligence/clients/:clientId/coverage.
3. Web: "Coverage" section on the action card detail + client workspace card: offices grouped
   by strength, last-touch dates, gap rows highlighted with one-click "Assign & create
   outreach action".
4. Respect permissions: engagement data is tenant-scoped and access-controlled already —
   do not leak across tenants (RLS spec).

SUCCESS CRITERIA:
- Seeded scenario: client w/ a meeting 20d ago with office A staff, nothing with office B →
  coverage returns A=active w/ lastTouch, B=none, why-now references the delta (JSON in
  report).
- One-click gap action creates a schedule_outreach ActionRecommendation assigned to the
  chosen owner (demonstrate).
- RLS isolation spec green; suites green.
```

#### Step 3.5 — Unified analyst console + alias manager + audit views

Objective: one place for every review queue with audit history (plan §23; §12.5; review SLAs
§22).

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Consolidate analyst tooling.

Existing queues/pages: PeReconciliationPage (+resolve from 0.2), PersonCandidatesPage,
personnel merge tab in CapiroAdminPage, PeProgramMatch review (2.1), provision candidate links
(2.4), SAM match candidates (3.1), quarantine TABLES with no UI
(ProgramElementQuarantine, AcquisitionPersonnelQuarantine).

1. Web: /admin/analyst-console with tabs: Reconciliation | Program matches | Person roles &
   candidates | Merge candidates | Provision links | SAM matches | Quarantine | Audit log.
   Reuse the existing pages/components where they exist (mount, don't rewrite); build the
   missing ones following PersonCandidatesPage patterns. Each tab shows open-count badges
   (single aggregate endpoint /admin/review-counts).
2. Quarantine tab: browse ProgramElementQuarantine + AcquisitionPersonnelQuarantine grouped
   by reason+source with row inspection (raw record JSON viewer) and bulk 'discard' /
   'reprocess' actions (reprocess re-runs the relevant writer validation — read
   program-element-writer quarantine path first).
3. Alias manager tab (under Program matches): list/add/edit/merge ProgramAlias rows; merging
   two Programs = re-point aliases + PeProgramMatch + links, soft-retire the loser
   (supersededBy pattern), full audit row. Duplicate-alias detector (same aliasNormalized,
   different programs) feeds a review list (plan §13 alias-duplicate requirement).
4. Audit log tab: filterable AuditLog view (entity type, actor, date) for every analyst
   decision made anywhere in the console.
5. SLA instrumentation: review-counts endpoint also returns oldest-open age per queue;
   console header shows SLA chips (e.g. 'PE-program queue: oldest 3d') matching §22 targets
   (1 business day for high-priority quarantined PE-program matches — encode the priority
   rule: matches touching PEs with material deltas are high-priority).
6. Keep all of it capiro_admin-gated like existing admin surfaces.

SUCCESS CRITERIA:
- All 8 tabs functional against dev data; counts accurate (cross-check via SQL in report).
- Program merge: aliases + matches re-pointed, audit row written, loser retired (SQL
  before/after).
- Quarantine reprocess on a fixable row succeeds and removes it from quarantine (demonstrate
  with a seeded row).
- Duplicate-alias detector finds a seeded duplicate pair.
- Every decision in every tab writes AuditLog (spot-check 3 tabs).
- Suites green.
```

---

### PHASE 4 — Verification & launch

#### Step 4.1 — Accuracy harness, golden sets, metrics

Objective: measure the §22 accuracy targets and §24 product analytics rather than asserting
them.

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Build the accuracy + analytics measurement harness.

1. Golden sets (committed under apps/api/test/__golden__/): (a) 100 randomly-sampled R-1 rows
   hand-verified against the PDF (peCode, title, BY amount, page) — generate the sample list
   programmatically, then verify and freeze; (b) 50 program-match decisions (25 accepted/25
   rejected by an analyst via the console — export tool provided); (c) 50 person-role records
   similarly; (d) 25 delta classifications.
2. scripts/measure-accuracy.ts: replays golden sets against current DB/matchers and reports:
   PE identity accuracy, funding-value accuracy, PE-program precision (accepted vs golden),
   person-role precision, delta accuracy — against the §22 targets (≥99/≥99/≥95/≥97/≥98).
   Exit non-zero under target; CI-friendly --json.
3. Product analytics: instrument (lightweight event table or existing observability module —
   read apps/api/src/observability first): action cards generated/accepted/dismissed (+reason),
   proof-pack click events (web fires a beacon), time-from-ingestion-to-card (deltaId
   timestamps), artifact generation count. Expose /admin/metrics/product summary (counts by
   week) for the north-star metric: client-specific source-backed actions accepted per week.
4. Performance pass: k6 or autocannon scripts (scripts/perf/) for §21 targets — PE search
   <1s, PE profile <3s, action card gen <10s on dev-sized data; record baselines, fix only
   egregious misses (document the rest as backlog).

SUCCESS CRITERIA:
- Golden sets committed with provenance notes; measure-accuracy.ts runs in CI mode and
  reports every §22 metric with current values (paste table).
- Metrics endpoint returns real counts after exercising the flows in dev.
- Perf baselines recorded in docs/runbooks/perf-baselines.md with pass/fail vs §21.
- Suites green.
```

#### Step 4.2 — End-to-end acceptance test (§27) + launch checklist

Objective: prove the §27 scenario "source → action card → artifact without reading the budget
book", automated.

Agent prompt:

```text
[PASTE SHARED CONTEXT PREAMBLE]

TASK: Automate the plan's end-to-end acceptance scenario and produce the launch-readiness
report.

1. Integration test (jest, real dev DB, seeded tenant+client): fixture a small synthetic
   budget source artifact (a mini R-1/R-2A pair + a House-mark artifact for ONE fictional PE
   with a real-looking structure, committed under test fixtures) and drive the FULL pipeline
   programmatically: load → SourceDocument w/ sha256 → extraction rows w/ pages →
   reconciliation PASS → delta detected (mark increase, material) → project identified →
   program candidate via alias (left candidate, then accepted via API as the analyst) →
   client matched (capability keyword + facility district) → person/office mapped w/
   guardrail → action card generated w/ ALL §10 fields → proof pack resolves every evidence
   ref → uncertainty shows the pieces pending review → artifact generated w/ sources appendix
   → owner assigned, status walked new→assigned→drafting→ready_for_review → dismissal path
   tested on a second card w/ reason. Assert each §27 step explicitly (one assertion block
   per row of the §27 table, labeled).
2. Launch-readiness report docs/plans/<date>-defense-budget-launch-readiness.md: walk the
   plan's §25 alpha + beta checklists item by item with status + evidence links (test names,
   endpoints, screenshots), and the §26 negative-criteria checklist (e.g. confirm no surface
   renders a person as PE owner; no recommendation uses quarantined matches — cite the
   enforcing specs).
3. Wire the e2e test into CI as a separate job (it may be slower; mark it accordingly).

SUCCESS CRITERIA:
- The e2e test passes locally and in CI; its output enumerates all §27 steps PASS (paste).
- Launch-readiness doc complete; every alpha criterion green; beta criteria green or
  explicitly waived with reason.
- A human can follow the doc's demo script section to reproduce the scenario in the UI in
  <15 minutes.
```

---

## 5. Sequencing, sizing, launch mapping

| Phase | Steps | Parallel agents | Closes |
|---|---|---|---|
| 0 | 0.1–0.4 | up to 4 | §4.2/4.3 provenance, §23 partial, ops readiness |
| 1 | 1.1–1.5 | 2 (1.1∥1.2 first) | Plan MVP 1 + §6 deltas + §11 proof pack |
| 2 | 2.1–2.4 | 2 after 2.1 | Plan MVP 2: §5 model, §7, §8, §9, report language |
| 3 | 3.1–3.5 | 2–3 | Plan MVP 3: §10, §12.4, §14, §16, §17 |
| 4 | 4.1–4.2 | 1 | §21, §22, §24, §25, §27 |

Alpha (plan §25) is reachable at the end of Phase 1 + step 2.1: one budget year + prior year,
provenance, deltas, review queue, basic program candidates, capability matching, internal
change feed, quarantine. Beta requires Phase 2 complete + 3.1/3.2. GA requires all of Phase 3
+ Phase 4 evidence.

Standing rules for every agent run (put teeth on "no shortcuts"):

1. No step is done until its success criteria are demonstrated in the agent's final report
   with command outputs — not asserted.
2. Any schema change is additive; destructive migrations are rejected in review.
3. Anything fuzzy lands as candidate/quarantined, never accepted — reviewers accept.
4. No LLM in any data-extraction or matching path; LLM only in artifact prose generation,
   constrained by the FactSheet verifier (3.3).
5. Each step ends with: full API jest + web vitest + both typechecks green, and a ≤1-page
   summary appended to docs/plans/ if any design decision deviated from this document.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| FY27 cycle timing: SASC/HAC-D/SAC-D FY27 documents arrive mid-build | 0.3's coverage runbook + 0.4's artifact-gate alarm make arrival an operational event, not a code change |
| PB-position model double-maintains with ProgramElementYear | Accepted deliberately for safety; consolidation is a post-GA refactor once positions power the UI |
| Provision segmentation on messy report PDFs | Conservative heuristics + candidate-only linking + 10-sample manual verification per report |
| Program seeding skew (MDAP-only programs initially) | Alias growth from R-2A/P-1/SAM accretes coverage; §22 precision measured on golden sets, not vibes |
| Action-card noise (the plan's §26 failure mode) | Dual gating (materiality ≥0.4 AND relevance ≥0.5) + dismissal-reason capture feeding 4.1 metrics |
| Compliance exposure on people surfaces | contactUse policy module is code + spec, enforced at generator level, not just UI copy |
