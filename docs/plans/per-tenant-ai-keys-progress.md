# Per-Tenant AI Keys, Usage Tracking & Spend Visibility — Progress & Deploy Runbook

Branch: `feat/per-tenant-ai-keys` (based on `feat/clio-assistant-parity` tip `1872ff5`).
Plan: `.hermes/plans/2026-06-11_per-tenant-ai-keys-and-spend.md`. Built 2026-06-11.

> ⚠️ Per Neo's instruction: NOT merged to main, NOT deployed to AWS. The
> "Deploy together" section below is the remaining checklist.

## Task → commit map

| Task | Commit | Notes |
|---|---|---|
| (base) in-flight outreach concurrency + empty-string DTO fix | `d59364b` | Pre-existing uncommitted work landed first so this feature's edits to the same files don't entangle |
| 0.1 pricing table + cost helper | `6980f48` | Prices verified 2026-06-11 (Claude via claude-api reference; OpenAI public pricing) |
| 0.2 provider usage parsing | `583f4c4` | One parser covers OpenAI responses + Anthropic messages |
| 1.1 `ai_usage_events` table | `07dd198` | RLS ENABLE+FORCE + fail-closed policy, verified on fresh scratch DB |
| 1.2 usage event per generation | `87c9bb6` | All 7 generation paths; per-recipient inside the batch worker |
| 1.3 aggregation service | `a6c1cac` | Cross-tenant leakage gate in spec |
| 2.1 `tenant_ai_credentials` table | `accac71` | Same RLS verification |
| 2.2 `AI_CREDENTIAL_ENCRYPTION_KEY` config | `fa6816b` | Boot guard ships with the resolver |
| 2.3 + 2.4 credential resolver + validate-on-save | `71fc4c8` | Per-call resolve, global fallback regression-guarded |
| 3.1 tenant API `/api/ai-usage/*` | `552e97a` | Controller-level `@Roles('user_admin')` |
| 3.2 capiro-admin API | `d3d1d94` | Audit-logged key set/rotate/remove (last4 only) |
| 4.1 tenant settings page | `17d9329` | Settings → AI Usage tab |
| 4.2 admin console tab | `e17c0ea` | CapiroAdminPage → "AI Keys & Usage" |

## Success-criteria audit (plan §Success criteria)

| Criterion | Status | Evidence |
|---|---|---|
| Every AI generation writes exactly one `AiUsageEvent` per draft with correct tenant/model/tokens/cost | ✅ code+unit | All 7 `engagement.service` call sites instrumented; batch writes one per recipient inside the worker (`87c9bb6`); cost from `computeAiCostUsd` (non-zero for known models, unit-tested). Live N-rows-for-N-recipients check deferred to dev smoke (below) |
| Usage-write failure never breaks a generation | ✅ unit-tested | `ai-usage-record.spec.ts`: failing `create` AND failing `withTenant` both resolve without throwing |
| Tenant A can never see tenant B's usage | ✅ test + DB | RLS ENABLE+FORCE verified on scratch DB for both new tables; `ai-usage.service.spec.ts` cross-tenant gate; tenant endpoints take no tenantId input. Manual prod check deferred to dev smoke |
| Tenant admins see their own spend page with range filter + breakdowns | ✅ | `AiUsagePage` (user_admin tab), 7/30/90d Segmented, byDay chart, workflow/model tables; component-tested |
| Tenants can set their own key; validated before save, stored encrypted, last-4 only, used on subsequent generations (`usedTenantKey=true`) | ✅ unit-tested | `validateKey` real provider probe; AES-256-GCM envelope round-trip spec; resolver spec proves tenant key + model override + `usedTenantKey=true` flows into results → usage rows |
| Capiro admins set/rotate/remove any tenant's key + see all tenants' usage; every key change audit-logged | ✅ unit-tested | `capiro-admin.service.spec.ts`: `ai_credential.set` / `.remove` audit rows asserted to carry last4 only |
| Removing a tenant key cleanly falls back to the global key | ✅ unit-tested | Resolver spec: no credential / non-active / decrypt-failure all fall back to global with `usedTenantKey=false` |
| Invalid keys rejected with provider error; nothing stored | ✅ unit-tested | Store spec: validation rejection → BadRequest with provider message, `upsert` never called; web tests surface the message |
| All new + existing API tests pass; no new exceptions in dev logs post-deploy | ✅ tests / ⏸ logs | Full API jest + web vitest green (see Verification). Log scan is post-deploy — deferred |
| New tenant tables have RLS parity with siblings | ✅ DB-verified | Fresh scratch DB: `relrowsecurity=t`, `relforcerowsecurity=t`, fail-closed `rls_bypass() OR tenant_id=current_tenant_id()` policy on both tables — byte-identical pattern to `clio_mcp_servers` |

## Verification run (2026-06-11, local)

- `apps/api`: `npx tsc --noEmit` clean. Full `npx jest`: 167/167 suites,
  1551 passed + 1 todo. (One pre-existing failure unrelated to this feature —
  the reconciliation writer-path spec's prisma mock lacked `withSystem` —
  fixed in `a9cd052` and re-verified 7/7.)
- `apps/web`: `tsc -p tsconfig.json --noEmit` clean. Full `npm run test`
  (repo flags incl. `--testTimeout=20000`): 178/179 tests, 40/41 files. The
  single failure (`ProgramElementWatchPage` fy-chart testid) is a
  pre-existing load-sensitive flake — untouched by this branch (diff = 0)
  and passes 3/3 deterministically when run alone. Both new feature test
  files pass inside the full run.
- `prettier --check` clean on all feature files (formatted in `0ba7321`).
- Migrations: fresh scratch DB (`capiro_scratch` on local pgvector pg16) —
  `prisma migrate deploy` applies all 92+2 cleanly, `prisma migrate status`
  clean, `prisma migrate diff` drift signature identical to sibling
  hand-written migrations (uuid_generate_v4 default + `_tenant_fkey` naming).
- `pnpm lint` not used (eslint not installed repo-wide — known); gated with
  typecheck + tests instead.

## Deploy together (deferred per instruction)

1. **Secrets Manager (Neo, manual/CDK)**: create
   `capiro/dev/ai-credential-encryption-key` = 32-byte base64
   (`openssl rand -base64 32`), wire into the API task definition `secrets`
   block alongside `NOTES_ENCRYPTION_KEY` (CDK `infra/cdk/lib/compute-stack.ts`
   — ⚠️ remember the out-of-band ALB webhook rule must survive any cdk deploy).
   Until set, BYO-key save returns 503 and everything else works on global keys.
2. Merge/FF this branch onto `main` (note it builds on
   `feat/clio-assistant-parity`, so that lands too) → CI builds arm64 `:latest`.
3. `scripts/deploy-dev.sh` (migrate-before-API is built in; the two new
   migrations are additive-only).
4. **Dev smoke (plan Task 5.1)**:
   1. Tenant admin → Settings → AI Usage; run a 3-5 recipient outreach batch;
      refresh → N events, non-zero cost.
   2. Capiro admin → AI Keys console → enter a valid OpenAI key for one tenant
      → validation passes, last-4 shows, badge appears.
   3. Generate for that tenant → admin usage shows `tenantKeyEventCount` rising
      (event `usedTenantKey=true`), counted against that tenant only.
   4. Remove the key → generation falls back to global, no user-visible failure.
   5. Enter an invalid key → save rejected with the provider error, no row.
   6. `/capiro/dev/api` log scan: no new exceptions.

## Known limitations / open product questions (from the plan)

- Pricing is hand-maintained (`ai-pricing.ts`) — UI says "estimated"; no
  provider-billing reconciliation (out of scope).
- `AI_CREDENTIAL_ENCRYPTION_KEY` rotation would require re-encrypting stored
  keys (documented limitation; `key_version` column exists for future use).
- Clio/Bedrock usage is NOT metered by this feature — it covers the
  engagement AI service (OpenAI/Anthropic direct) paths only.
- Open product question: should a tenant on their own key see a "billed to:
  tenant key / Capiro shared" label per generation? `usedTenantKey` is
  persisted, and the UI shows the aggregate count, so this is a UI-only
  follow-up if wanted.
