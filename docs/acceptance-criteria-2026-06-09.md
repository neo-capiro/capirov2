# Acceptance Criteria — 2026-06-08/09 session (security hardening · reconciliation · matching · procurement)

Each workstream lists **testable acceptance criteria (AC)**, the **evidence** that
verified it, and **status**. ✅ = met & on `main`. ⏳ = built/handed-off, pending an
ops run. Legend for verification: *scratch-DB* = throwaway Postgres via `prisma
migrate deploy` (RLS probed as the non-super `capiro_app` role); *specs* = jest.

Global definition of done: on `origin/main`, CI green, API/web `typecheck` clean,
no production regression, additive migrations only (no auth/identity tables; the
one destructive bit — orphan delete — ran once in a prior deploy).

---

## A. Outreach wizard — "Save draft" resumes  (`4d12866` + migration `20260609002500`)
- AC1: Reopening a saved draft restores **clientId, direction, campaignName(title), recipients, per-recipient subject/body, tone, templateId, context items, attachments, and the saved step** — it no longer reopens blank at step 1.
- AC2: A re-save **PATCHes the same `OutreachRecord`** (no duplicate row); `draftId` is seeded from the loaded record.
- AC3: `lastStep` persists to its column (sent top-level), with a **`metadata.lastStep` fallback** so drafts saved by the pre-fix build still resume.
- AC4: Saving a draft on **step 6 or 7 no longer 500s** (DB CHECK widened `1..5 → 1..7`, aligned to the API DTO).
- AC5: Web-only; no API/runtime regression; `@capiro/web typecheck` clean.
- Evidence: save↔restore field-symmetry trace; web typecheck clean; the CHECK migration is non-destructive (widen only). **Status: ✅**

## B. `client_capabilities` row-level security  (`dc3772d`)
- AC1: `client_capabilities` has **ENABLE + FORCE ROW LEVEL SECURITY** and policy `USING/WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id())`.
- AC2: As `capiro_app` — tenant A sees only A's rows; **no-tenant read returns 0 (fail-closed)**; `bypass_rls=on` sees all.
- AC3: Genuinely cross-tenant/system readers work via bypass: delta-engine + program-element-writer `getAffectedTenants` → `withSystem`; embeddings fire-and-forget → `withSystem`; `embed-backfill` all-tenant read → `SET app.bypass_rls`. `strategies` reads → `withTenant` (stay isolated).
- AC4: No regression — delta-engine + writer specs green; API typecheck clean.
- Evidence: scratch-DB probe (`relrowsecurity/relforcerowsecurity = t/t`, isolation, fail-closed, bypass=all); 20 delta/writer specs. **Status: ✅ (deployed)**

## C. Cross-tenant IDOR fix — intelligence mapping endpoints  (`f7b27b2`)
- AC1: `GET /intelligence/mappings/:clientId` and `PATCH /intelligence/mappings/:mappingId` are **tenant-scoped** (`@CurrentTenant`), not just role-guarded.
- AC2: `getMappings` returns mappings **only if the client belongs to the caller's tenant** (else not the data).
- AC3: `confirmMapping` updates **only if the mapping's client belongs to the caller's tenant**; a foreign `mappingId` → **404 (no existence leak)**.
- AC4: Legitimate use (caller's own clients) is unaffected.
- Evidence: mirrors the proven `resolveMapping` ownership pattern; intelligence suite 30 suites / 235 tests green. **Status: ✅ (deployed)**

## D. `client_intel_mapping` RLS backstop  (`dae1a16`)
- AC1: Table gains **`tenant_id`** (backfilled from `clients`, orphan rows dropped, `NOT NULL`, FK→`tenants`) + **FORCE RLS** + isolation policy.
- AC2: As `capiro_app` — isolation holds; a **tenant-B context cannot read OR update a tenant-A mapping** (`UPDATE` affects 0 rows — IDOR fails closed at the DB); no-tenant read = 0; bypass = all.
- AC3: **Zero remaining raw/unscoped `clientIntelMapping` reads** in `apps/api/src` — every read via `withTenant`, every write sets `tenantId`, genuinely cross-tenant reads via `withSystem` (sync-fec-pac).
- AC4: No regression — 235 intelligence specs green; API typecheck clean.
- Evidence: scratch-DB probe incl. cross-tenant `UPDATE 0`; `grep '\.prisma\.clientIntelMapping'` over non-spec src = **0 matches**; 235 specs. **Status: ✅ (deployed)**

## E. PE ingest-script RLS-safety + one-command data-load  (`52d86c4`)
- AC1: The 6 `parse-*` / `extract-bill` scripts construct services with **`new PrismaService()`** (so `withSystem`/`withTenant` exist) — a script-driven PE write that emits a delta **no longer crashes** (`this.prisma.withSystem is not a function`).
- AC2: **`pnpm --filter @capiro/api load:defense-budget`** runs the full RDT&E recipe in dependency order, idempotently, one command.
- AC3: Verified end-to-end on scratch: the previously-crashing SASC committee-mark load succeeds; full chain → **954 PEs / 1,596 PE-years / 2,645 deltas**.
- Evidence: scratch run; typecheck. **Status: ✅ on main; ⏳ data-load is an ops run (prod RDT&E data already populated by the prior session)**

## F. Reconciliation queue — tool + cleanup  (`f7b0160` `58b2261` `e0438fa` `c5a8847`)
- AC1: `diag:reconciliation-units` reports the open queue grouped by `Conflicting source`, classifying each row **artifact_keep / canonical_raw / genuine** by a ≥100× ratio test; **read-only by default**.
- AC2: `--commit` resolves **only `artifact_keep`** as `keep_current` (no value change); `--include-canonical-raw` also resolves `canonical_raw` (only after live data verified correct); `--resolve-ids` closes specific operator-confirmed rows.
- AC3: Root cause established: the queue noise was **stale snapshots from a pre-fix loader pass** — `reconcile.service` code is **correct and unchanged**; live `program_element_year` values are correct $M.
- AC4: Outcome — prod queue **2,896 → 0 open**, with **no live budget value changed**.
- Evidence: scratch classify tests (215.322-vs-215322000 resolved; 100-vs-120 left open; canonical-raw left/swept correctly); operator run `FINAL_OPEN_QUEUE=0`. **Status: ✅**

## G. Alias stoplist — kill shared-accounting false matches  (`20ba406`)
- AC1: Generic accounting labels (**Congressional Adds, Program-Wide Support, SBIR/STTR, Management/Mission Support, Studies & Analysis, Miscellaneous, …**) are rejected at alias **creation** (`programs.service` → 400), skipped at **seeding**, and skipped at **match time** (both the alias *and* a generic PE/project title).
- AC2: **Real programs are never stoplisted** — `SBIRS`, `COMMON MISSILE WARNING SYSTEM`, `ENTERPRISE GROUND SERVICES` all survive (single ambiguous words match only as the whole string; prefixes require a token boundary).
- Evidence: 58 specs incl. `alias-stoplist` safety cases. **Status: ✅ on main; ⏳ effect realized as the match queue is reworked**

## H. PE→Program candidate-review prompt  (`536bab0`)
- AC1: `docs/prompts/pe-program-match-review.md` exists, scoped to the **candidate/quarantined judgment layer** (bulk matching runs deterministically first).
- AC2: It emits **evidence-tier + confidence + accept/keep_candidate/reject** aligned to `program-match-thresholds`, derives component via `serviceFromPeCode`, discriminates **distinct-project vs shared-generic** many-to-one, treats narrative as corroboration only, and **defaults to not-accept**.
- Evidence: doc on main. **Status: ✅**

## I. Procurement loader — Option A (BLIN identity)  (`4dfe53c`)
- AC1: `isValidProcurementCode` accepts the **BLIN** format (`^[0-9]{4}[A-Z]{1,2}[0-9A-Z]{4,5}$`); `isValidProgramCode` accepts **PE code OR BLIN**; the two formats **never collide**.
- AC2: The shared **writer gate** and the **pdoc gate** accept BLINs; procurement loads as `appropriation_type='PROC'` + `program_element_year` (request in **millions**) + `program_element_procurement_line`; garbage (`BADPROC99`) **still quarantines**.
- AC3: No migration required (`appropriation_type` free text; `pe_code` VarChar(16) fits BLINs).
- Evidence: scratch end-to-end (BLIN `0102A12345` → PROC/ARMY, FY2027 $960M, 2 line items; `BADPROC99` quarantined); 42 specs incl. BLIN↔PE non-collision. **Status: ✅ on main (in `:latest`)**

## J. Procurement extractor — FY-header fix  (`f9d2504`)
- AC1: `extract_pdoc.py` anchors FY-column detection to the **Resource Summary header row** (no stray `FY 20xx` from narrative/other pages) and maps the **`FY2027 Base/OOC/Total` split**'s request year to the request-year **Total** (not the rightmost grand-total).
- AC2: Verified **value-for-value** vs the Army Aircraft P-40 (Small UAS `9678A12500`: FY2025/26/27 = **190.914 / 426.029 / 291.472**M, qty 590); FY list clean `2025–2031`, no junk years.
- Evidence: re-extraction diff vs the PDF `Net Procurement (P-1)` row. **Status: ✅ on main**

## K. Procurement ingestion runbook  (`de1812c`)
- AC1: `docs/runbooks/procurement-p40-ingestion.md` is a **self-contained** path: extract → **verify gate** (clean FY list, value spot-check, no quarantine) → scratch load → commit artifacts → prod load — with PASS criteria + caveats (Army-only extractor; request year = FY2027 Total).
- Evidence: runbook on main. **Status: ✅**

## L. Memory hygiene — AWS account scrub
- AC1: **Zero raw AWS account numbers** anywhere in the memory directory (12-digit IDs redacted to `<aws-account-redacted>`).
- AC2: The semantic warnings are **preserved** ("`capiro-dev` is not a confirmed ship target — ask before any deploy/ECS/ECR/migrate").
- AC3: Going forward, **ask the user for the correct ship target** before any deploy/ECS/ECR/migrate rather than assuming.
- Evidence: post-scrub grep = no matches. **Status: ✅**

---

## Still OPEN (explicitly NOT yet accepted)
- **Procurement data live in prod** — extract+verify the remaining 6 Army books, commit artifacts, run `parse:pdoc` per book on prod (per runbook K). *Handed off.*
- **Navy/AF/SF/USMC procurement** — extractor is Army-only; needs per-service tuning.
- **Pending migration to deploy** — `20260609002500_widen_outreach_last_step_check` (safe; widen-only).
- **Empty enrichment boxes (coverage, not bugs)** — fuller program catalog + more PEO rosters + client capability config to populate Programs / Program team / Client relevance.
