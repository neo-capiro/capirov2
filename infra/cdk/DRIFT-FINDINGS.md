# Capiro-dev-Compute — CloudFormation Drift Findings & Remediation Runbook

> Status as of 2026-06-01. Investigation by Hermes (read-only). **No remediation
> has been applied.** This document is the playbook for a future planned
> maintenance window.

## TL;DR

- The **data plane is healthy**: `app.capiro.ai` serves 200s, API (2/2) + web (1/1)
  ECS tasks HEALTHY, ALB `capiro-prod-alb` active, Aurora at 35-day backup / 4 MaxACU.
  **Nothing user-facing is broken.**
- The **control plane is stuck**: CloudFormation stack `Capiro-dev-Compute` is in
  **`UPDATE_ROLLBACK_FAILED`** and has been since **2026-05-27 03:09 UTC**
  (an earlier wobble occurred 2026-05-05).
- **Do NOT run `cdk deploy Capiro-dev-Compute`** until the steps below are done.
  A deploy from this state will fail, and even once unstuck the current repo config
  would attempt **destructive** changes (ALB/cert replacement, Aurora shrink).
- **Keep shipping via out-of-band ECS task-def revisions** (the approach used for the
  SAM.gov key — clone live task def, edit JSON, `register-task-definition`, run by
  pinned revision). This is the proven safe path while the stack is frozen.

---

## Root cause (three stacked problems)

### 1. Stack is hard-stuck in UPDATE_ROLLBACK_FAILED
A `cdk deploy` on **2026-05-27 03:08:51 UTC** ("User Initiated") attempted to:
- **Add a Clio runtime**: EFS file system, 3 security groups, 2 IAM roles, log group,
  and a ServiceDiscovery PrivateDnsNamespace.
- **Update the ALB listener rules** (`AlbHttpsApiPathsRule`, `AlbHttpsWebDefaultRule`).

The ALB listener-rule update failed first:
```
AlbHttpsApiPathsRule6E83568D  UPDATE_FAILED
  "All rules were not found (ElasticLoadBalancingV2, 400)"
AlbHttpsWebDefaultRule11F4E7A3 UPDATE_FAILED
  Rule 'arn:aws:elasticloadbalancing:...:listener-rule/app/Capiro-Alb16-PWSBu59pPfLj/...' not found
```
The update was rolled back, but the **rollback also failed** (03:09:01) because the
DNS alias records could no longer resolve the load balancer:
```
AppAlias375015D0 / AppWildcardAlias7B653A1B  UPDATE_FAILED
  "Unable to retrieve CanonicalHostedZoneID ... One or more load balancers not found"
```
→ stack landed in `UPDATE_ROLLBACK_FAILED`. CloudFormation refuses all further
updates from this state.

### 2. The ALB CFN manages is a phantom — the live ALB was replaced out-of-band
- CFN's stack references an ALB it expected to be named **`Capiro-Alb16-PWSBu59pPfLj`**.
- The **only ALB in the account** is **`capiro-prod-alb`** (active), created/renamed
  out-of-band:
  - ARN: `arn:aws:elasticloadbalancing:us-east-1:967807252336:loadbalancer/app/capiro-prod-alb/7a4acb332b261724`
  - DNS: `capiro-prod-alb-57164953.us-east-1.elb.amazonaws.com`
  - CanonicalHostedZoneId: `Z35SXDOTRQ7X7K`
- So the control plane (CFN) and data plane (real infra) have fully diverged on the ALB.
  This is the proximate cause of the failed update.

### 3. The repo `dev` config was authored for a DIFFERENT account + domain scheme
Introduced by commit **`9f9cfc6` "Wire dev environment for the wrong AWS account"**.
The repo's `dev` override block (`infra/cdk/lib/config.ts`) currently sets:
| Setting | Repo (config.ts dev block) | Live reality |
|---|---|---|
| appHost | `app-dev.capiro.ai` | `app.capiro.ai` |
| wildcardHost | `*.app-dev.capiro.ai` | `*.app.capiro.ai` |
| rootDomain | `app-dev.capiro.ai` | `capiro.ai` |
| auroraBackupRetentionDays | `7` | `35` |
| auroraMaxAcu | `2` | `4` |

A `cdk diff` against the live account therefore shows these as **requires-replacement**
(ACM cert + DNS) and **shrink** (Aurora) changes. That commit targeted a
**wrong/legacy** account (the GHA OIDC role ARNs previously pointed there too —
now corrected to `967807252336`); the live cluster is in
**`967807252336`**. So even after unsticking the stack, deploying the current repo
config would try to swap the cert/domain (**breaking `app.capiro.ai`**) and shrink Aurora.

---

## The 14 stuck resources
From `aws cloudformation list-stack-resources --stack-name Capiro-dev-Compute`
(status != *_COMPLETE):

| Logical ID | Type | Status |
|---|---|---|
| AlbHttpsApiPathsRule6E83568D | ELBv2::ListenerRule | UPDATE_FAILED |
| AlbHttpsWebDefaultRule11F4E7A3 | ELBv2::ListenerRule | UPDATE_FAILED |
| ApiTaskDefExecutionRoleDefaultPolicy358EAD94 | IAM::Policy | UPDATE_FAILED |
| ApiTaskRoleDefaultPolicyBEF5D530 | IAM::Policy | UPDATE_FAILED |
| ApiEmbedBackfillLogsF4C5E74F | Logs::LogGroup | CREATE_FAILED |
| ApiEmbedBackfillTaskDefExecutionRoleAFB54A52 | IAM::Role | CREATE_FAILED |
| ApiToClioSg49C620F9 | EC2::SecurityGroup | CREATE_FAILED |
| ClioEfsSgAD30305E | EC2::SecurityGroup | CREATE_FAILED |
| ClioFileSystemB056AD1B | EFS::FileSystem | CREATE_FAILED |
| ClioRuntimeLogsC2BA0C8C | Logs::LogGroup | CREATE_FAILED |
| ClioRuntimeSg41FFBA34 | EC2::SecurityGroup | CREATE_FAILED |
| ClioRuntimeTaskDefExecutionRole870A22B3 | IAM::Role | CREATE_FAILED |
| ClioRuntimeTaskRole3F7C90F0 | IAM::Role | CREATE_FAILED |
| ClusterDefaultServiceDiscoveryNamespaceC336F9B4 | ServiceDiscovery::PrivateDnsNamespace | CREATE_FAILED |

---

## Remediation runbook (PLANNED WINDOW ONLY — eyes-on, with rollback plan)

> Pre-flight: snapshot Aurora, confirm app.capiro.ai serving 200s, have the
> `capiro-prod-alb` ARN + listener ARNs handy, and a second operator watching.
> Do steps in order; stop and reassess if any output is unexpected.

### Step A — Unstick the rollback (low risk, no live-infra change)
Skip the 14 wedged resources so CFN can reach a terminal `UPDATE_ROLLBACK_COMPLETE`.
The CREATE_FAILED Clio/embed resources never finished creating, so skipping them just
drops the phantom create. The UPDATE_FAILED ALB rules / IAM policies stay as-is in
the template (we reconcile in B/C).

```bash
MSYS_NO_PATHCONV=1 aws cloudformation continue-update-rollback \
  --stack-name Capiro-dev-Compute \
  --resources-to-skip \
    AlbHttpsApiPathsRule6E83568D \
    AlbHttpsWebDefaultRule11F4E7A3 \
    ApiTaskDefExecutionRoleDefaultPolicy358EAD94 \
    ApiTaskRoleDefaultPolicyBEF5D530 \
    ApiEmbedBackfillLogsF4C5E74F \
    ApiEmbedBackfillTaskDefExecutionRoleAFB54A52 \
    ApiToClioSg49C620F9 \
    ClioEfsSgAD30305E \
    ClioFileSystemB056AD1B \
    ClioRuntimeLogsC2BA0C8C \
    ClioRuntimeSg41FFBA34 \
    ClioRuntimeTaskDefExecutionRole870A22B3 \
    ClioRuntimeTaskRole3F7C90F0 \
    ClusterDefaultServiceDiscoveryNamespaceC336F9B4
# then poll until UPDATE_ROLLBACK_COMPLETE:
MSYS_NO_PATHCONV=1 aws cloudformation describe-stacks \
  --stack-name Capiro-dev-Compute --query 'Stacks[0].StackStatus' --output text
```
**Stop here if all you need is an updatable stack.** Do NOT deploy yet — B and C
must be done first or the next deploy is destructive.

### Step C — Fix the repo `dev` config to match reality (do BEFORE any deploy)
Edit `infra/cdk/lib/config.ts` dev override block so a future diff is a no-op on these:
- `appHost: 'app.capiro.ai'`
- `wildcardHost: '*.app.capiro.ai'`
- `rootDomain: 'capiro.ai'` (verify against what AppAlias/cert actually use)
- `auroraBackupRetentionDays: 35`
- `auroraMaxAcu: 4`
Also confirm the **account** the dev env deploys to is `967807252336`, not
the wrong/legacy account from the 9f9cfc6 commit. Pass `--context account=967807252336` or fix
the account resolution.

### Step B — Reconcile the ALB (the hard part)
The stack wants to own an ALB (`Capiro-Alb16-…`) that no longer exists; the live ALB
`capiro-prod-alb` was made out-of-band. Two viable paths:
1. **CDK lookup (preferred if the ALB should stay out-of-band):** change the CDK to
   reference the existing ALB via `ApplicationLoadBalancer.fromLookup()` / by ARN and
   attach listener rules to it, instead of `new ApplicationLoadBalancer(...)`. Then the
   stack stops trying to manage a phantom LB.
2. **CFN resource import:** import `capiro-prod-alb` + its listeners/rules into the
   stack so CFN's model matches reality.
Either way, `cdk diff` must come back **clean (no replacement)** on the ALB, listeners,
rules, AppAlias, and AppWildcardAlias before deploying.

### Step D — Verify, then one careful deploy
```bash
cd infra/cdk
npx cdk diff Capiro-dev-Compute -c env=dev -c account=967807252336
# iterate on B/C until diff shows NO requires-replacement and NO Aurora/cert/DNS changes
npx cdk deploy Capiro-dev-Compute -c env=dev -c account=967807252336
```
Post-deploy: confirm app.capiro.ai 200s, ECS tasks HEALTHY, Aurora unchanged
(35-day / 4 ACU), cert unchanged.

---

## Until the window: keep shipping out-of-band
Pattern (validated for SAM.gov key, 2026-06-01):
1. `aws ecs describe-task-definition --task-definition capiro-dev-api-migrate` → JSON.
2. Strip read-only fields; edit (add env/secret/etc.).
3. `aws ecs register-task-definition --cli-input-json file://...` → new revision.
4. Run by pinned revision (`capiro-dev-api-migrate:N`), container name is **`api`**.
Out-of-band secrets must be named `capiro/dev/<name>` (NO leading slash) to fall under
the exec role's `capiro/dev/*` grant; slash-path names are not covered and fail startup.
