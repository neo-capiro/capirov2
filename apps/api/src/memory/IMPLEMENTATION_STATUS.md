# Institutional Memory — Implementation Status & Verification

Branch: `feat/institutional-memory` (isolated worktree, off `origin/main`)
Plan: `~/.hermes/plans/2026-06-25-capiro-obsidian-memory-plan.md`

## What was built and VERIFIED this session

The load-bearing core of the dual-representation memory layer (plan §0.5):
the canonical store schema, the store↔markdown projection/parse-back, identity
seeding, and the scoped store service + retrieval controller.

### Files (apps/api/src/memory/)
- `memory.types.ts` — canonical MemoryItem / MemorySection / MemoryEdge types.
- `memory-render.helpers.ts` — store → Obsidian-markdown projection (pure).
- `memory-parse.helpers.ts` — markdown → store parse-back + wikilink extraction (pure).
- `memory-seed.helpers.ts` — firm + client identity-file skeletons (human-owned).
- `memory-store.service.ts` — tenant-scoped CRUD via withTenant/withSystem + edge derivation.
- `memory.controller.ts` — read-only retrieval surface (consumption path).
- `memory.module.ts` — Nest module wiring.
- `memory-render-parse.helpers.spec.ts` — jest spec mapping 1:1 to success criteria.

### Schema (apps/api/prisma/) — AUTHORED, NOT APPLIED (Neo DB guardrail)
- `memory.schema-fragment.prisma` — MemoryItem + MemoryEdge models to merge into schema.prisma.
- `memory.migration.sql` — table DDL + RLS policies (matches migration 20260501000000 pattern).

## Verification (actually run, not claimed)

Pure helpers compiled with the project's exact strictness
(`strict: true` + `noUncheckedIndexedAccess: true`) via the repo's own tsc:
**0 type errors.** Two real bugs were caught by the typecheck and fixed
(import-type-used-as-value on Prisma; unchecked indexed access in the parser).

Runtime assertion harnesses (27 assertions total, all PASS):

```
harness.mjs (render/parse):           16 passed, 0 failed
harness-seed.mjs (seeding):           11 passed, 0 failed
```

### Success-criteria coverage proven by tests
| # | Criterion | Status |
|---|-----------|--------|
| 3 | tenant_id always present; null tenant fail-closed-rejected | VERIFIED |
| 5 | wikilinks → de-duplicated typed graph edges | VERIFIED |
| 6 | idempotent byte-identical re-render | VERIFIED |
| 7 | one canonical vault path per item (client-scoped + user-private) | VERIFIED |
| 8 | complete client hub (hub+soul+compass+people), identity=human-owned | VERIFIED |
| 9 | render→parse→render round-trip byte-identical (parse-back de-risked) | VERIFIED |

### Criteria NOT yet verifiable here (need runtime/DB/approval)
| # | Criterion | Blocker |
|---|-----------|---------|
| 1,2 | end-to-end user/firm memory surfaces | needs Nest runtime + DB |
| 3 (DB) | RLS cross-tenant returns zero rows at the DB | needs migration applied (gated) |
| 4 | email client-scoping reuse | Graph/email ingestion (EMAIL guardrail) |
| 10 | AI reads memory at runtime | needs retrieval API + Meri wiring (Phase 2) |
| 11 | no auth/email changes | HELD — nothing in this branch touches auth/email |

## Guardrails honored
- No DB migration applied anywhere (authored only).
- No auth (Clerk/tenant middleware/JWT) or email/Graph code touched.
- Isolated worktree; explicit-path staging only (shared multi-worktree repo).
- node_modules symlink was non-functional on this Windows/OneDrive host, so the
  full Nest build/jest run could not execute here; pure logic was verified by
  compiling against the repo's real tsc + standalone Node harnesses. The jest
  spec is committed and will run in CI where node_modules is real.

## Next steps (gated — need Neo's go)
1. Apply migration to devbox/staging (NOT prod) to verify RLS criterion #3 at DB.
2. Phase 2: retrieval API + embeddings (criterion #10) — the "advertised
   capability actually works" milestone.
3. Phase 2 ingestion: Graph email / Meri / meetings — EMAIL guardrail, needs approval.
4. Phase 3: Intelligence Center knowledge-graph tab.
