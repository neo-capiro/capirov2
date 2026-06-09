# Acceptance Criteria — Client→Data Association Overhaul

Companion to `client-data-association.md`. Each item is independently testable.
**Status legend:** `[shipped]` code merged+deployed, verifiable now · `[needs A]` requires the backfill (Task A) · `[needs B]` requires the firm-onboarding UI (Task B) · `[needs C]` Phase 4c.
**Verification key:** `UI` = check in app · `SQL` = read-only diag verb / prod query · `unit` = tsc+jest · `manual-api` = call the endpoint.

> **Verification status (2026-06-09, pre-deploy):** All code/unit/migration-SQL/grep-checkable criteria PASS — api `tsc` clean, `jest src/intelligence src/clients entity-resolution prepopulation` green (254), web `tsc` clean + vitest green (160). Phase 4c (AC-9) and the firm-onboarding UI (AC-8) are implemented; the `diag-client-resolution` pre-flight verb (AC-7.5) is built. Items still OPEN are operator-owned (require deploy to the **confirmed** AWS account + the Task-A backfill run against prod): AC-7.1–7.4 (backfill), AC-6.3 (`migrate status` on prod), AC-2/4/8 live `UI`/`manual-api` proofs, AC-10.4 (latency) and AC-10.5 (deploy). No code change ships to `967807252336`/`capiro-dev` unless the operator confirms it.

---

## AC-1 · Registrant-anchored entity resolution  `[shipped]`

1.1 Given a tenant with `lda_registrant_id` set, when a client is resolved, the LDA candidate set is drawn ONLY from that firm's filings (`lda_filing.registrant_id = X`), never the global ~46k pool. **(SQL/unit)**
1.2 A within-firm **multi-token** exact normalized-name match auto-confirms (`confirmed=true`, confidence ≥ 0.85). **(unit)**
1.3 A within-firm **single-token** exact match does NOT auto-confirm — it lands in the review queue. **(unit)**
1.4 When the firm has not filed for the client (no candidate ≥ 0.4 sim and no fingerprint-exact), resolution falls back to the global fuzzy pool. **(unit)**
1.5 When the tenant has NO `lda_registrant_id`, resolution behaves exactly as before (global fuzzy) — **no regression**. **(unit)**
1.6 For a registrant with > 500 distinct clients, candidates are ranked by **similarity** (most-similar kept), not by lowest numeric `client_id`. **(SQL)**
1.7 Every `client_intel_mapping` write includes `tenant_id` and executes inside `withTenant(tenantId, …)`; no write occurs outside tenant scope. **(unit/code-review)**

## AC-2 · Firm-onboarding API (`/firm`)  `[shipped]`

2.1 `GET /firm/lda-registrants?q=` returns registrants matching `q` (trigram) with `totalClients`/`totalFilings`; rejects `q` shorter than 2 chars; open to `standard_user`. **(manual-api)**
2.2 `PUT /firm/registrant` (role `user_admin`) sets `tenants.lda_registrant_id` + name; returns 404 for a non-existent registrant id; only mutates the **caller's** tenant. **(manual-api)**
2.3 `GET /firm/import-candidates` returns the firm's distinct filed clients (`ldaClientId`, name, filings, latestFilingYear, totalSpend) sorted by spend, each with `onboardedAs` (non-null if already a Client); returns empty when no registrant is set. **(manual-api)**
2.4 `POST /firm/import` (role `user_admin`, ≤ 100 ids) creates Client rows ONLY for ids that belong to the firm's registrant — any foreign/global id is rejected/skipped with a reason. **(manual-api)**
2.5 Each imported Client is created with `lda_client_ids = [id]` + a **confirmed** `source='lda'` mapping carrying `tenant_id`. **(SQL)**
2.6 Import is idempotent: re-importing an already-onboarded id is skipped (not duplicated). **(manual-api)**
2.7 Two concurrent `POST /firm/import` of the same id do NOT create two Client rows (per-(tenant,id) advisory lock). **(manual-api / load test)**
2.8 A user in tenant A cannot enumerate, set a registrant for, or import into tenant B. **(manual-api, cross-tenant)**

## AC-3 · Prepopulation cascade  `[shipped]`

3.1 `prepopulate(tenantId, clientId)` is **idempotent** — running it N times yields the same row state. **(unit/SQL)**
3.2 `clients.lda_client_ids` equals exactly the **numeric** `externalId`s of the client's confirmed `source='lda'` mappings (non-numeric ids excluded). **(SQL)**
3.3 `clients.issue_codes` after prepopulate = **union** of prior codes + LDA-derived codes; a user-entered code is never removed. **(unit/SQL)**
3.4 `description` is filled only when previously empty/null; a user-entered description is never overwritten. **(unit/SQL)**
3.5 `intakeData.ldaSignals` is written with `{ldaClientIds,totalSpend,latestFilingYear,lobbyingFirms,refreshedAt}`; **other `intakeData` keys (e.g. `profileNotes`) are preserved**. **(SQL)**
3.6 When the confirmed LDA set becomes empty (e.g. last mapping un-confirmed), `lda_client_ids` becomes `[]` AND `intakeData.ldaSignals` is **removed** (not left stale). **(SQL)**
3.7 Triggers: prepopulate runs after import, after resolve-on-create, and after manual confirm AND un-confirm. **(code-review/manual-api)**
3.8 A concurrent prepopulate + user profile edit does not lose-update `lda_client_ids` or clobber `issue_codes`/`intakeData` (writes are a single atomic SQL UPDATE referencing current values). **(code-review / race test)**
3.9 `prepopulate(wrongTenantId, clientId)` is a no-op (RLS scopes it). **(SQL, cross-tenant)**

## AC-4 · Read path — set-based aggregation  `[shipped]`

4.1 `getClientProfile` LDA section aggregates filings / total spend / yearly spend / issue codes across the **full** id set (`lda_filing.client_id = ANY(ldaClientIds)`), not a single id. A multi-firm client (e.g. RTX/Boeing) shows totals summed across all its firm relationships. **(UI/SQL)**
4.2 Name-fuzzy LDA matching is used **only** when the client is unresolved (empty id set); a resolved client never hits the fuzzy path. **(unit)**
4.3 `getLobbyingRoi.lobbySpend` = `SUM(income)` across the set; response includes both scalar `mappedLdaClientId` (back-compat) and array `mappedLdaClientIds`. **(SQL/UI)**
4.4 ROI quarter chart (`buildRoiQuarterSeries`) sums each quarter across the set; an empty set falls back to even annual distribution. **(UI)**
4.5 `getCompetitorBoard` excludes the client's own ids via `!= ALL(ids)` — the client's own other-registrant filings never appear as its own competitors. **(SQL)**
4.6 A `client_id` in the set that has **no** issue codes still contributes to filings/spend (two-pass aggregate — no undercount). **(SQL)**
4.7 `client-pe-relevance` PE-matching terms come only from **confirmed** mappings (unconfirmed fuzzy candidates excluded). **(unit/code-review)**
4.8 All of the above render under forced RLS with **no 500s** and return data (not empty) for a resolved client. **(UI)**
4.9 Already-correct reads (`getIssueCodeSignal`, `getTrackedBills`, `getPortfolioSummary`) are unchanged and still correct. **(unit)**

## AC-5 · Security / tenant isolation  `[shipped]` — SOC 2 critical

5.1 `confirmMapping`: a user in tenant A receives 404 (no mutation) when targeting a `mappingId` whose client belongs to tenant B; confirm/un-confirm only succeeds for the caller's own mapping. **(manual-api, cross-tenant)**
5.2 `client_intel_mapping` and `client_capabilities` have **forced RLS**; a query issued without a tenant context (no `withTenant`) returns **0 rows**. **(SQL)**
5.3 No un-scoped `this.prisma.clientIntelMapping` / `clientCapability` access remains in the read/write paths (all via `withTenant`). **(code-review: grep)**
5.4 Cross-tenant read of `GET /intelligence/mappings/:clientId` returns nothing for a foreign clientId. **(manual-api)**

## AC-6 · Data integrity & migrations  `[shipped]`

6.1 No two Client rows in a tenant share the same `lda_client_id`. **(SQL)**
6.2 `lda_client_ids` is never stale vs. the confirmed mapping set after any confirm/un-confirm/import (recomputed in-SQL). **(SQL)**
6.3 The 3 migrations applied cleanly to the populated prod DB: `client_intel_mapping.tenant_id` backfilled from `clients` (zero NULLs), orphan rows dropped, NOT NULL + FK + RLS in place. **(SQL: `prisma migrate status` + row checks)**

## AC-7 · Backfill of existing data  `[PARTIAL — prepopulate DONE 2026-06-09; resolve PENDING registrants]`

7.1 After setting `tenants.lda_registrant_id` and running `resolveAllForTenant` + `prepopulateAllForTenant` for a tenant, existing clients have `lda_client_ids` populated wherever a confirmed LDA mapping exists. **(SQL)** — `prepopulate-all` ran on all 4 tenants (0 failed); all 11 clients that had confirmed mappings with an empty cache now have `lda_client_ids` populated (verified via diag re-run: STALEcache 11→0). `resolveAllForTenant` NOT run — see 7.2.
7.2 New **candidate** (unconfirmed) mappings appear in the review queue for existing clients that previously had none. **(UI/SQL)** — NOT DONE. Requires `resolveAllForTenant`, which is BLOCKED: all 4 tenants have NO `lda_registrant_id` (diag: `tenantsMissingRegistrantAnchor: 4`), so resolution would run low-quality GLOBAL-FUZZY, not registrant-anchored. Setting each tenant's real LDA registrant is a business decision (which firm each tenant IS) — not auto-derivable. OPEN for operator: set registrants (`PUT /firm/registrant` or the wizard) then run `sync-entity-resolution`.
7.3 For a heavily-lobbied existing client, the Intel-tab lobbying spend is **higher** than the prior single-id value (now summed across the set). **(UI: before/after)** — DATA VERIFIED: RTX CORPORATION lda_client_ids now = 10 ids, META = 21 ids (were single/empty). Read path joins `= ANY(ids)`, so spend now sums across the set. Live-UI before/after screenshot still owed (needs an authed tenant session).
7.4 The backfill is safe to re-run (idempotent) and does not clobber any user-entered values (per AC-3.3/3.4). **(SQL)** — DONE (prepopulate is a single atomic UPDATE recomputing from current confirmed set; ran clean, re-runnable).
7.5 A pre-flight diff (`diag-client-resolution`) reports, per existing client, the projected change before any write. **(SQL)** — DONE (run twice: pre- and post-backfill, used to verify the cache flip).

## AC-8 · Firm-onboarding UI  `[shipped — code]` (verified 2026-06-09 tsc+vitest; live UI on deploy) — the visible experience

8.1 From Portfolio, a `user_admin` can search and select their firm's LDA registrant. **(UI)**
8.2 The wizard lists the firm's filed clients with spend/recency and flags ones already onboarded. **(UI)**
8.3 Multi-selecting + importing creates the clients; they appear in Portfolio with LDA data pre-filled (issue codes, description, spend). **(UI)**
8.4 The flow is gated to `user_admin` and scoped to the caller's tenant. **(UI/authz)**

## AC-9 · Phase 4c read-path consistency  `[shipped — code]` (verified 2026-06-09; deploy by operator)

9.1 `getClientBills`, `getClientIssueCodes`, `getOutreachContext` derive issue codes via `confirmedLdaIds(clientId, tenantId)` over `id = ANY(ids)` (union, helper `issueCodesForLdaIds`), agreeing with `getTrackedBills`. **(unit/SQL)** — DONE.
9.2 `findCompetitors` self-excludes via `c.id <> ALL(ids)` when the client is resolved, with a name-similarity (`< 0.6`) fallback when the id set is empty (so an unresolved client is not its own competitor). **(SQL)** — DONE (previously optional; implemented).

## AC-10 · Non-functional / regression / release  `[shipped` for code; `needs confirm` for deploy]`

10.1 `npx tsc --noEmit -p apps/api/tsconfig.json` → 0 errors. **(unit)**
10.2 `npx jest src/intelligence src/clients entity-resolution prepopulation` → all green. **(unit)**
10.3 No regression: tenants without a registrant and unresolved clients behave exactly as before the change. **(unit/UI)**
10.4 `profile-v1` aggregate latency is not materially worse than the prior ~12s baseline with set-based reads. **(UI/timing, e.g. `diag-profile-v1`)**
10.5 Shipped to the **user-confirmed** AWS account (NOT `967807252336`/`capiro-dev` unless the user confirms it); migrations applied; app healthy (Intel tab renders, no 500s). **(deploy verification)**

---

### Definition of Done (rollup)
All `[shipped]` criteria pass in the deployed environment **and** Task A backfill is run so a real heavily-lobbied client demonstrably aggregates across its full LDA id set in the UI (AC-7.3), with new candidates in the review queue (AC-7.2), and zero cross-tenant leakage (AC-5). Tasks B and C are tracked as follow-on increments with their own criteria above.
