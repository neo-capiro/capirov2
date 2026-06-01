# Capiro Ingestion — Out-of-Band Deploy Runbook (data flowing WITHOUT CDK)

> Status: 2026-06-01. The CDK scheduler (40 EventBridge rules in `Capiro-dev-Compute`)
> is committed (b48a220) and synth-clean, but **cannot be deployed yet** — the
> CloudFormation stack `Capiro-dev-Compute` is in `UPDATE_ROLLBACK_FAILED`
> (see infra/cdk/DRIFT-FINDINGS.md). My new embed-backfill resources are literally
> among the 14 wedged resources. Adding more CDK to this stack is what's stuck.
>
> This runbook gets data flowing NOW via the proven out-of-band pattern (the same
> one used for the SAM.gov key), with ZERO changes to the frozen CFN stack. When
> the stack is later remediated (DRIFT-FINDINGS Steps A–D), the committed CDK
> scheduler adopts these same jobs into CloudFormation — same design, no rework.

Account: 967807252336 · Region: us-east-1 · Cluster: `capiro-dev` (serves app.capiro.ai)
Container name in task defs: **`api`** · Out-of-band secret naming: `capiro/dev/<name>` (NO leading slash).

================================================================
## Architecture (out-of-band)
================================================================
- ONE out-of-band ECS task definition `capiro-dev-api-sync` (clone of the live
  `capiro-dev-api-migrate` td — same image, DB secrets, exec role, subnets/SG).
  Command is overridden per invocation to the kebab job name from entrypoint.sh.
- EventBridge **Scheduler** schedules (NOT EventBridge Rules in the CFN stack) —
  created via `aws scheduler create-schedule`. These live OUTSIDE CloudFormation,
  so they don't touch the frozen stack. One schedule per job, cadence from the
  schedule matrix (docs/plans/2026-06-01-...-schedule-matrix.md).
- Each schedule targets `ecs:RunTask` on the cluster with a containerOverride
  command. A dedicated scheduler-invoke IAM role grants ecs:RunTask + iam:PassRole.

================================================================
## PRE-FLIGHT (read-only checks — do all before any write)
================================================================
```bash
# 1. App is healthy (don't touch anything if it isn't)
curl -s -o /dev/null -w '%{http_code}\n' https://app.capiro.ai          # expect 200

# 2. Required API keys exist as secrets (ingestion fails without these)
for s in capiro/dev/govinfo-api-key capiro/dev/sam-gov-api-key; do
  MSYS_NO_PATHCONV=1 aws secretsmanager describe-secret --secret-id "$s" \
    --query 'ARN' --output text 2>&1 || echo "MISSING: $s"
done
# (Embeddings use the task role for Bedrock — no key. OpenAI/Anthropic for briefings:
#  confirm capiro/dev/openai-api-key / capiro/dev/anthropic-api-key if those jobs run.)

# 3. Capture the live migrate task def + networking to clone from
MSYS_NO_PATHCONV=1 aws ecs describe-task-definition \
  --task-definition capiro-dev-api-migrate \
  --query 'taskDefinition' --output json > /tmp/migrate-td.json

# 4. Subnets + security group the live API service uses (sync tasks must match)
MSYS_NO_PATHCONV=1 aws ecs describe-services --cluster capiro-dev \
  --services <api-service-name> \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' --output json
# -> note subnets[] (PRIVATE_WITH_EGRESS) + securityGroups[]
```
STOP if app.capiro.ai is not 200, or if GOVINFO/SAM keys are MISSING (create them
first: `aws secretsmanager create-secret --name capiro/dev/<name> ...`).

================================================================
## STEP 1 — Register the out-of-band sync task definition
================================================================
Clone the migrate td, rename family to `capiro-dev-api-sync`, keep container name
`api`, image `:latest`, the DB_* secrets + exec/task roles. Strip read-only fields.

```bash
python - <<'PY'
import json
td = json.load(open('/tmp/migrate-td.json'))
for k in ('taskDefinitionArn','revision','status','requiresAttributes',
          'compatibilities','registeredAt','registeredBy'):
    td.pop(k, None)
td['family'] = 'capiro-dev-api-sync'
# default command is overridden per schedule; leave migrate's or set a no-op
json.dump(td, open('/tmp/sync-td.json','w'), indent=2)
print('container names:', [c['name'] for c in td['containerDefinitions']])
PY

MSYS_NO_PATHCONV=1 aws ecs register-task-definition \
  --cli-input-json file:///tmp/sync-td.json \
  --query 'taskDefinition.taskDefinitionArn' --output text
# -> arn:aws:ecs:...:task-definition/capiro-dev-api-sync:1   (pin this revision)
```

### Smoke-test ONE job manually before scheduling anything
```bash
MSYS_NO_PATHCONV=1 aws ecs run-task \
  --cluster capiro-dev \
  --launch-type FARGATE \
  --task-definition capiro-dev-api-sync:1 \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet-a>,<subnet-b>],securityGroups=[<sg>],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["sync-congress"]}]}' \
  --query 'tasks[0].taskArn' --output text
# Tail logs (api-migrate log group, stream prefix per the td) and confirm rows land:
#   SELECT COUNT(*) FROM congress_bill;   -> > 0
#   SELECT * FROM sync_run ORDER BY started_at DESC LIMIT 3;  -> status='success'
```
If this works, the whole pipeline works (every other job is the same task def +
a different command). If it fails: read the SyncRun error_message + CloudWatch.

================================================================
## STEP 2 — IAM role for EventBridge Scheduler to run tasks
================================================================
```bash
cat > /tmp/sched-trust.json <<'JSON'
{ "Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
MSYS_NO_PATHCONV=1 aws iam create-role \
  --role-name capiro-dev-ingestion-scheduler \
  --assume-role-policy-document file:///tmp/sched-trust.json

cat > /tmp/sched-policy.json <<'JSON'
{ "Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":"ecs:RunTask","Resource":"arn:aws:ecs:us-east-1:967807252336:task-definition/capiro-dev-api-sync:*"},
  {"Effect":"Allow","Action":"iam:PassRole","Resource":["<execRoleArn>","<taskRoleArn>"]}
]}
JSON
MSYS_NO_PATHCONV=1 aws iam put-role-policy \
  --role-name capiro-dev-ingestion-scheduler \
  --policy-name run-sync-tasks --policy-document file:///tmp/sched-policy.json
```
(execRoleArn / taskRoleArn come from /tmp/sync-td.json: executionRoleArn / taskRoleArn.)

================================================================
## STEP 3 — Create the schedules (one per job, cadence = schedule matrix)
================================================================
Use the generator — it emits all 39 `aws scheduler create-schedule` calls
straight from `infra/cdk/lib/ingestion-schedule.ts` so the out-of-band schedules
can never drift from the (future) CDK ones:

```bash
cd infra/cdk
# generate (tsx via the pnpm store binary):
TSXCLI=$(ls ../../node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs | head -1)
node "$TSXCLI" scripts/gen-ingestion-schedules.ts > /tmp/create-ingestion-schedules.sh

# review the crons first (no AWS calls):
CLUSTER_ARN=x TD_ARN=x SCHED_ROLE_ARN=x SUBNETS='[]' SG='[]' DRY_RUN=1 \
  bash /tmp/create-ingestion-schedules.sh

# then create them for real (fill in the real ARNs/subnets/SG from pre-flight):
export CLUSTER_ARN=arn:aws:ecs:us-east-1:967807252336:cluster/capiro-dev
export TD_ARN=arn:aws:ecs:us-east-1:967807252336:task-definition/capiro-dev-api-sync:1
export SCHED_ROLE_ARN=arn:aws:iam::967807252336:role/capiro-dev-ingestion-scheduler
export SUBNETS='["<subnet-a>","<subnet-b>"]'   # PRIVATE_WITH_EGRESS, from pre-flight
export SG='["<sg>"]'                            # the API service security group
bash /tmp/create-ingestion-schedules.sh
```
The generator mirrors the CDK construct's cron-field resolution exactly (daily
`cron(min hr * * ? *)`, weekly `cron(min hr ? * MON *)`, monthly
`cron(min hr 1 * ? *)`), so the out-of-band and future CDK schedules are
identical. embed-backfill (`--source all`, 13:00 UTC) is created separately —
add one more `create_sched embed-backfill-daily 'cron(0 13 * * ? *)'
'["embed-backfill","--source","all"]' '...'` or run the CDK embed rule later.

Manual single-job form (if you prefer not to use the generator):

```bash
SUBNETS='["<subnet-a>","<subnet-b>"]'; SG='["<sg>"]'
CLUSTER_ARN=arn:aws:ecs:us-east-1:967807252336:cluster/capiro-dev
TD_ARN=arn:aws:ecs:us-east-1:967807252336:task-definition/capiro-dev-api-sync:1
ROLE_ARN=arn:aws:iam::967807252336:role/capiro-dev-ingestion-scheduler

create_sched () {  # $1=name  $2=cron  $3=command-json-array
  MSYS_NO_PATHCONV=1 aws scheduler create-schedule \
    --name "capiro-dev-$1" \
    --schedule-expression "cron($2)" \
    --schedule-expression-timezone "UTC" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target '{
      "Arn":"'"$CLUSTER_ARN"'",
      "RoleArn":"'"$ROLE_ARN"'",
      "EcsParameters":{
        "TaskDefinitionArn":"'"$TD_ARN"'",
        "LaunchType":"FARGATE",
        "NetworkConfiguration":{"awsvpcConfiguration":{"Subnets":'"$SUBNETS"',"SecurityGroups":'"$SG"',"AssignPublicIp":"DISABLED"}}
      },
      "Input":"{\"containerOverrides\":[{\"name\":\"api\",\"command\":['"$3"']}]}"
    }'
}

# DAILY (UTC) — cron fields: min hr day-of-month month day-of-week year
create_sched sync-congress         "0 6 * * ? *"  '\"sync-congress\"'
create_sched sync-federal-register "15 6 * * ? *" '\"sync-federal-register\"'
# ... full list lives in infra/cdk/lib/ingestion-schedule.ts (use the generator)
```

> The exact cron + command for all 39 jobs is the source of truth in
> `infra/cdk/lib/ingestion-schedule.ts`. The generator
> `infra/cdk/scripts/gen-ingestion-schedules.ts` reads it directly so the
> out-of-band schedules and the future CDK schedules never drift.

================================================================
## STEP 4 — First backfill (optional, for IMMEDIATE data)
================================================================
Don't want to wait for the morning cron? Run the dependency-ordered backfill once
NOW via run-task (same td, sequential). Order (sources -> emitters -> embeddings):
```
sync-congress, sync-fec, sync-fec-pac, sync-federal-award, enrich-award-districts,
sync-census, sync-lda, sync-hearings, sync-gao, sync-crs, sync-federal-register,
sync-regulations, sync-openstates, sync-fara, sync-sec-edgar, sync-grants,
sync-openspending, sync-bea, sync-bls, sync-openlobby
  -> extract-bill-pe-codes, refresh-lobby-intel-mv, sync-lobby-trending
  -> emit-changes, emit-bill-alerts, check-comment-periods, compute-health-scores,
     generate-briefings, recompute-conference-probability
  -> embed-backfill --source all
```
Each is a `run-task` with the matching command override. PE parsers
(parse-hasc/sasc/ndaa/pdoc) are SKIPPED here — they need committed PDF artifacts.

================================================================
## VERIFY (data is flowing)
================================================================
```sql
-- per-source freshness + row counts (this is your ingestion dashboard until Phase 4)
SELECT source, status, rows_inserted, rows_updated, error_count, finished_at
FROM sync_run ORDER BY started_at DESC LIMIT 40;

-- spot-check the panels that were blank
SELECT COUNT(*) FROM congress_bill;        -- bills pipeline
SELECT COUNT(*) FROM fec_contribution;     -- FEC panel
SELECT COUNT(*) FROM federal_award;        -- district nexus
SELECT COUNT(*) FROM context_embeddings;   -- semantic search
```
App-side: open a client profile → FEC / bills / district nexus panels populate;
Clio "recent defense bills" returns results (was 0).

================================================================
## ROLLBACK / TEARDOWN
================================================================
```bash
# delete a schedule
MSYS_NO_PATHCONV=1 aws scheduler delete-schedule --name capiro-dev-sync-congress
# list all ingestion schedules
MSYS_NO_PATHCONV=1 aws scheduler list-schedules --name-prefix capiro-dev-sync
```
None of this touches the CFN stack, the ALB, Aurora, the cert, or running services.
Worst case a sync job errors → its SyncRun row is status='error' + the ingestion
alarm fires (once the metric filter exists); the app keeps serving normally.

================================================================
## LATER: adopt into CloudFormation (after DRIFT-FINDINGS Steps A–D)
================================================================
Once `Capiro-dev-Compute` is healthy (rollback unstuck, ALB reconciled, config.ts
fixed to live values, clean `cdk diff`), the committed CDK scheduler (commit
b48a220: ingestion-schedule.ts + ScheduledIngestionJobs + compute-stack rules)
becomes the managed version. Migration: delete the out-of-band `aws scheduler`
schedules, then `cdk deploy` so CFN owns the EventBridge rules. Same job names,
same crons, same task command — no behavioral change, just control-plane ownership.

KEYS REQUIRED (gating): GOVINFO_API_KEY (congress), SAM_GOV_API_KEY (sam personnel),
OPENAI/ANTHROPIC (briefings/clio), Bedrock via task role (embeddings).
