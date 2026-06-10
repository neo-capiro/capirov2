# Handoff — Client→Data Association Overhaul

**For:** a fresh agent picking this up with no prior session context.
**Date:** 2026-06-09. **Repo:** capirov2 (`apps/api` = NestJS + Prisma; `apps/web` = Vite SPA).

---

## 0. READ THIS FIRST — guardrails

- ⚠️ **AWS ACCOUNT IS NOT CONFIRMED FOR YOU.** Do NOT deploy/`ecs`/`ecr`/migrate against account `967807252336` / cluster `capiro-dev` — the user flagged it as the WRONG ship target (2026-06-09). `967807252336` is a real Capiro account that holds prod *data* (read-only diag queries ran there), but **releases do not ship there.** **ASK the user for the correct ship account/cluster/ECR before any deploy action.** The user has already shipped the current code themselves.
- ⚠️ **Forced RLS is now ON for `client_intel_mapping` AND `client_capabilities`** (migrations `20260608010000_*`, `20260608000000_*`). Every read/write of these tables MUST be tenant-scoped via `PrismaService.withTenant(tenantId, tx => …)` or it silently returns **zero rows**. `client_intel_mapping` has a `tenant_id` column now. `tenants`/`clients` were already RLS-forced. `lda_filing`/`lda_client`/`lda_registrant` are tenant-agnostic (no RLS).
- ⚠️ **Two local clones / branch-switching hazard.** The OneDrive path is canonical `main`. Always `git rev-parse --abbrev-ref HEAD` before editing — work has been lost to editing the wrong branch/clone. Verify you're on the intended branch.
- **`pnpm lint` is broken repo-wide** (eslint not installed). Gate with `tsc --noEmit` + `jest`, not lint.
- **Prod is ARM64 Fargate.** Local Windows Docker builds AMD64 — use `docker buildx --platform linux/arm64` or the image won't pull.
- **Querying prod data:** the only working path for ad-hoc read-only SQL on prod Aurora is a read-only `diag-*` verb run as a one-off ECS task (direct connect / ECS Exec / Data API are all dead). Pattern: add `apps/api/scripts/diag-*.ts` (PrismaClient, `$queryRawUnsafe`, `console.log('TAG ' + JSON.stringify(...))`) + a dispatch case in `apps/api/scripts/entrypoint.sh`; merge to main → CI builds `:latest`; `aws ecs run-task … --overrides '{"containerOverrides":[{"name":"api","command":["diag-NAME"]}]}'`; read logs at group `/capiro/dev/api` stream `api/api/<task-id>`. (Account caveat above still applies.)

---

## 1. The problem this solves

Associating a Capiro client to its federal data relied on **trigram fuzzy-matching the client name** against ~46k LDA clients — unreliable, and it UNDERCOUNTS. Prod-verified facts (2026-06-08):
- An LDA `client_id` is **per lobbying-firm relationship**, NOT a global company id. One real company = a **SET** of `client_id`s (Comcast 52, Microsoft 36, Boeing 27, …). Within one `client_id` the typed name never drifts (0 cases).
- So a Capiro client must resolve to a **SET** of LDA ids (one per firm that lobbies for it) — and reads must aggregate across the set, not pick one id.

**The fix:** anchor on the firm's LDA `registrant_id` to generate a small candidate set; pin the confirmed `client_id` SET (`clients.lda_client_ids` cache + confirmed `client_intel_mapping` rows); prepopulate profile fields from the set; and make every read join on the id set instead of the name.

Full background + numbers: memory file `project_lda_client_id_identity.md`.

---

## 2. What is DONE, merged to `main`, and deployed (by the user)

All on `main` (merge commit reconciling with `main`'s concurrent RLS/security work). Typecheck clean; 254 intelligence/clients/entity-resolution tests pass.

- **Schema:** `clients.lda_client_ids Int[]`, `tenants.lda_registrant_id Int? / lda_registrant_name String?` (migration `20260608120000_client_lda_association_phase0`).
- **Resolution (`apps/api/src/intelligence/entity-resolution.service.ts`):** when `tenants.lda_registrant_id` is set, LDA candidates come from that firm's own filings (`lda_filing.registrant_id`) instead of the global pool; within-firm multi-token exact name match auto-confirms; falls back to global fuzzy when no registrant. Writes `client_intel_mapping` tenant-scoped (`withTenant` + `tenant_id`).
- **Firm onboarding API (`apps/api/src/intelligence/firm-onboarding.{service,controller}.ts`)** — `GET /firm/lda-registrants?q=`, `GET/PUT /firm/registrant`, `GET /firm/import-candidates`, `POST /firm/import` (creates Clients with the LDA `client_id` pinned + confirmed mapping). **API only — NO web UI.**
- **Prepopulation cascade (`apps/api/src/intelligence/client-prepopulation.service.ts`)** — `prepopulate(tenantId, clientId)`: idempotent single atomic SQL UPDATE that syncs `lda_client_ids` (recomputed in-SQL from confirmed mappings), unions LDA issue codes into `clients.issue_codes`, fills `description` if empty, stamps `intakeData.ldaSignals`. Plus `prepopulateAllForTenant(tenantId)`. Wired to import, resolve-on-create (`ClientsService.create`), and manual confirm/`createManualMapping`.
- **Read path (`apps/api/src/intelligence/intelligence.service.ts`)** — `getClientProfile`, `getLobbyingRoi` + `buildRoiQuarterSeries`, `getCompetitorBoard` (self-exclusion `!= ALL(ids)`), `getExStaffers` now read the full id set (`= ANY(ids)`); `client-pe-relevance.service.ts` uses `confirmed:true` mappings only.

**Verified in prod UI:** the Intel tab renders cleanly under forced RLS (no 500s) and aggregate LDA metrics display.

---

## 3. ⚠️ What is NOT done — the real remaining work

The deployed code added the *capability* but **has not been exercised on existing data**, so users see no new associations yet (confirmed by the user: existing confirmed mappings are all manual/pre-existing; nothing auto-added post-deploy). In priority order:

### Task A — Backfill existing tenants/clients (highest value; makes it actually do something)
Nothing has populated `clients.lda_client_ids` or generated candidate mappings for **existing** clients.
1. For each tenant, **set `tenants.lda_registrant_id`** (the firm anchor) — otherwise resolution falls back to global fuzzy. (See `searchRegistrants`/`setTenantRegistrant` in `firm-onboarding.service.ts`. For a one-shot backfill you may set it directly per tenant.)
2. Run resolution for existing clients: `EntityResolutionService.resolveAllForTenant(tenantId)` (exposed at `POST /intelligence/resolve-all`, and as the `sync-entity-resolution` script/ECS verb). Confirm it works under the new forced RLS (it was reconciled to use `withTenant`).
3. Run `ClientPrepopulationService.prepopulateAllForTenant(tenantId)` so confirmed sets sync into `lda_client_ids` + issue codes.
4. **Verify** on a real client (e.g. a heavily-lobbied one) that the Intel tab's lobbying spend / issue codes now aggregate across the id SET and that NEW candidate mappings appear in the review queue. (Do this via a read-only diag verb or the UI — NOT by guessing.)
> Consider a dedicated `diag-client-resolution` verb that reports, per existing client: current confirmed mappings, what the registrant-anchored resolution *would* produce, and the projected `lda_client_ids` — so the blast radius is visible before committing writes.

### Task B — Firm-onboarding wizard UI (`apps/web`) — the visible "import your clients" experience
The `/firm` API exists but has no frontend. Build the onboarding flow: search/select the firm's LDA registrant → list its filed clients (`GET /firm/import-candidates`, already returns spend/recency + an `onboardedAs` flag) → multi-select → `POST /firm/import`. Surface it on the Portfolio page (`/clients`) alongside the existing "Import CSV" / "New Client" buttons. This is most likely what the user expects to "see in the UI."

### Task C — Phase 4c (low-risk read-path consistency; all in `intelligence.service.ts`)
Convert three remaining single-confirmed-id issue-code reads to the id-set union (use `confirmedLdaIds(clientId, tenantId)`, already present + tenant-scoped):
- `getClientBills` — already converted in the merge; verify.
- `getClientIssueCodes`, `getOutreachContext` — confirm they use `confirmedLdaIds(clientId, tenantId)` and `id = ANY(ids)` unions.
- Optional: `findCompetitors` self-exclusion `c.id <> ALL(ids)` WITH a name-similarity fallback for the empty-set case (else an unresolved client appears as its own competitor).
Detailed site list + line refs are in memory `project_lda_client_id_identity.md` (the "Phase 4c" TODO).
ALREADY CORRECT — do not touch: `getIssueCodeSignal`, `getTrackedBills`, `getPortfolioSummary`.

---

## 4. Key references

- **Design + prod-verified facts + per-site blueprint:** memory `project_lda_client_id_identity.md`.
- **How to query prod:** memory `infra_query_prod_db.md`.
- **AWS account warning:** memory `project_aws_deploy.md` + `project_aws_naming.md` (both flagged; ship target unconfirmed).
- **Lint broken / verify with typecheck+jest:** memory `project_lint_broken.md`.
- **Verify commands (run in `apps/api`):** `npx tsc --noEmit -p tsconfig.json` ; `npx jest src/intelligence src/clients entity-resolution prepopulation`. After schema changes: `npx prisma generate`. (In a fresh worktree you must `pnpm install` + `pnpm --filter @capiro/shared build` first, or you'll get spurious `@capiro/shared` / `@jest/globals` errors that are env-only.)
- **RLS scoping pattern to copy:** `IntelligenceService.getPortfolioSummary` (resolves the tenant's client ids then filters) and any `withTenant(tenantId, tx => …)` usage.

---

## 5. Definition of done

A real existing client (heavily lobbied) shows, in the Intel tab, lobbying spend + issue codes aggregated across its **full** LDA id set (not one); new candidate mappings land in the review queue; the firm-onboarding UI lets a user set their registrant and import their filed clients with ids pinned; all gated by `tsc --noEmit` + jest green; deployed to the **user-confirmed** AWS account.
