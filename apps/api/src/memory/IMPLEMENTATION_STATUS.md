# Institutional Memory — Implementation Status & Verification

Branch: `feat/institutional-memory` (isolated worktree, off `origin/main`)
Plan: `~/.hermes/plans/2026-06-25-capiro-obsidian-memory-plan.md`

## Commits
- 07b2aac — core: store/render/parse/seed + RLS schema
- bd10cf8 — strict-mode fix (caught by real typecheck)
- e523662 — Phase 3 knowledge-graph builder
- cd5933d — Phases 2-4: ingestion, retrieval+graph API, governance

## ALL PHASES BUILT AS CODE (no migration applied, no AWS deploy — per Neo)

### Phase 0/1 — store + projection + identity
- memory.types.ts, memory-render.helpers.ts, memory-parse.helpers.ts
- memory-seed.helpers.ts (firm + client identity skeletons, human-owned)
- memory-store.service.ts (tenant-scoped via withTenant/withSystem + edge derivation)
- memory.module.ts, memory.controller.ts
- prisma/memory.schema-fragment.prisma + prisma/memory.migration.sql (AUTHORED, NOT APPLIED)

### Phase 2 — ingestion + consumption
- memory-ingest.helpers.ts: email/meeting/meri renderers; client-scoping fidelity (#4),
  one-canonical-location routing (#7); Meri sessions always user-private with
  human-gated promotion candidates (§12.1)
- retrieval API: GET /memory/items, /memory/items/:type/:slug/markdown (consumption #10)

### Phase 3 — knowledge graph
- memory-graph.helpers.ts: merge DB FKs + wikilink edges, provenance-tagged,
  depth-bounded walk ("history with this entity")
- GET /memory/graph?seed=&depth= (Intelligence Center tab data source)

### Phase 4 — governance
- memory-governance.helpers.ts: retention purge, client/user offboarding purge,
  legal-hold selection, redaction, export manifest — all over frontmatter metadata (§11.2)

## VERIFICATION (project's real toolchain, run each turn)
- Typecheck (repo tsc, full project): **src/memory 0 errors** across 14 files
- Jest (repo runner): **33/33 tests across 4 suites** (render/parse, graph, ingest, governance)
- Method: temp-stage src/memory into MAIN checkout (real node_modules), run, move out.
  Worktree node_modules symlink is non-functional on this OneDrive host; MAIN is
  always restored clean (its own branch untouched).

### Success criteria
| # | Criterion | Status |
|---|-----------|--------|
| 1 | user sees email/prep/debrief/meri in one place | CODE COMPLETE (needs runtime+DB to demo) |
| 2 | firm client hub with full detail | CODE COMPLETE (needs runtime+DB) |
| 3 | tenant_id mandatory, fail-closed; RLS isolation | LOGIC VERIFIED; DB-level needs migration applied |
| 4 | email client-scoping reuse, no domain bleed | VERIFIED (ingest spec) |
| 5 | graph from FKs ⊕ wikilinks, queryable | VERIFIED (graph spec) |
| 6 | idempotent re-render | VERIFIED |
| 7 | one canonical location per item | VERIFIED |
| 8 | complete human-owned client hub | VERIFIED |
| 9 | render→parse round-trip parity | VERIFIED |
| 10 | AI reads memory at runtime | API BUILT; live Meri wiring + DB needed to demo |
| 11 | (guardrail lifted by Neo for this work) | n/a |

## REMAINING — gated on Neo's explicit go (per "no migrations / no AWS yet")
1. Apply migration (prisma/memory.migration.sql) to a DB → unlocks #3 at DB layer,
   regenerates Prisma client, enables the service/controller to run live.
2. Wire FK loader (client→bill, person→office) into GET /memory/graph for richer graph.
3. Wire ingestion workers to Graph/Meri/meeting events (code renderers ready).
4. Frontend: Intelligence Center "Knowledge Graph" tab consuming GET /memory/graph.
5. Deploy to AWS.

Items 1 and 5 are explicitly held for Neo's signal. 2-4 are additional wiring
that depends on 1 (the live Prisma client).
