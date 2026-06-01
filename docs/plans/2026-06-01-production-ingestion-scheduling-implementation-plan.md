# Capiro Production Ingestion & Scheduling — Implementation Plan

> **For Hermes:** Execute task-by-task using subagent-driven-development. Each task is independently committable. NO `cdk deploy Compute` without reconciling live drift (see ops note at end).

**Goal:** Make every data pipeline production-ready: one-time backfill of all source tables, autonomous incremental schedules (daily vs periodic), embeddings that keep themselves current, and full ingestion observability.

**Architecture:** EventBridge Rules → Scheduled ECS Fargate tasks, each overriding the API container command to a kebab-case job already wired in `entrypoint.sh`. A shared `SyncRun`-backed watermark makes every job incremental ("only new data"). A post-sync embedding fan-out keeps `context_embeddings` current autonomously. All jobs write `SyncRun` for a real ingestion dashboard.

**Tech Stack:** AWS CDK (EventBridge, ECS Fargate, ScheduledFargateTask), NestJS, Prisma/Postgres (Aurora), Titan embeddings (Bedrock), existing `tsx` scripts.

**Key facts established from code audit (commit 7a0c0a7):**
- 64 scripts on main; ~45 are real ingestion jobs, all dispatchable via `entrypoint.sh`, NONE scheduled.
- Most scripts already `upsert` (idempotent, re-run-safe). Several already accept `--since`.
- `SyncRun` model already exists with the right columns (source, startedAt, finishedAt, rowsInserted/Updated, errorCount, status, errorMessage) — only 6 scripts use it today.
- `embed-backfill` is content-hash idempotent; sources = bills | lda | capabilities; NOT auto-run after syncs.

---

## PHASE 0 — Foundations (shared watermark + SyncRun standard)

### Task 0.1: Create a shared SyncRun watermark helper
**Objective:** One helper that wraps a sync: opens a SyncRun, exposes the last successful run's `startedAt` as the incremental `--since`, records row counts, closes status.
**Files:**
- Create: `apps/api/src/ingestion/sync-run.helper.ts`
- Test: `apps/api/src/ingestion/sync-run.helper.spec.ts`

**Behavior:**
```ts
// runWithSyncRun(source, fn) :
//   1. lastSince = MAX(started_at) WHERE source=? AND status='success'
//   2. insert SyncRun{ source, startedAt:now, status:'running' }
//   3. result = await fn({ since: lastSince, recordRows })  // fn reports inserted/updated
//   4. update SyncRun{ finishedAt, rowsInserted, rowsUpdated, errorCount, status:'success'|'error', errorMessage }
//   5. on throw: status='error', errorMessage=e, errorCount++ ; rethrow
```
**Verify:** unit test — running twice returns the first run's startedAt as the second's `since`; error path sets status='error'.

### Task 0.2: Adopt the helper in all sync scripts (standardize SyncRun)
**Objective:** Every `sync-*` / `extract-*` / `enrich-*` / `emit-*` / `compute-*` / `parse-*` job wraps its body in `runWithSyncRun(<source>, ...)`.
**Files (modify):** all `apps/api/scripts/sync-*.ts`, `extract-*.ts`, `enrich-*.ts`, `emit-*.ts`, `compute-*.ts`, `recompute-conference-probability.ts`, `refresh-lobby-intel-mv.ts`, `generate-briefings.ts`, `generate-pe-person-candidates.ts`, `sync-entity-resolution.ts`.
**Note:** scripts that already do SyncRun (sync-federal-award, sync-sam-personnel, emit-changes, extract-gao/hearing/press) → refactor to the shared helper for consistency. One commit per ~5 scripts.
**Verify:** `pnpm --filter @capiro/api exec jest` green; grep confirms every job imports the helper.

### Task 0.3: Wire `--since` watermark into scripts that support incremental but don't read it
**Objective:** For sources with a queryable "modified since" param, pass the helper's `since`. For full-refresh-by-upsert sources, document them as full-refresh (cheap, idempotent) and skip watermarking.
**Incremental (use `--since`):** sync-congress, sync-federal-register, sync-federal-award, sync-fara, sync-hearings, sync-openstates, sync-openlobby, sync-regulations, sync-crs, sync-grants, extract-gao/hearing/press-personnel, sync-fec, sync-fec-pac (date-bounded), sync-sec-edgar.
**Full-refresh-by-upsert (no watermark needed):** sync-bea, sync-bls, sync-census, sync-gao(list), sync-rss-intel, sync-peo-rosters, sync-lobby-trending, sync-cpe-roster, sync-dod-orgcharts.
**Verify:** each incremental script logs `since=<ts>` on start; second run pulls only newer rows (row counts drop).

---

## PHASE 1 — Autonomous embeddings

### Task 1.1: Add embed-backfill `--source all` + run-all mode
**Objective:** Make embeddings self-maintaining: one job embeds all sources for all tenants, content-hash idempotent (already supported), since-aware.
**Files (modify):** `apps/api/scripts/embed-backfill.ts` — accept `--source all` (loops bills, lda, capabilities), default `--since` from SyncRun watermark for source `embed:<kind>`.
**Verify:** `embed-backfill --source all --dryRun` lists work across all three; re-run after a sync only embeds new/changed rows.

### Task 1.2: Schedule embeddings AFTER the syncs they depend on
**Objective:** Embeddings run autonomously post-ingest (bills after sync-congress, lda after sync-lda, capabilities after client/capability changes).
**Approach:** an EventBridge rule fires `embed-backfill --source all` on a daily cadence, AFTER the daily federal syncs (offset by a few hours). (See schedule matrix.)
**Verify:** appears in CDK synth; dry-run in staging shows embeddings created for the day's new bills.

---

## PHASE 2 — The scheduler (the missing layer)

### Task 2.1: Add a reusable ScheduledJob CDK construct
**Objective:** One construct = (EventBridge Rule on a cron) → (ECS Fargate RunTask) with the container `command` override = the kebab job name. Reuses the existing API task def, subnets, security group, exec role.
**Files:**
- Create: `infra/cdk/lib/constructs/scheduled-job.ts`
- Modify: `infra/cdk/lib/compute-stack.ts` (instantiate one per job from a schedule table)
- Create: `infra/cdk/lib/ingestion-schedule.ts` (the cadence table — single source of truth, see schedule matrix doc)
**Verify:** `cd infra/cdk && npx cdk synth` produces N `AWS::Events::Rule` + `AWS::Events::Target` (ECS) without error.

### Task 2.2: Encode the schedule matrix (daily vs periodic)
**Objective:** Translate the schedule matrix doc into the `ingestion-schedule.ts` table. Stagger times to avoid thundering-herd and respect dependency order (sources → emitters → embeddings).
**Verify:** synth diff shows every job from the matrix; no two heavy jobs share the same minute.

### Task 2.3: Concurrency & failure guardrails
**Objective:** Each scheduled task: `desiredCount`-style singleton (no overlapping runs of the same job), retry policy, dead-letter to an SNS/alarm, CloudWatch log group per job.
**Files:** extend `scheduled-job.ts`; add alarms in `alarms-stack.ts` (SyncRun error rate / job-not-run-in-N-hours).
**Verify:** synth; alarm on `SyncRun status='error'` and on stale watermark.

---

## PHASE 3 — One-time backfill (populate everything once)

### Task 3.1: Backfill runbook + ordered driver
**Objective:** A documented, dependency-ordered backfill so a human (or a one-shot ECS task) populates every table once. Order matters (sources before emitters/embeddings).
**Files:** Create: `apps/api/scripts/backfill-all.ts` (sequential, resumable, logs SyncRun per step) + `docs/runbooks/initial-backfill.md`.
**Order:**
```
migrate (schema + workflow seed)            # already on deploy
bootstrap-tenant / bootstrap-capiro-admin   # if fresh env
# --- federal sources (parallel-safe groups) ---
sync-congress  sync-federal-register  sync-regulations  sync-hearings  sync-gao  sync-crs  sync-openstates
sync-fec  sync-fec-pac  sync-fara  sync-lda  sync-openlobby  sync-sec-edgar
sync-federal-award → enrich-award-districts  sync-grants  sync-openspending
sync-bea  sync-bls  sync-census
# --- program elements (need PDF artifacts committed) ---
sync-jbook-r2  sync-comptroller-jbooks
parse-hasc-report / parse-sasc-report / parse-hac-d-report / parse-sac-d-report
parse-ndaa-conference  parse-defense-approps-public-law  parse-pdoc
recompute-conference-probability
# --- personnel ---
sync-peo-rosters  sync-dod-orgcharts  import-dow-directory  sync-sam-personnel
sync-dod-press-personnel → extract-press-personnel  extract-gao-interviewees  extract-hearing-witnesses
load-press-personnel-mentions  generate-pe-person-candidates  sync-entity-resolution
# --- derived / embeddings (LAST) ---
extract-bill-pe-codes  refresh-lobby-intel-mv  sync-lobby-trending
emit-changes  emit-bill-alerts  check-comment-periods  compute-health-scores  generate-briefings
embed-backfill --source all
```
**Verify:** after run, row-count each source table > 0 (or documented why empty, e.g. missing PE artifact); SyncRun has a 'success' row per step.

### Task 3.2: Pre-flight key/secret check
**Objective:** Fail fast if a required external key is missing before backfill.
**Required keys:** `GOVINFO_API_KEY` (congress/GovInfo), `SAM_GOV_API_KEY` (sam personnel), `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (briefings/clio), Bedrock creds + `EMBEDDINGS_MODEL` (embeddings), `FIRECRAWL_API_KEY` (PE .mil URL discovery). Verify each open-data source's required env.
**Files:** Create: `apps/api/scripts/preflight-ingestion.ts` (reports present/missing per pipeline).
**Verify:** run in target env; all required keys present or explicitly waived.

---

## PHASE 4 — Things you may have missed (production hardening)

### Task 4.1: PE artifact gap is the #1 silent failure
The PE parsers (`parse-hasc/sasc/hac-d/sac-d/ndaa/pdoc`) consume **committed offline PDF-extraction artifacts**, not live APIs. If those artifacts aren't produced + committed, PE marks stay empty AND no schedule can fix it. **Action:** document the pdfplumber extraction step (`scripts/__tools__/extract_*.py`) as part of the PE pipeline; decide whether to automate artifact generation or treat it as a seasonal manual step (Nov–Jan).

### Task 4.2: Ingestion dashboard (read SyncRun)
**Objective:** A `/admin/ingestion` view (or API endpoint) listing per-source: last run, status, rows in/updated, error, staleness. Turns SyncRun into operator visibility.
**Files:** API `ingestion.controller.ts` (read-only, capiro-admin), web admin page.
**Verify:** shows green/stale/error per pipeline.

### Task 4.3: Rate-limit / API-quota safety
Several APIs (Congress/GovInfo, FEC, SAM) have rate limits. Confirm each script has backoff (sync-congress/federal-register already paginate). Add a shared limiter where missing so scheduled runs don't get throttled/banned.

### Task 4.4: Tenant scoping of derived jobs
Emitters (emit-changes, generate-briefings, compute-health-scores) and embeddings (capabilities) are tenant-aware. Schedules must iterate tenants or the job must loop internally. Verify each derived job covers all active tenants.

### Task 4.5: Materialized view refresh ordering
`refresh-lobby-intel-mv` must run AFTER sync-lda/sync-openlobby each cycle, or the lobby intel UI shows stale data. Encode this dependency in the schedule (offset) and in backfill order.

### Task 4.6: Idempotency audit for the non-upsert writers
`sync-regulations` (raw INSERT), `enrich-award-districts`, `sync-entity-resolution` — confirm re-running doesn't duplicate/clobber. Add ON CONFLICT / guards where missing.

---

## Execution handoff
Recommend executing Phase 0 → 1 → 2 (synth-only, no deploy) → 3 (backfill in staging) → 4. Phases 0–1 are pure app code (safe, testable locally). Phase 2 is CDK that must be reconciled with live drift before any deploy. Phase 3 is the one-time populate. Phase 4 is hardening.

## OPS GUARDRAIL (carried from prior context)
- Build LOCALLY (OneDrive contention).
- Do NOT `cdk deploy Capiro-dev-Compute` without reconciling drift first (live = app.capiro.ai + Aurora backup35/ACU4; repo config differs — a blind deploy would replace the ACM cert + shrink Aurora). Wire scheduler infra OUT-OF-BAND or reconcile config.ts to live first.
- Out-of-band secrets use name `capiro/dev/<name>` (no leading slash) to be covered by the exec-role grant.
