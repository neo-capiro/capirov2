#!/usr/bin/env bash
# Repoint the orphan `capiro-dev-emit-changes-daily` EventBridge rule from the dead
# EventsServiceRole (no ecs:RunTask / iam:PassRole) to the proven
# `capiro-dev-eventbridge-sync-invoker` role, restoring the multi-source Changes Inbox.
#
# Context + diagnosis: apps/api/reports/changes-inbox-emit-changes-role-2026-06-07.md
#
# SAFETY: dry-run by default. Backs up the current target before any change.
#   Preview:  bash apps/api/scripts/ops/fix-emit-changes-rule.sh
#   Apply:    APPLY=1 bash apps/api/scripts/ops/fix-emit-changes-rule.sh
#   Verify:   VERIFY=1 bash apps/api/scripts/ops/fix-emit-changes-rule.sh   # also runs the task once
set -euo pipefail
export MSYS_NO_PATHCONV=1

REGION="${REGION:-us-east-1}"
ACCOUNT="${ACCOUNT:-967807252336}"
RULE="capiro-dev-emit-changes-daily"
TARGET_ID="emit-changes-fargate-target"
CLUSTER_ARN="arn:aws:ecs:${REGION}:${ACCOUNT}:cluster/capiro-dev"
TD_ARN="arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/capiro-dev-api-emit-changes"
INVOKER_ROLE="arn:aws:iam::${ACCOUNT}:role/capiro-dev-eventbridge-sync-invoker"
SUBNETS='["subnet-0e38bd390f8961fef","subnet-0920665f91c905f01","subnet-06db79cd21239de19"]'
SG='["sg-01def4e5c0fe44d4a"]'
BACKUP="/tmp/emit-changes-target.before.$(date +%Y%m%dT%H%M%S).json"

echo "== current target (backup -> ${BACKUP}) =="
aws events list-targets-by-rule --rule "$RULE" --region "$REGION" | tee "$BACKUP"

TARGET_JSON='[{
  "Id": "'"$TARGET_ID"'",
  "Arn": "'"$CLUSTER_ARN"'",
  "RoleArn": "'"$INVOKER_ROLE"'",
  "EcsParameters": {
    "TaskDefinitionArn": "'"$TD_ARN"'",
    "TaskCount": 1, "LaunchType": "FARGATE", "PlatformVersion": "LATEST",
    "NetworkConfiguration": {"awsvpcConfiguration": {
      "Subnets": '"$SUBNETS"', "SecurityGroups": '"$SG"', "AssignPublicIp": "DISABLED"}}
  }
}]'

if [ "${APPLY:-0}" != "1" ] && [ "${VERIFY:-0}" != "1" ]; then
  echo
  echo "[dry-run] would put-targets RoleArn -> ${INVOKER_ROLE}"
  echo "[dry-run] re-run with APPLY=1 to apply (VERIFY=1 also runs the task once)."
  exit 0
fi

echo "== applying new RoleArn =="
aws events put-targets --rule "$RULE" --region "$REGION" --targets "$TARGET_JSON"
echo "== put-targets done. new target: =="
aws events list-targets-by-rule --rule "$RULE" --region "$REGION" \
  --query 'Targets[0].{Id:Id,Role:RoleArn,TD:EcsParameters.TaskDefinitionArn}'

if [ "${VERIFY:-0}" = "1" ]; then
  echo "== verify: launching emit-changes once via the same FARGATE path =="
  aws ecs run-task --cluster capiro-dev --launch-type FARGATE \
    --task-definition capiro-dev-api-emit-changes --region "$REGION" \
    --network-configuration "awsvpcConfiguration={subnets=[subnet-0e38bd390f8961fef,subnet-0920665f91c905f01,subnet-06db79cd21239de19],securityGroups=[sg-01def4e5c0fe44d4a],assignPublicIp=DISABLED}" \
    --query 'tasks[0].taskArn' --output text
  echo "Wait ~1-2 min, then confirm new rows:"
  echo "  SELECT change_type, source, count(*) FROM intelligence_change"
  echo "    WHERE detected_at >= now() - interval '1 hour' GROUP BY 1,2 ORDER BY 3 DESC;"
fi

echo "Rollback if needed: aws events put-targets --rule ${RULE} --region ${REGION} --targets file://${BACKUP}#Targets"
