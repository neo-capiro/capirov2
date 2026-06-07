# Step 0.1 — Source-document registry with checksums

Status: in progress (2026-06-07)
Owner: defense-budget intelligence remediation
Plan refs: §4.2 (100% checksum dedup + version tracking), §4.3 (provenance incl. extraction method)

## Goal

Add a global `SourceDocument` table so every extracted defense-budget row ties back to a
fingerprinted, versioned source file, and wire the existing PE provenance tables + the
artifact-loading sync/parse scripts to it.

## What the spec asked for (verbatim intent)

1. `SourceDocument` global table (no tenant_id / RLS), with provenance + checksum + version chain.
2. Nullable additive `sourceDocumentId` FK on `program_element_source`, `program_element_project`,
   `program_element_performer`, `program_element_year_source_value` + a backfill script.
3. Extend 7 sync/parse scripts to upsert their `SourceDocument` first (checksum dedup) and stamp
   `sourceDocumentId` on the rows they write.
4. Python extractors: shared `_document` header helper; demo on `extract_jbook_r1.py`.
5. Specs: upsert idempotency, sha-change → version chain, backfill linker by `sourceUrl`.

## Key findings that shaped the design (from reading the code)

- **Two write paths, two Prisma bootstraps.**
  - jbook sync scripts (`sync-comptroller-jbooks`, `sync-jbook-r2`, `sync-jbook-performers`) use
    `PrismaService` and write `program_element_source/project/performer` **directly** with a real
    `sourceUrl` (J-book PDF URL). They gate writes on `--commit` (dry-run default).
  - parse scripts (`parse-hasc-sasc-reports`, `parse-defense-approps-reports`,
    `parse-ndaa-conference`, `parse-defense-approps-public-law`) use raw `PrismaClient` and write
    `program_element_year` + `program_element_year_source_value` via the shared
    `ProgramElementWriterService`/`ReconciliationService`. They take a required `--artifact` and
    **always write** (no `--commit`). Their artifacts carry `source` = a *filename*, not a URL.
- **One PDF → multiple artifacts sharing a `sourceUrl`.** `jbook_r2_dw_darpa.json` (R-2) and
  `jbook_performers_dw_darpa.json` (R-3) point at the *same* DARPA master PDF URL. The
  `program_element_source` rows from that PDF therefore share `sourceUrl` and differ only by
  `exhibitType` (R-2/R-2A vs R-3). ⇒ the backfill linker must disambiguate by
  **`exhibitType`→`documentType`**, not `sourceUrl` alone.
- **Jest = in-memory mock Prisma; specs live under `src/**/*.spec.ts`** (scripts are not
  test-matched). ⇒ all testable logic (classify, upsert, link-decision) ships as **exported pure
  functions in `src/program-element/source-document/`**; scripts and the backfill import them.
- Migration conventions: new GLOBAL tables get **no RLS / no GRANT**; uuid PK via
  `gen_random_uuid()`; `TIMESTAMPTZ(6)`; jsonb columns mapped `*_jsonb`; FKs `ON DELETE … ON UPDATE CASCADE`.
- Prisma is **5.20** (no partial-unique-index support in schema).

## Design decisions (and deviations from the literal spec)

1. **`sourceKey` uniqueness vs version chain (deviation).** The spec says `sourceKey` is `unique`
   *and* that a changed `sha256` for the same `sourceKey` creates a new row chained via
   `supersededByDocumentId`. Those are mutually exclusive under a global unique constraint. We keep
   **both behaviors** by:
   - a DB `UNIQUE(source_key, sha256)` — exact-content re-ingestion is a no-op (checksum dedup);
   - **"one live document per `sourceKey`" enforced in `upsertSourceDocument`** (the prior live head
     — `supersededByDocumentId IS NULL` — is chained to the new row). No global `UNIQUE(source_key)`
     and no partial index (Prisma 5 can't express partial indexes; a raw one would trip
     `migrate dev` drift). Offline batch scripts are single-threaded, so app-enforcement is safe.
2. **`documentType` extends the spec enum with `r3`.** Spec list was `r1|r2|p1|p40|committee_report|
   conference_report|public_law|other` (a plain `text` column, not a CHECK). R-3 performer tables
   need to be distinguished from R-2 because they share a `sourceUrl`; we use `r3` and keep the
   exhibit in `metadata`. Mapping used by the linker:
   `R-1→r1, R-2/R-2A→r2, R-3→r3, P-1→p1, P-40→p40`.
3. **`sourceUrl` is `NOT NULL`** (per spec). Committee/conference/public-law artifacts have no URL,
   so we store the artifact's `source` filename (or the artifact path) as the best available
   reference; their rows link by source-tag, not URL (see below).
4. **Stamping `sourceDocumentId`:**
   - jbook scripts: set it inline in the `create`/`update` of each
     `programElementSource/Project/Performer` upsert (only under `--commit`).
   - parse scripts: after `parser.load(...)`, `updateMany` the
     `program_element_year_source_value` rows for that run's `source` tag
     (e.g. `hasc_report_fy27`) → avoids threading the id through the shared writer service that
     600+ tests depend on.
5. **FKs** are real constraints, `ON DELETE SET NULL ON UPDATE CASCADE` (SourceDocuments are never
   deleted; SET NULL keeps provenance rows intact if one ever were). Self-FK
   `supersededByDocumentId → source_document(id)` likewise SET NULL.
6. **Backfill linker strategies** (report broken down per table):
   - URL+exhibit: `program_element_source` rows → doc where `sourceUrl` matches and
     `map(exhibitType) == documentType`.
   - URL+type: `program_element_project` → r2 doc with matching `sourceUrl`;
     `program_element_performer` → r3 doc with matching `sourceUrl`.
   - source-tag: `program_element_year_source_value` → committee/conference/public-law doc via the
     report `source` tag stored in `metadata.sourceTag`.
   Success target: ≥95% of `program_element_source` rows linked; unlinked enumerated with reasons.

## File map

New:
- `apps/api/prisma/migrations/<ts>_add_source_document_registry/migration.sql`
- `apps/api/src/program-element/source-document/source-document-registry.ts` (+ `.spec.ts`)
- `apps/api/src/program-element/source-document/source-document-classify.ts` (+ `.spec.ts`)
- `apps/api/src/program-element/source-document/source-document-linker.ts` (+ `.spec.ts`)
- `apps/api/scripts/backfill-source-documents.ts`
- `apps/api/scripts/__tools__/_doc_header.py`

Modified:
- `apps/api/prisma/schema.prisma` (new model + 4 nullable FK relations)
- `apps/api/scripts/sync-comptroller-jbooks.ts`, `sync-jbook-r2.ts`, `sync-jbook-performers.ts`
- `apps/api/scripts/parse-hasc-sasc-reports.ts`, `parse-defense-approps-reports.ts`,
  `parse-ndaa-conference.ts`, `parse-defense-approps-public-law.ts`
- `apps/api/scripts/__tools__/extract_jbook_r1.py`
- `apps/api/package.json` (add `backfill:source-documents` alias)

## Verification results (2026-06-07, local Postgres `capiro-postgres` pg16)

All run against throwaway scratch DBs (`capiro_sd_test/_add/_shadow`, since dropped); the real
`capiro` dev DB was never touched. Note: connect via `127.0.0.1` not `localhost` — the
@prisma/client runtime hits an IPv6 `::1` dead-end through Docker's port forward.

- **typecheck**: `pnpm --filter @capiro/api typecheck` → clean.
- **jest**: full suite `91 suites / 697 tests` green, incl. 21 new specs (registry idempotency +
  version chain + tool-version reader, classify, linker disambiguation).
- **adversarial review** (multi-agent, dimensions × verify): 7 findings, 6 refuted on verification
  (e.g. the null-sha256 path is unreachable — `UNIQUE(source_key, sha256)` + all callers hash a
  file; the "negative unlinked" claim was false — sync scripts don't write year_source_value). 1
  confirmed (LOW): `extractionToolVersion` was never forwarded → always NULL. **Fixed**: added
  `readDocumentToolVersion` (reads `_document.tool_version`) and threaded it through all 8
  upsert call sites; verified the value round-trips to the column on a scratch DB.
- **migration**: `migrate deploy` applied all 25 prior + mine clean on a fresh DB; applied onto a
  populated DB (seeded `program_element_source` rows) additively — existing rows survived,
  `source_document_id` NULL. Physical columns/indexes/FKs verified via `information_schema`.
- **backfill --commit** (seeded via the wired R-1/R-2/R-3 + parse:hasc): registered **62 documents**
  (1 r1 / 29 r2 / 28 r3 / committee), non-budget artifacts (`peo_roster_*`) skipped, and linked
  **100%** of each table (`program_element_source` 3947/3947 ≥95% ✓, project 1356, performer 5256,
  year_source_value 4742). Re-run → `0 new, 62 deduped`, still 100%.
- **checksum dedup**: R-1 `--commit` twice → 2nd run `sourceDocument.action: "deduped"`.
- **version chain (real DB)**: same sourceKey, sha A→B → new row + old head's
  `supersededByDocumentId` points to B, B is live; re-ingesting sha A returns the original (no dup).

### Pre-existing environment issues (NOT caused by this change)
- The local `capiro` dev DB has prior drift: migration `20260519210000_federal_spending` is recorded
  unapplied while its tables already exist, and `program_element_performer` is missing though its
  migration is recorded applied. `prisma migrate dev` against it would attempt a destructive reset —
  hence all verification used fresh scratch DBs. `schema.prisma` also carries a `fec_contribution`
  unique constraint absent from any migration. These predate Step 0.1 and are out of scope.
