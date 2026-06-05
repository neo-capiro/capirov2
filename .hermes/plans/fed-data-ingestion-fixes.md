# Federal Data Ingestion — Remediation Plan

**Sources:** FARA · Federal Grants · State Bills · BEA · Federal Awards (peCode)
**Status:** IN PROGRESS — branch `fix/fed-data-ingestion` · **Audit:** 2026-06-05 (verified against prod) · **Owner:** Ninja

> **Resolution record + corrected diagnosis:** `apps/api/reports/fed-ingestion-remediation-2026-06-05.md`.
> TL;DR — Root cause A (PassRole) was **already fixed** out-of-band 06-04; B's keys **already exist** (the gap
> was task-def wiring, fixed live). Running the syncs surfaced two more code bugs (grants `data.oppHits` envelope;
> openstates `per_page>20`), now fixed in-branch, plus an **inactive BEA key** (needs activation). FARA enrichment
> engine built + tested (source `FARA_FP_SOURCE_URL` TBD). Code fixes ship with the next API image.
**Scope:** ingestion/data-population only — separate from `.hermes/plans/clio-data-coverage.md` (Clio tooling). Run this standalone.

All findings below were verified against **prod** (account 967807252336, cluster `capiro-dev`, Aurora `capiro-dev-data`): row counts, EventBridge rules/targets, the per-sync task definitions, the EventBridge invoker IAM role, and CloudWatch logs/metrics.

---

## 1. Evidence (prod, 2026-06-05)

| Source | Rows | Scheduled | Actually runs? | Root cause |
|---|---:|---|---|---|
| **FARA** | 561 | weekly (Sun) | ✅ runs clean (`got 561… updated 561, DONE 2.5s`) | Source feed is the **active-registrant directory only** — no foreign principal/country/termination (script writes sentinels). 561 = true active count. |
| **Federal grants** | **0** | daily | ❌ **never launches** | EventBridge fires but **RunTask fails 100%** (Invocations 9 / FailedInvocations 9; zero log streams ever). No API key needed. |
| **State bills** (OpenStates) | **0** | weekly (Sun) | ❌ **never launches** (0 streams) | Same RunTask failure **+** task def is missing `OPENSTATES_API_KEY` (script hard-throws). |
| **BEA** | **0** | monthly (1st) | ❌ **never launches** (0 streams) | Same RunTask failure **+** task def is missing `BEA_API_KEY` (script hard-throws). |
| **Federal awards** | 10,052 | daily | ✅ runs clean | `peCode` resolved on only **227 (2.3%)**; curated acq-program→PE map has **31** entries. PE attribution is best-effort. |

Schedules (all `ENABLED`): `capiro-dev-sync-grants` cron(0 10 * * ? *) · `-openstates` cron(0 8 ? * SUN) · `-bea` cron(0 8 1 * ?) · `-fara` cron(30 7 ? * SUN) · `-federal-award` cron(50 9 * * ?).

---

## 2. Root cause A — grants / bea / openstates never launch

**Proven:** the rules fire on schedule but **every RunTask invocation fails** (grants: 9 invocations, 9 failed; `bea`/`openstates` have zero container log streams ever in `/capiro/dev/api-migrate`). Working siblings (`fara`, `rss-intel`, `gao`, `hearings`) launch fine with the **same** invoker role, subnets, SG, image (`capiro/dev/api:latest`), and task/exec roles.

**Invoker role** `capiro-dev-eventbridge-sync-invoker` → inline policy `RunTaskAndPassRole`:
- `ecs:RunTask` on `arn:…:task-definition/capiro-dev-api-*` → **wildcard covers** grants/bea/openstates ✅
- `iam:PassRole` to exactly: `…ApiTaskRole12FAD4A7-szq3QeeZJSCQ`, `…ApiTaskDefExecutionRoleE6ABB053-YlEDKuUPHjLg`, `…ApiMigrateTaskDefExecutionRoleEB-HuOMLdmYvwnx`.

`grants` and `fara` both use `ApiTaskRole12FAD4A7` + the `ApiMigrate` exec role — **both in the PassRole list** — yet grants fails and fara succeeds. So **IAM looks sufficient and the exact RunTask error is not visible in the metadata** (the failing config is identical to the working one). Two things to do:

**A.1 — Reproduce + capture the real error (do this first).**
```bash
aws ecs run-task --cluster capiro-dev --task-definition capiro-dev-api-sync-grants \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0e38bd390f8961fef,subnet-0920665f91c905f01,subnet-06db79cd21239de19],securityGroups=[sg-01def4e5c0fe44d4a],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"api-sync-grants","command":["sync-grants"]}]}' \
  --region us-east-1
# then: aws ecs describe-tasks --cluster capiro-dev --tasks <arn> --query "tasks[].{last:lastStatus,stop:stoppedReason,exit:containers[0].exitCode}"
# and read logs: group /capiro/dev/api-migrate, stream prefix sync-grants
```
- This runs under **your** creds (broader than the invoker role). **If it SUCCEEDS** → the bug is the **EventBridge invoker role** (RunTask under that role is being denied for these 3) → the fix is IAM (A.2), and grants is now populated. **If it FAILS** → read `stoppedReason`/logs for the real cause (task-def revision state, secret/role/image at provision time).

**A.2 — For each of the 3 failing task defs, confirm its roles are in the PassRole list** (a PassRole mismatch is the classic 100%-RunTask-fail cause):
```bash
for f in capiro-dev-api-sync-grants capiro-dev-api-sync-bea capiro-dev-api-sync-openstates; do
  aws ecs describe-task-definition --task-definition $f \
    --query "taskDefinition.{f:family,task:taskRoleArn,exec:executionRoleArn,status:status,rev:revision}" --output json
done
```
If any `taskRoleArn`/`executionRoleArn` is **not** one of the three ARNs above, add it to the invoker role's `iam:PassRole` resource list. **Fix in `infra/cdk`** (source of truth) so it survives the next deploy; the wildcard on `RunTask` is already fine.

> If A.1 fails to launch even under your creds, the issue is task-def/provisioning, not IAM — the `stoppedReason` will name it (e.g., `ResourceInitializationError` on a secret/image).

---

## 3. Root cause B — bea & openstates also lack their API key

Verified: `capiro-dev-api-sync-bea` and `-openstates` task defs carry only `CLERK_*` + `DB_*` secrets. Both scripts **hard-throw** without their key — `sync-bea.ts:45` (`BEA_API_KEY env var is required`), `sync-openstates.ts:64` (`OPENSTATES_API_KEY env var is required`). So even after A is fixed they'll fail until the keys are added. **Grants needs no key.**

1. Get free keys — BEA: `apps.bea.gov/API/signup/` · OpenStates: `openstates.org` account → API key.
2. Store as secrets (preflight convention: `capiro/dev/<NAME>`, no leading slash):
   ```bash
   aws secretsmanager create-secret --name capiro/dev/BEA_API_KEY --secret-string '<KEY>' --region us-east-1
   aws secretsmanager create-secret --name capiro/dev/OPENSTATES_API_KEY --secret-string '<KEY>' --region us-east-1
   ```
3. Wire each into its task def's container `secrets` (`valueFrom` = secret ARN). **Do it in `infra/cdk`** (durable); a manual task-def revision gives immediate effect but is overwritten on next `cdk deploy`.
4. Re-run `tsx scripts/preflight-ingestion.ts` — it should report both keys present.

---

## 4. Root cause C — FARA is shallow by source design (not a config bug)

`sync-fara` runs cleanly but the feed (`efile.fara.gov/api/v1/Registrants/json/Active`) returns only the **561 active registrants** and no foreign-principal/country/termination data (the script stores sentinels and never clobbers existing enrichment). This is a **source limitation, not a failure.**

To deepen (foreign principals, countries, short-form/supplemental, terminated history) — a **build, not config**:
- Add a per-registrant enrichment pass over the FARA eFile documents (one call per registrant; rate-limit; the WAF UA spoof is already in place), **or** ingest the FARA bulk dataset (active registrant + foreign-principal exhibits).
- Upsert into `fara_registration`, preserving the sentinel-skip logic. Scope/estimate separately; this is the largest of the five.

---

## 5. Root cause D — federal_award peCode sparse (227 / 10,052)

Best-effort extraction + a 31-entry curated acq-program→PE map. Highest-leverage **unmapped** programs by award count (from `report-award-pe-coverage`): `CAA`/MDA SUPPORT (56), DDG 51 (10), NSSL (10), TACTICAL UAV (8), P-8A (8), AEGIS (7), H-1 UPGRADES (7), BRADLEY FVS (6), MDS (6), MQ-4C TRITON (6), DHMSM (5), CVN 68 (5), CH-47F (5), NAVSTAR GPS (5), CH-53K (5), MQ-1C GRAY EAGLE (5), JDAM (5), PATRIOT P3I (5), SDB II (4), AIM-9X (4).

1. Add these programs (with verified PE codes from J-books) to `CURATED` in `apps/api/scripts/seed-acq-program-map.ts`.
2. `tsx scripts/seed-acq-program-map.ts --commit` (idempotent; validates PEs exist).
3. `tsx scripts/enrich-award-pe.ts --refresh` (re-resolve PE for awards that have an acq code; `--refresh` re-processes existing rows).
4. Optional deeper backfill: `tsx scripts/sync-federal-award.ts --backfill --since 2020-10-01` (cap 1000 pages / 100k).
5. Re-run `tsx scripts/report-award-pe-coverage.ts` to measure lift.
- **Structural ceiling:** the curated map only goes so far. The **TAS + Program-Activity crosswalk** (Tier A) in `.hermes/plans/pe-contractor-linkage.md` is the higher-coverage path — fold it in here.

---

## 6. Sequencing & verification

1. **A.1** reproduce grants launch failure → fix per result (IAM `PassRole` in CDK, or task-def issue).
2. **B** add `BEA_API_KEY` + `OPENSTATES_API_KEY` secrets → wire into task defs (CDK).
3. Re-run all three (manual `run-task`, or wait for the next scheduled fire) → confirm rows land + logs are clean.
4. **D** grow PE map → `seed --commit` → `enrich-award-pe --refresh` → re-measure.
5. **C** FARA depth — separate build.

**Verify:** re-run `diag-ingestion-health` + `report-award-pe-coverage` (one-off `run-task` on the dedicated diag task defs) and confirm: `federal_grant` > 0, `state_bill` > 0, `bea_data` > 0, and `withResolvedPeCode` climbs from 227.

## Notes
- Make durable fixes in **`infra/cdk`** (invoker-role PassRole, task-def secrets). Manual task-def revisions / secret wiring give immediate effect but are overwritten on the next `cdk deploy` — coordinate with the deploy procedure.
- The `tsx`/`TMPDIR` crash seen elsewhere affects only the **server** task def (`capiro-dev-api`, which sets `TMPDIR=/app/tmp`) for ad-hoc `tsx` commands — **not** these scheduled sync task defs (they run `tsx` fine; proven by clean `rss-intel`/`fara` logs). Unrelated to these gaps.
- Volume caps once running: grants 10k rows/run (100 pages); openstates cycles 10 states/run by day-of-month + bills updated in last 30 days (full coverage builds over ~6 weekly runs); BEA fetches 4 curated tables (2020–2025).
