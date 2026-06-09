# Ship runbook — SAM gov-id enrichment + association ops (2026-06-09)

Account **967807252336** / cluster **capiro-dev** / region us-east-1 (verified live). Commit **c6a4625** on `main`.

## What merged
- `SamEntityEnrichmentService` — fills `clients.uei/cage_code/naics_codes/psc_codes` from the SAM Entity-Management API by exact legal name (+state). Conservative single-match (never guesses a UEI), fill-if-empty, fail-safe, RLS-scoped. `X-Api-Key` header auth. `SAM_ENRICHMENT_ENABLED` kill-switch (default on).
- Fire-and-forget hooks on client **create**, **LDA import**, **CSV bulk import**.
- `fill-govids-all` ECS verb (DRY RUN default; `--commit`, `--tenant`, `--delay`).
- `diag-phantom-imports` read-only verb (the ③ question).
- Verified: api `tsc` clean; `jest src/intelligence src/clients` 266/266.

## ⚠️ Where the SAM key lives (decides how to run things)
`SAM_GOV_API_KEY` is on the **migrate** task def (`apiMigrateSecrets`, compute-stack.ts:362) — NOT on the API **service** task def (`apiServeSecrets`).
- ✅ The **backfill verb works now** if run on `capiro-dev-api-migrate` (has the key; tsx verbs run there — the server task def sets `TMPDIR=/app/tmp` which breaks tsx, so do NOT run verbs on `capiro-dev-api`).
- ⚠️ **Create-time enrichment** (new client create/import) **no-ops** until `SAM_GOV_API_KEY` is added to `apiServeSecrets` — fail-safe (logs "not configured", no harm). See "Follow-up" below.

## Network config (for `run-task`)
```
subnets        = subnet-0e38bd390f8961fef, subnet-0920665f91c905f01, subnet-06db79cd21239de19
securityGroups = sg-01def4e5c0fe44d4a   (assignPublicIp DISABLED)
```

---

## Step 1 — wait for CI to build the image
Push to `main` already triggered the `api-image` workflow (arm64 `capiro/dev/api:latest`, ~5–6 min). API-only change → no web rebuild.
```
gh run watch --branch main          # or: gh run list --branch main
```
The one-off verbs below pull `:latest` at run time, so **no service roll is required for the backfill** — just wait for the build to go green.

## Step 2 — populate existing clients' gov-ids (the immediate win, no infra change)
Run on the **migrate** task def (has the SAM key). DRY RUN first:
```
aws ecs run-task --cluster capiro-dev --launch-type FARGATE \
  --task-definition capiro-dev-api-migrate \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-0e38bd390f8961fef,subnet-0920665f91c905f01,subnet-06db79cd21239de19],securityGroups=[sg-01def4e5c0fe44d4a],assignPublicIp=DISABLED}' \
  --overrides '{"containerOverrides":[{"name":"api","command":["fill-govids-all"]}]}'
```
Read the logs (`/capiro/dev/api`, stream `api/api/<task-id>`): each tenant logs `N client(s), M SAM match(es), K would-fill`. When the match rate looks right, commit:
```
  --overrides '{"containerOverrides":[{"name":"api","command":["fill-govids-all","--commit"]}]}'
```
Idempotent + fill-if-empty (never overwrites user-entered values). Add `--tenant <uuid>` to scope, `--delay 500` to slow SAM calls.

## Step 3 — the other two association ops (③ + ④, code already deployed)
Read-only diagnosis of the "imported clients missing from Portfolio" question:
```
  --task-definition capiro-dev-api-migrate \
  --overrides '{"containerOverrides":[{"name":"api","command":["diag-phantom-imports"]}]}'
```
Look for `PHANTOM_IMPORTS {...}` in logs: if RADIANT NUCLEAR / THE PRIVATE SUITE LAX / TERRAFLOW ENERGY show `status=active` + `hiddenByPortfolioFilter=false`, they exist + are visible → the UI was cache-stale (no fix). If `status` is anything else, that's the real cause.

Surface new LDA candidate mappings for existing clients (preview, then run):
```
  --overrides '{"containerOverrides":[{"name":"api","command":["diag-client-resolution"]}]}'   # read-only blast-radius
  # then (WRITES candidate mappings to the review queue):
  --task-definition capiro-dev-api-sync-entity-resolution \
  --overrides '{"containerOverrides":[{"name":"api","command":["sync-entity-resolution","--tenant","<MAVEN_TENANT_UUID>"]}]}'
```

---

## Follow-up — enable create-time enrichment for NEW clients
So newly created / imported clients auto-enrich (not just the backfill), add the SAM key to the API service:

1. In `infra/cdk/lib/compute-stack.ts`, add to **`apiServeSecrets`** (~line 350):
   ```ts
   SAM_GOV_API_KEY: ecs.Secret.fromSecretsManager(samGovApiKeySecret),
   ```
2. Apply. ⚠️ **Prefer a manual task-def revision + `update-service`** over `cdk deploy` — a `cdk deploy` may drop the **out-of-band ALB priority-15 `/webhooks/*` rule** (not in CFN; dropping it breaks Clerk webhook → new-user provisioning). If you do `cdk deploy`, verify that rule survives.
3. The exec-role secret grant already covers `capiro/dev/sam-gov-api-key*` (compute-stack.ts:450) — the migrate task reads it today; confirm the API service's exec role is the same/covered.
4. Roll the service: `aws ecs update-service --cluster capiro-dev --service capiro-dev-api --force-new-deployment`.

Kill-switch: set `SAM_ENRICHMENT_ENABLED=false` (env) on any task def to pause enrichment without a code change.

## Notes
- No DB migration in this change (gov-id columns pre-existed) — `migrate` is a safe no-op re-assert if you run `scripts/deploy-dev.sh`.
- Foreign uncommitted working-tree changes (controllers, web pages, `apps/api/src/common/`) were left untouched and NOT included in c6a4625.
