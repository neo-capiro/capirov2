# Changes Inbox / "Needs Attention" regression — emit-changes EventBridge role (2026-06-07)

## Symptom
The dashboard **"Needs Attention"** and the **Changes Inbox** used to surface alerts
from many sources (bills, GAO, hearings, FEC, grants, intel articles). They now show
effectively **only comment-deadline alerts**.

## Diagnosis (verified against prod, read-only)
Not a UI or query bug. `getChanges()` (intelligence.service.ts) and the Changes Inbox
UI are correct — they return every source. The regression is in the **change-emitter
pipeline**: the `IntelligenceChange` table is 99.7% one change type.

`intelligence_change` content (prod, 2026-06-07):
- `comment_deadline_approaching` / `federal_register` — **9,559** rows (6,757 in last 7d). ← the "only comments"
- `bill_reported`/`bill_enacted` / `congress_bill` — 26 rows, **0 in last 7d** (newest 2026-05-29).
- `new_data` from gao_report / committee_hearing / fec_contribution / state_bill /
  federal_register_document / intel_article / federal_grant — **exactly 1 row each, all
  emitted at the same instant 2026-06-05 16:26** (a single manual `emit-changes` run).

`sync_run` confirms: **`emit-changes` has run exactly once, ever** (2026-06-05 16:26,
`completed`, 7 rows) — a manual `ecs run-task`, never a scheduled fire.

### Root cause
The only live EventBridge rule for any Tier-5 derived emitter is
**`capiro-dev-emit-changes-daily`** (`cron(0 9 * * ? *)`, ENABLED). Its target is wired
to the IAM role **`CapiroApi-EventsServiceRoleBA0179C6-ExTA0Tld4gab`**, whose inline
policy grants only Secrets/S3/SQS/Bedrock — **no `ecs:RunTask`, no `iam:PassRole`**.
So every daily fire is denied by ECS at launch: no task starts, no SyncRun row, no error
surfaced (FailedInvocations only). This is the **same class of bug** the 2026-06-05
remediation fixed for the source syncs (wrong/under-privileged role on an out-of-band
rule) — `emit-changes-daily` was simply missed, because it is an **orphan rule** created
out-of-band before the `INGESTION_JOBS` matrix existed (legacy name `-daily`, legacy
role; untagged, not modelled by CDK; distinct from the matrix's `EmitChanges` job which
has never been created live).

The working source rules (e.g. `capiro-dev-sync-gao`) use role
**`capiro-dev-eventbridge-sync-invoker`**, which grants `ecs:RunTask` on
`capiro-dev-api-*` + `iam:PassRole` on the task + exec roles. The `emit-changes` task def
(`capiro-dev-api-emit-changes`) uses exec role `…ApiTaskDefExecutionRoleE6ABB053` and
task role `…ApiTaskRole12FAD4A7` — **both already covered** by the invoker role's
PassRole. So repointing the rule's role is sufficient; no IAM change needed.

> Bigger context: of all Tier-5 derived jobs (emit-changes, emit-bill-alerts,
> check-comment-periods, compute-health-scores, generate-briefings, extract-bill-pe-codes,
> …), **only `emit-changes-daily` has a live rule at all** — and it's the broken one. The
> rest of the derived tier is not scheduled live. See the CDK TODO below.

## Fix — out-of-band live remediation (APPLY in maintenance window; not applied here)
> Per the 2026-06-05 runbook, `Capiro-dev-Compute` is frozen in `UPDATE_ROLLBACK_FAILED`,
> so the live system is fixed via API and recorded here. **This was authored on branch
> `fix/emit-changes-eventbridge-role` and intentionally NOT applied to AWS** — apply when ready.

Repoint the `emit-changes-daily` rule's target role to the working invoker role (the
target's task def, network config, and command are otherwise already correct):

```bash
# 1) Capture the current target (audit / rollback reference)
aws events list-targets-by-rule --rule capiro-dev-emit-changes-daily --region us-east-1 \
  > /tmp/emit-changes-target.before.json

# 2) Repoint RoleArn to the proven invoker role. Re-send the SAME target with only RoleArn changed.
#    (Target Id must be preserved: "emit-changes-fargate-target".)
aws events put-targets --rule capiro-dev-emit-changes-daily --region us-east-1 --targets '[{
  "Id": "emit-changes-fargate-target",
  "Arn": "arn:aws:ecs:us-east-1:967807252336:cluster/capiro-dev",
  "RoleArn": "arn:aws:iam::967807252336:role/capiro-dev-eventbridge-sync-invoker",
  "EcsParameters": {
    "TaskDefinitionArn": "arn:aws:ecs:us-east-1:967807252336:task-definition/capiro-dev-api-emit-changes",
    "TaskCount": 1, "LaunchType": "FARGATE", "PlatformVersion": "LATEST",
    "NetworkConfiguration": {"awsvpcConfiguration": {
      "Subnets": ["subnet-0e38bd390f8961fef","subnet-0920665f91c905f01","subnet-06db79cd21239de19"],
      "SecurityGroups": ["sg-01def4e5c0fe44d4a"], "AssignPublicIp": "DISABLED"}}
  }
}]'

# 3) Verify end-to-end now (don't wait for 09:00 UTC): launch the task via the same path.
aws ecs run-task --cluster capiro-dev --launch-type FARGATE \
  --task-definition capiro-dev-api-emit-changes --region us-east-1 \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-0e38bd390f8961fef,subnet-0920665f91c905f01,subnet-06db79cd21239de19],securityGroups=[sg-01def4e5c0fe44d4a],assignPublicIp=DISABLED}'

# 4) Confirm: new multi-source rows appear and a SyncRun is recorded.
#    SELECT change_type, source, count(*) FROM intelligence_change
#      WHERE detected_at >= now() - interval '1 hour' GROUP BY 1,2;
#    Expect bill_*/new_data rows across congress_bill, gao_report, committee_hearing, etc.
```

Rollback: `aws events put-targets` with the captured `…before.json` (or just the old RoleArn).

## Maintenance-window CDK TODO (when `Capiro-dev-Compute` is unstuck) — addendum
- **Delete the orphan `capiro-dev-emit-changes-daily` EventBridge *rule*.** It is legacy,
  untagged, on the dead `EventsServiceRole`, and duplicates the matrix `EmitChanges` job.
  Leaving it risks a second silently-failing rule after the matrix rules are created.
- **Model the full Tier-5 derived tier** (`emit-changes`, `emit-bill-alerts`,
  `check-comment-periods`, `compute-health-scores`, `generate-briefings`,
  `extract-bill-pe-codes`, `refresh-lobby-intel-mv`, `recompute-conference-probability`)
  as scheduled jobs using the **`capiro-dev-eventbridge-sync-invoker` role** — same as the
  source syncs. They are already declared in `infra/cdk/lib/ingestion-schedule.ts`
  (`INGESTION_JOBS`, tier `derived`); only the live rules are missing. Today only
  `emit-changes-daily` exists live and it's the broken orphan, so the derived tier has
  effectively never run on schedule.
- Until the CFN stack is unstuck, the live system must be created/maintained out-of-band
  (EventBridge rules + invoker role), per the 2026-06-05 runbook pattern.
