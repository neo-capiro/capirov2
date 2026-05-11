# Overnight session decisions — 2026-05-10/11

Branch: `dev/quizzical-goldstine-364ded`

You said: "if you come to a decisoon that to be made, use your own judgment and keep going. just note those important decions and iolll take a look in the morning."

Here's the short list.

## What works right now in staging

- `https://staging.capiro.ai/` → marketing, 200
- `https://www.staging.capiro.ai/` → marketing, 200
- `https://app.staging.capiro.ai/` → SPA, 200
- `https://app.staging.capiro.ai/health` → API, 200
- `https://app.staging.capiro.ai/api/me` → 401 (correct, no auth)
- `https://app.staging.capiro.ai/api/clio/sessions` → 401 (correct)
- `https://app.staging.capiro.ai/api/clio/internal/tools/get_client_context` → 401 (correct — internal route is auth-gated)
- CORS preflight from `https://app.staging.capiro.ai` → 204 with proper headers
- CORS preflight from a disallowed origin → 204 with no `Access-Control-Allow-Origin` (after API redeploy completes)

All four ECS services (api / web / marketing / clio) are running 1/1 desired.

## Decisions you should review

### 1. CORS callback returns `false` instead of throwing an `Error`

[apps/api/src/main.ts:55-66](apps/api/src/main.ts) — commit `506d126`.

The original CORS origin callback called `callback(new Error('Origin is not allowed by CORS'))` for any host not in the allowlist. express-cors converts that Error into a NestJS exception → renders a 500. The browser saw 500 instead of a proper preflight response. I changed it to `callback(null, false)`, which is the documented "no CORS headers, but don't blow up" path — the browser still blocks the request per CORS semantics, but the server returns a clean 204 and stays quiet in logs.

This was the root cause of the "Could not load your profile / Network Error" you saw earlier.

### 2. Adopted the staging AppCert in-place instead of letting CDK replace it

[infra/cdk/lib/dns-stack.ts:38-55](infra/cdk/lib/dns-stack.ts), [infra/cdk/lib/config.ts:34-49,118-130](infra/cdk/lib/config.ts) — commit `533e6d0`.

Background: after you set `appHost: 'app.staging.capiro.ai'`, dns-stack tried to replace `AppCert` (changing primary domain from `staging.capiro.ai` to `app.staging.capiro.ai` forces ACM cert replacement). Compute imports the cert ARN via a cross-stack CFN export, and CFN refuses to replace the resource while the export is in use. `Capiro-staging-Dns` rolled back.

Options I considered:
- (A) Two-phase deploy: drop the export, deploy Compute, replace cert, re-add export. Operationally messy and risks broken HTTPS in the gap.
- (B) Use `Certificate.fromCertificateArn` to import the existing cert by ARN. Cleaner but CDK would try to DELETE the formerly-managed Certificate resource (still in use by Compute) → same deadlock with a different surface.
- (C) **What I picked**: add optional `appCertDomain` / `appCertSans` overrides to `EnvConfig`. Staging pins them to `staging.capiro.ai` + `*.staging.capiro.ai` — exactly what the live cert was originally issued for. CDK now produces a no-op diff against the deployed cert. The wildcard `*.staging.capiro.ai` already covers `app.staging.capiro.ai`, so HTTPS keeps working.

Tradeoff: staging won't have a cert SAN for `*.app.staging.capiro.ai` (deeper tenant vanity URLs like `acme.app.staging.capiro.ai`). Staging doesn't have customer tenants yet so this is fine. If we ever need it, we issue a separate cert by ARN and add it as an additional listener cert.

### 3. Added explicit ordering so any future apex/AppAlias rename doesn't race

[infra/cdk/lib/compute-stack.ts:843-885](infra/cdk/lib/compute-stack.ts) — same commit `533e6d0`.

When `AppAlias`'s `recordName` moves off the apex (which your `7adfa8b` triggers), CFN replaces it create-new-then-delete-old, but a new `ApexAlias` at the apex would race the still-living old `AppAlias`. I added `apexAlias.node.addDependency(appAlias)` and the same for the wildcard/IPv6 pair. This is preventative — it doesn't help the *current* deploy because CFN deletes old physical resources during cleanup phase, not before dependents, but it keeps the construct tree honest and clearly self-documents the constraint.

### 4. Deferred deploying the Compute DNS/listener-rule diff

`cdk diff Capiro-staging-Compute` shows pending changes:
- Add `ApexAlias` / `ApexAliasIpv6` A records at `staging.capiro.ai`
- Rename `AppAlias` from `staging.capiro.ai` to `app.staging.capiro.ai` (replacement)
- Rename `AppWildcardAlias` from `*.staging.capiro.ai` to `*.app.staging.capiro.ai` (replacement)
- Tighten the web listener rule's host conditions

I did **not** deploy this because:
1. Everything works right now via the existing wildcard `*.staging.capiro.ai` A record covering `app.staging.capiro.ai`.
2. CFN will collide on the apex: the new `ApexAlias` (at `staging.capiro.ai`) wants to come up while the old `AppAlias` (also at `staging.capiro.ai`) is still alive — Route53 rejects duplicate (zone, name, type). The dependency I added in §3 keeps CFN from creating the apex aliases before AppAlias *reaches* COMPLETE, but CFN doesn't delete the old physical resource until the cleanup phase, which is after all new resources have been created. So this deploy needs either:
   - **(a)** A manual record cleanup right before deploy: `aws route53 change-resource-record-sets` to DELETE the old `staging.capiro.ai` A and `*.staging.capiro.ai` A. ~3-5 min downtime for marketing + SPA until CFN recreates them. Acceptable for staging.
   - **(b)** A throwaway intermediate deploy that only updates the listener rule + adds the new `app.staging.capiro.ai` records under different logical IDs, then a second deploy that drops the old AppAlias and adds ApexAlias. Slower but zero downtime.
3. Nothing about the user-facing system requires the rename — the system is functionally complete.

**Recommendation**: do (a) in a 5-minute maintenance window on staging. I left the code ready to go.

### 5. Also pending in the diff: Assets bucket CORS adds `app.staging.capiro.ai` to AllowedOrigins

Same Compute deploy gate. Currently the bucket allows `staging.capiro.ai` + `*.staging.capiro.ai` which covers the SPA host via wildcard. Will tighten when (4) deploys.

## What did NOT happen this session

- **Tracks A and C** (source clients, Hermes audit) — the parallel agent didn't push to this branch overnight. `apps/api/src/clio/` still has only `get_client_context.tool.ts`. No `sources/` or `artifacts/` directories.
- **Bedrock end-to-end test** of an actual Clio chat with a tool call — gated on Track A getting wired up (or at minimum the `get_client_context` happy-path being exercised by an authenticated SPA session).

## Commits added overnight

```
533e6d0 Break Dns AppCert replacement deadlock and sequence apex alias creation
506d126 Return clean 204 on CORS preflight from disallowed origins
```

Both on `dev/quizzical-goldstine-364ded`, pushed to origin.
