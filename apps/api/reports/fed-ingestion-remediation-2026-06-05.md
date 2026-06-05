# Federal Ingestion Remediation — Execution Record (2026-06-05)

Companion to `.hermes/plans/fed-data-ingestion-fixes.md`. Documents what was found
(verified live against prod, account 967807252336, cluster `capiro-dev`), what was
changed out-of-band, the code changes in this branch (`fix/fed-data-ingestion`),
and what remains.

> **Why out-of-band:** the `Capiro-dev-Compute` CFN stack is frozen in
> `UPDATE_ROLLBACK_FAILED` (see `infra/cdk/DRIFT-FINDINGS.md`) — `cdk deploy` is
> unsafe. The live scheduled-ingestion plumbing (per-job task defs + classic
> EventBridge rules + the `capiro-dev-eventbridge-sync-invoker` role) was created
> out-of-band and is **not** modelled by the repo CDK. So every live fix below is
> an out-of-band API change; the **Maintenance-window CDK TODO** section records
> what to fold back into `infra/cdk` when the stack is unstuck.

## Corrected diagnosis (vs. the original plan)

| Area | Plan assumed | Verified reality (2026-06-05) |
|---|---|---|
| **A** grants/bea/openstates "never launch" | Needs an IAM `PassRole` fix in CDK | The invoker role's `iam:PassRole` on `…ApiMigrateTaskDefExecutionRoleEB-HuOMLdmYvwnx` was **already added 06-04 17:51 UTC** (`capirocli` `PutRolePolicy`), *after* the 06-04 10:00 failure the plan cited. CloudTrail at 06-04 10:00 shows the exact error: `AccessDenied … iam:PassRole`. Post-fix, `simulate-principal-policy` returns `allowed` for PassRole + RunTask. **A was resolved before this session began.** |
| (A nuance) | "fara runs clean on schedule" | False — fara's *scheduled* rule also failed (FailedInvocations on 05-31). fara has 561 rows only because it was run **manually**. Same root cause; manual runs masked it. |
| **B** bea/openstates lack keys | Sign up + create secrets | Secrets `capiro/dev/bea_api_key` + `capiro/dev/openstates_api_key` **already exist with real values**. The gap was (1) the secret was **not wired into the task-def env**, and (2) the exec role's `SyncTaskApiKeys` policy didn't grant read on them. No signup needed. |
| **grants** data | (n/a — assumed launch was the only issue) | After A, grants launches but returns **0 rows**: `sync-grants.ts` read top-level `oppHits`; grants.gov `search2` nests them under `data.oppHits` (1,899 available). **Code bug.** |
| **openstates** data | (n/a) | After A+B, openstates launches but every request 400s: `per_page=100`/`200` exceed OpenStates v3's max of **20**. **Code bug.** |
| **bea** data | (n/a) | After A+B, bea launches but BEA API returns `APIErrorCode 4: This UserId is not active`. The stored key is a valid GUID but **never activated**. **External action required.** |
| **D** peCode sparse | Add to map → seed | `program_element` holds only **1,154** PEs; map rows already-present codes (NSSL 176, P-8A 334) skip because their PEs aren't loaded. Map growth is gated by PE ingestion, not the map. |

Baselines (prod, read-only via `report-award-pe-coverage` / `diag-ingestion-health`):
`federal_award` 10,052 (1,946 with acq code, **227** resolved peCode, 31 map rows / 30 PEs);
`federal_grant`, `state_bill`, `bea_data` = **0**.

## Out-of-band changes APPLIED live (this session)

1. **Exec-role secret read (B, prerequisite).** Added inline policy `SyncTaskApiKeysExtra`
   to `Capiro-dev-Compute-ApiMigrateTaskDefExecutionRoleEB-HuOMLdmYvwnx` granting
   `secretsmanager:GetSecretValue|DescribeSecret` on `capiro/dev/bea_api_key*` and
   `capiro/dev/openstates_api_key*`. (Isolated new policy — does not touch the existing
   `SyncTaskApiKeys` or the CFN-managed `…DefaultPolicy`. Reversible: `delete-role-policy`.)
   Verified `allowed` via `simulate-principal-policy`.
2. **Task-def key wiring (B).** Registered `capiro-dev-api-sync-bea:3` and
   `capiro-dev-api-sync-openstates:3`, cloning rev 2 and adding a `secrets` entry
   (`BEA_API_KEY` → bea secret ARN; `OPENSTATES_API_KEY` → openstates secret ARN).
   The EventBridge rules reference the **unversioned** family ARN, so the new revision
   is auto-adopted on the next fire — no rule edit needed.
3. **Sync runs (verification).** Ran grants/bea/openstates via `ecs run-task`; all exited 0
   (proving A fixed + B keys injected — no more hard-throw). Their 0-row results surfaced the
   grants/openstates code bugs and the inactive BEA key (above).

## Code changes in this branch (`fix/fed-data-ingestion`)

- `apps/api/scripts/sync-grants.ts` — read `data.oppHits` (the grants.gov `data` envelope);
  robust agency string/object handling; log `hitCount`.
- `apps/api/scripts/sync-openstates.ts` — `per_page=20` (API max) with a `fetchAllPages`
  helper that walks pages for both `/bills` and `/people` (also fixes the latent
  "only page 1 ever fetched" bug).
- `apps/api/src/ingestion/fara-enrichment.ts` (+ `.spec.ts`, 17 tests) — FARA foreign-principal
  enrichment engine (parse JSON/CSV bulk feed → group per registration → merge, preserving the
  sentinel so real values are never clobbered without `--force`).
- `apps/api/scripts/sync-fara-enrichment.ts` — orchestrator (fetch `FARA_FP_SOURCE_URL` → upsert).
- `apps/api/scripts/entrypoint.sh` — `sync-fara-enrichment` dispatch case.
- `infra/cdk/lib/ingestion-schedule.ts` — `SyncFaraEnrichment` weekly job (Mon 06:20, after FARA).
- `apps/api/scripts/seed-acq-program-map.ts` — +12 topUnmapped programs (PATRIOT P3I is a
  guaranteed hit; others land as their PEs are ingested — validated/skipped at seed time).

## Remaining

- **Deploy the code fixes**: the sync scripts run from the deployed `:latest` image, so grants/openstates
  won't populate until a new API image ships (see the deploy procedure — manual buildx → ECR). A one-off
  image tag + a `capiro-dev-api-migrate`-style task def can run them isolated from the `:latest` service.
- **BEA key (external)**: activate `capiro/dev/bea_api_key` (BEA emails an activation link on signup) or
  replace it with an activated key. Wiring is done — bea will populate on the next run once the key is live.
- **FARA enrichment source**: set `FARA_FP_SOURCE_URL` to a FARA bulk foreign-principals export (the eFile
  JSON API only serves the active-registrant directory; every other `/api/v1` path 404s). The engine is
  built + tested; it no-ops cleanly until a source is configured.

## Maintenance-window CDK TODO (when `Capiro-dev-Compute` is unstuck)

- Model the out-of-band scheduled-ingestion setup in CDK (per-job task defs OR the shared-task-def
  `ScheduledIngestionJobs` construct), including the `capiro-dev-eventbridge-sync-invoker` role with
  `iam:PassRole` covering **both** the task role and the ApiMigrate exec role.
- Fold `SyncTaskApiKeysExtra` (bea/openstates secret read) into the exec role's managed policy, and add
  `BEA_API_KEY`/`OPENSTATES_API_KEY` (and any other `capiro/dev/*_api_key`) to the task-def `secrets`.
- Note: the live api-key secrets (`capiro/dev/*_api_key`, no leading slash) are out-of-band and are **not**
  in `SecretsStack`; importing them (vs. re-creating) is required to avoid a create-conflict on deploy.
