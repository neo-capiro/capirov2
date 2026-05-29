# Capiro

Multi-tenant SaaS platform for federal lobbying firms. SOC 2 Type II in scope from launch.

The full design lives in `capiro_technical_architecture_v0_2.docx` (one level up
from this repo).

## Repo layout

```
capirov2/
├── apps/
│   ├── api/         NestJS API (Clerk auth, tenant context, RLS)
│   └── web/         Vite + React + AntD + Clerk; nginx-served in deployed envs
├── packages/
│   └── shared/      Shared types (TenantRole, TenantContext)
├── infra/
│   └── cdk/         AWS CDK app, Network, Dns, Data, Secrets, Compute stacks
├── .github/
│   └── workflows/   ECR image builds for api + web
├── docker/
│   └── postgres/    Postgres 16 + pgvector init scripts (local dev only)
└── docker-compose.yml   Local dev DB only
```

## Deploy targets

- **AWS (production-grade):** see [infra/cdk/README.md](infra/cdk/README.md). Single AWS account, us-east-1, multi-AZ. Both api and web run as containers in ECR behind a single ALB at `app.capiro.ai` with path-based routing (`/api/*` → api, everything else → web).
- **Local (optional):** Docker Compose Postgres + pnpm dev. Useful for iterating on schema/migrations without touching AWS. Steps further down.

---

## Deploy to AWS, quick reference

Detailed walkthrough lives in [infra/cdk/README.md](infra/cdk/README.md). The
short version:

```bash
# 0. AWS creds for the target account in your shell.
aws sts get-caller-identity

# 1. Bootstrap CDK (one time per account)
pnpm --filter @capiro/infra-cdk exec cdk bootstrap aws://<ACCOUNT_ID>/us-east-1

# 2. Deploy stacks in order
CTX="--context env=dev --context account=<ACCOUNT_ID>"
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Network $CTX
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Dns     $CTX
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Data    $CTX
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Secrets $CTX

# 3. Fill Clerk secrets (placeholders fail to verify)
aws secretsmanager put-secret-value --secret-id /capiro/dev/clerk/secret-key            --secret-string sk_live_xxx
aws secretsmanager put-secret-value --secret-id /capiro/dev/clerk/webhook-signing-secret --secret-string whsec_xxx
aws secretsmanager put-secret-value --secret-id /capiro/dev/clerk/publishable-key       --secret-string pk_live_xxx

# 4. Build + push images to ECR (or push to main and let GitHub Actions do it)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/api:latest --push .
docker buildx build --platform linux/arm64 -f apps/web/Dockerfile -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/capiro/dev/web:latest --push .

# 5. Deploy compute (creates ECR target services + ALB + WAF + DNS)
pnpm --filter @capiro/infra-cdk exec cdk deploy Capiro-dev-Compute $CTX

# 6. Run migrations
aws ecs run-task --cluster capiro-dev --task-definition capiro-dev-api-migrate \
  --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[<private-subnets>],securityGroups=[<service-sg>],assignPublicIp=DISABLED}"

# 7. Bootstrap a tenant (talks to Clerk's Backend API + Aurora)
#    Run from your laptop with .env populated; or from a one-shot ECS exec.
pnpm --filter @capiro/api bootstrap:tenant -- \
  --slug acmelobby --name "Acme Lobbying Group" \
  --clerk-user-id user_2YOUR_ID --email you@yourdomain.com --role client_admin
```

Visit `https://app.capiro.ai`. Health checks: `/health` (api), `/healthz` (web).

## Architectural decisions baked into this build

- **Multi-tenancy via Postgres RLS, not application code.** Every tenant-scoped query runs inside a transaction with `SET LOCAL app.current_tenant = $tenantId`. Forgetting to set the GUC returns zero rows, fail closed.
- **Clerk Organizations = Capiro tenants (1:1).** `tenants.clerk_org_id` links the two. The `capiro` Clerk JWT template injects `capiro_tenant_id` and `capiro_tenant_slug` so the API has a fast-path tenant resolution.
- **Both api and web in ECR**, behind a single ALB with path-based routing. Same image promotes through environments, runtime config via `/runtime-config.js` written by the web container's nginx entrypoint.
- **Secrets never in source control.** Clerk + DB credentials live in Secrets Manager; the API task definition mounts them via the `secrets:` block.
- **Production-grade defaults**: WAF on the ALB, KMS CMKs per data domain, ECR image scanning + immutable tags, VPC flow logs, Aurora PITR + 35-day retention, `rds.force_ssl=1`, deletion protection on prod, Container Insights, structured JSON logs.

---

## Local dev (optional)

For iterating on schema/migrations without an AWS round-trip.

```bash
pnpm install
cp .env.example .env   # fill Clerk keys
pnpm db:up
pnpm --filter @capiro/api prisma:generate
pnpm --filter @capiro/api prisma:migrate:deploy

# In one terminal:
pnpm --filter @capiro/api dev    # → http://localhost:4000
# In another:
pnpm --filter @capiro/web dev    # → http://localhost:5173
```

Local Clerk needs `localhost:5173` added to your Clerk dashboard's allowed origins (production instances reject it by default).

## What's next

- **Session C**, AppShell with the eight top-level menu items (three greyed).
- **Session E+**, Active pages: Command Center, Clients, Engagement Manager, Directory, Settings, one per session.
- **Multi-account split** before prod traffic, separate AWS accounts for dev/staging/prod/security/shared-services per arch §9.
