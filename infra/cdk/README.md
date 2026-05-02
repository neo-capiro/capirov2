# Capiro infra/cdk

CDK app for Capiro AWS environments. One CDK app, one set of stacks per
environment (`dev`, `staging`, `prod`).

## Stacks

| Stack | Purpose |
|-------|---------|
| `Capiro-<env>-Network` | VPC across 3 AZs, public/private/isolated subnets, NAT, VPC endpoints (S3, ECR, Secrets Manager, KMS, CloudWatch Logs, STS), security groups, VPC flow logs. |
| `Capiro-<env>-Dns` | ACM certificate for `app.capiro.ai` + `*.app.capiro.ai`, DNS-validated against the existing `capiro.ai` hosted zone (looked up, not created). |
| `Capiro-<env>-Data` | Aurora Serverless v2 (Postgres 16) with `pgvector` + `pg_trgm` + `citext` + `uuid-ossp` preloaded, KMS CMK, master credential in Secrets Manager with 30-day rotation, PITR + 35-day backup retention. |
| `Capiro-<env>-Secrets` | Clerk secrets (placeholders the operator fills via `put-secret-value`), per-env CMK. |
| `Capiro-<env>-Compute` | ECS cluster (Container Insights), ECR repos for api+web (image scan on push, immutable tags), Fargate services for api+web, single ALB with HTTPS listener + path-based routing, Route 53 A/AAAA aliases for `app.capiro.ai` and `*.app.capiro.ai`, AWS WAF (managed common/bad-input/IP-reputation rules + per-IP rate limit), one-shot migration task definition. |

## First-time bootstrap

```bash
# 0. AWS credentials must be configured in your shell.
aws sts get-caller-identity   # confirm account id

# 1. Bootstrap CDK in this account/region (one time)
pnpm --filter @capiro/infra-cdk exec cdk bootstrap aws://<ACCOUNT_ID>/us-east-1

# 2. Synth (sanity-check the plan)
pnpm --filter @capiro/infra-cdk exec cdk synth \
  --context env=dev --context account=<ACCOUNT_ID>
```

## Deploy order

Stacks have explicit dependencies, so `cdk deploy --all` works. For the first
deploy, walking through each stack is safer:

```bash
CTX="--context env=dev --context account=<ACCOUNT_ID>"

# 1. Network — ~5 min
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Network $CTX

# 2. DNS — ACM cert; DNS validation is automatic since the hosted zone is in
#    this account. ~3 min for the cert to issue.
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Dns $CTX

# 3. Data — Aurora cluster comes up. ~10–15 min.
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Data $CTX

# 4. Secrets — Clerk placeholder secrets.
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Secrets $CTX

# 5. Fill the Clerk secrets BEFORE deploying Compute (the API task fails to
#    boot otherwise because it tries to verify against REPLACE_ME).
aws secretsmanager put-secret-value \
  --secret-id /capiro/dev/clerk/secret-key \
  --secret-string sk_live_xxxxxxxxxxxxxxxx
aws secretsmanager put-secret-value \
  --secret-id /capiro/dev/clerk/webhook-signing-secret \
  --secret-string whsec_xxxxxxxxxxxxxxxx
aws secretsmanager put-secret-value \
  --secret-id /capiro/dev/clerk/publishable-key \
  --secret-string pk_live_xxxxxxxxxxxxxxxx

# 6. Build + push the API image to ECR (either via GitHub Actions on push
#    to main, or locally with the AWS CLI logged in to ECR).
#    The Compute stack expects `:latest` to exist in both repos.
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/arm64 \
  -f apps/api/Dockerfile \
  -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest \
  --push .
docker buildx build --platform linux/arm64 \
  -f apps/web/Dockerfile \
  -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest \
  --push .

# 7. Compute — ECS, ALB, target groups, listener rules, WAF, DNS records.
#    ~10 min for the services to reach steady state.
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Compute $CTX

# 8. Run migrations as a one-shot Fargate task. The task definition family is
#    capiro-dev-api-migrate. Get the latest revision from `aws ecs describe-task-definition`
#    or just use the family name (ECS will pick the latest active revision).
SUBNETS=$(aws ec2 describe-subnets --filters "Name=tag:Name,Values=*Capiro-dev-Network/Vpc/private*" \
  --query 'Subnets[*].SubnetId' --output text | tr '\t' ',')
SG=$(aws ec2 describe-security-groups --filters "Name=tag:aws:cloudformation:logical-id,Values=ServiceSg" \
  --query 'SecurityGroups[0].GroupId' --output text)
aws ecs run-task \
  --cluster capiro-dev \
  --task-definition capiro-dev-api-migrate \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}"
# Tail the logs:
aws logs tail /capiro/dev/api-migrate --follow
```

## Verifying the deploy

```bash
# ALB DNS name (from the stack output)
aws cloudformation describe-stacks --stack-name Capiro-dev-Compute \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' --output text

# Health checks
curl -s https://app.capiro.ai/health           # API health
curl -s https://app.capiro.ai/healthz          # web health (nginx)
```

## Rolling out a new image

The CDK stack pins `:latest` for both services. After pushing a new image, the
service does NOT auto-redeploy — that matches the architecture's "interactive
deploys via Claude+MCP" stance. Force a new deployment with:

```bash
aws ecs update-service --cluster capiro-dev --service capiro-dev-api --force-new-deployment
aws ecs update-service --cluster capiro-dev --service capiro-dev-web --force-new-deployment
```

## Tearing down (dev only)

`cfg.protectFromDestroy` is `true` for staging/prod, `false` for dev. To
destroy a dev deploy:

```bash
pnpm --filter @capiro/infra-cdk exec cdk destroy --all $CTX
# Then delete any retained KMS keys + Secrets Manager secrets manually.
```

## What's intentionally absent

- **GuardDuty / Security Hub / CloudTrail org-wide** — these live in the
  security account in the multi-account split. Single-account dev gets them
  when we split.
- **Multi-region** — us-east-1 only per arch §3.
- **Custom domain for the API** — path-based routing under `app.capiro.ai`
  means there's no separate `api.*` hostname. Splitting in the future requires
  adding a listener rule + DNS record.
