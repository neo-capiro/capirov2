# Spec: Retire stale old-DoW-directory data (PEs + personnel) and repair person→PE matches

Status: PROPOSED (data-engineering + small schema/read change)
Owner: TBD
Author: investigation handoff (audit 2026-06-05)
Last updated: 2026-06-05

---

## 1. Problem (what the user sees)

The Program Element and acquisition-personnel data was originally bulk-loaded from a
spreadsheet generated from an **old DoW directory**. It was later re-done "the right
way": personnel from the **updated DoW directory (Rev 6, June 2026)** and PEs extracted
from **J-books**. But the old data still displays — stale personnel still appear on PE
detail panels and in the directory (all `status='active'`), stale PEs still resolve, and
even people who *are* still current show their **January** title/org/PE link.

The re-import did not replace the old data; it only layered new data on top.

## 2. Root cause (verified against code + schema)

The pipeline is **additive-only**, and **no read filters by source/status/recency**:

- Re-import of an existing person only adds a source mention — `addSourceMention` updates
  **only** `confidence` + `lastSeenAt`, never canonical fields or status
  (`apps/api/src/acquisition-personnel/acquisition-personnel-writer.service.ts:132-138`).
- The Rev 6 importer calls `addSourceMention` for anyone matched by `nameKey`, sets **no**
  `pePrimary`, and never retires anyone
  (`apps/api/src/acquisition-personnel/importers/dow-directory-v6-importer.ts:198-202`,
  `buildRecord` 121-154).
- `markDeparted()` exists and emits a `person_departed` event
  (`acquisition-personnel-writer.service.ts:195-249`) but **no job calls it** and nothing
  diffs the new directory against the old.
- The old import set `pePrimary` directly from the spreadsheet's `PE/BLI` column and wrote
  PEs under `source='stanford_pe_directory_jan2026'`
  (`apps/api/src/acquisition-personnel/importers/stanford-dow-importer.ts:225,416-432`).
- `upsertProgramElement` is keyed on `peCode` and overwrites `source` on update
  (`apps/api/src/program-element/program-element-writer.service.ts:165-171`) — so any PE the
  J-book touched lost the stanford tag; PEs still bearing `stanford_pe_directory_jan2026`
  are exactly those the J-book did **not** cover.
- Reads filter by PE code only — no source/status/recency
  (`acquisition-personnel-read.service.ts:197-210`, list 19-49).
- `pePrimary` / `peSecondary` are plain `VarChar(16)` / `String[]` with **no FK** to
  `program_element` (`apps/api/prisma/schema.prisma:1996-1997`). Deleting a PE orphans the
  link silently.
- The matcher only re-evaluates people with `pePrimary IS NULL`
  (`apps/api/scripts/generate-pe-person-candidates.ts:57-64`) and confirm sets the link only
  `where pePrimary: null` (`acquisition-personnel-read.service.ts:502-507`) — so old links
  are **frozen** and never re-pointed at the authoritative J-book PEs.

### Source-tag map (the keys this whole cleanup turns on)

| | OLD (one-time, deprecated) | NEW (authoritative / ongoing) |
|---|---|---|
| Personnel | `stanford_dow_directory_jan2026`, `stanford_dow_tier1`, `stanford_dow_congressional_staff_jan2026` (observed 2026‑01‑15) | `dow_directory_rev6_2026_06` (observed 2026‑06‑03); also peo-rosters, press, SAM, hearings, GAO |
| PEs | `stanford_pe_directory_jan2026` | `dod_comptroller_r1_fy2027` (R‑1), `sync-jbook-r2` (R‑2/R‑2A), P‑docs, committee marks |

## 3. Goal / acceptance

- Personnel that the **updated directory dropped** no longer display as current contacts,
  without fabricating "departure" events for rows that were never real.
- Program Elements that exist **only** because of the old spreadsheet (and have no live
  signal) no longer display; real-but-uncovered PEs are **kept**, not destroyed.
- Person→PE matches are **re-validated against the J-book set**: links to authoritative PEs
  are kept; stale/old-spreadsheet links to non-authoritative codes are cleared and
  re-proposed for review. No dangling `pePrimary` strings remain.
- The pipeline stops regressing: a future directory re-import auto-reconciles, and reads
  exclude superseded/departed rows by default.
- Everything is **measurable** (a read-only count verb), **reversible** (soft supersede,
  no blind deletes), and **idempotent** (dry-run default, `--commit` to write).

Definition of done: the four phases below land with tests; a dry-run report shows the
before/after counts; no regression in the PE matcher or district enrichment.

## 4. Scoping decisions (resolve at kickoff — see Open Questions)

- **Congressional staff carve-out.** Rev 6 re-covers the DoW acquisition population, **not**
  congressional staff. `stanford_dow_congressional_staff_jan2026`-only people have no newer
  source replacing them — they are **out of scope** for supersede (don't retire them just
  for being stanford-sourced).
- **Soft over hard.** Supersede = set a timestamp + reason and exclude from reads. No hard
  `DELETE` in the automated path; provenance, merge history, and candidate queue stay intact
  and the action is reversible (set the timestamp back to null).
- **Departed vs superseded are distinct.** "Departed" is a real-world signal (emit a
  change-feed event). "Superseded" means "the old bad load shouldn't surface" (no event).
  Use separate fields, not an overloaded `status`.

## 5. Schema changes

Add a soft-supersede marker to both tables (migration follows the repo deploy rule: migrate
task def **pins a specific image SHA**, dump td → swap image → strip read-only fields →
register → run → verify "All migrations have been successfully applied"):

- `AcquisitionPersonnel`: `supersededAt DateTime? @map("superseded_at")`,
  `supersededReason String? @map("superseded_reason")` + index on `supersededAt`.
- `ProgramElement`: `retiredAt DateTime? @map("retired_at")`,
  `retiredReason String? @map("retired_reason")` + index.

(Keep the existing `status` semantics untouched. We intentionally do **not** add a FK on
`pePrimary` — `peSecondary` is an array and can't carry one — so referential integrity is
enforced by the orphan-link sweep in Phase 4, not the DB.)

## 6. Phased plan

### Phase 0 — Read-only audit verb (ship first, no writes)

New `scripts/diag-stale-directory.ts`, wired into `entrypoint.sh` as `diag-stale-directory`
(mirror `report-award-pe-coverage` / `diag-profile-v1`). Prints JSON counts + small samples:

- `program_element` where `source='stanford_pe_directory_jan2026'` (stale PEs), split by
  "has live reference" vs "no live reference".
- `acquisition_personnel` whose source mentions are **all** in the deprecated set, split by
  DoW-directory population vs congressional-only.
- People whose `pePrimary`/`peSecondary` code has **no surviving `program_element` row**
  (already-orphaned links).
- People present in **both** directories (have a `dow_directory_rev6_2026_06` mention) whose
  canonical `title`/`organization` still equals the Jan values (stale-attribute count).
- Linked-to-a-PE counts for each stale set (what actually surfaces on panels).

Gate: we state real numbers before mutating anything.

### Phase 1 — Stop displaying stale personnel (immediate relief, reversible)

1. `scripts/reconcile-personnel-supersede.ts` (dry-run default, `--commit`, batched,
   idempotent): for each DoW-directory-population person whose mentions are **all** deprecated
   and who has **no** `dow_directory_rev6_2026_06` mention, set `supersededAt`/`supersededReason`.
   Does **not** emit `person_departed` (these are data-supersede, not departures). Logs
   before/after counts. Congressional-only people skipped.
2. Read guard: `getProgramElementPersonnel`, `listPersonnel`, `getPersonDetail` exclude
   `supersededAt IS NOT NULL` (and `status='departed'`) by default; add an explicit
   `include_superseded` flag for admin/debug. (`acquisition-personnel-read.service.ts`.)
3. Root-cause hook: have `import-dow-directory-v6` (and future directory revisions) call the
   reconcile at the end, scoped to the population that import covers — so the next refresh
   self-cleans.

### Phase 2 — Reconcile stale PEs (triage, never blind-delete)

`scripts/reconcile-stale-pes.ts` (dry-run default, `--commit`): for each
`source='stanford_pe_directory_jan2026'` PE, compute a **live-reference** signal — any of:
a non-superseded person links to it; a `program_element_watch`; a `client_capability.peNumber`;
a `federal_award.pe_code`; `congress_bill.pe_codes`; a `program_element_year`/procurement_line
with real data; appears in any J-book artifact.

- **Has live reference →** keep (real PE the J-book simply hasn't covered yet). Optionally
  enqueue for P-doc/J-book backfill.
- **No live reference →** set `retiredAt`/`retiredReason`. PE reads exclude `retiredAt IS NOT NULL`.

No hard delete (watches/awards/bills reference the code with no FK). Retirement is reversible.

### Phase 3 — Repair person→PE matches (re-validate against J-books)

`scripts/repair-person-pe-links.ts` (dry-run default, `--commit`):

- **Keep** links whose target PE is authoritative (non-retired, non-stanford source) — these
  are correct and stable (the code survived the J-book upsert).
- **Clear** `pePrimary` (and strip `peSecondary` entries) where the target code is retired,
  missing, or stanford-only **AND** the link is not human-trusted. "Trusted" = a
  `program_element_person_candidate` with `status='confirmed'` or a `pe_match_confirmed`
  source mention exists; everything else is old-spreadsheet-derived and re-evaluable.
- After clearing, re-run `generate-pe-person-candidates --commit` (matcher now sees these as
  `pePrimary IS NULL`) → human review confirms the J-book-correct PE. No auto-apply.
- Sweep any remaining dangling references (`pePrimary NOT IN (SELECT pe_code FROM program_element WHERE retired_at IS NULL)`).

### Phase 4 — Hardening (stop the regression)

- Promote newer-source canonical fields on re-import (or a periodic "refresh canonical from
  latest authoritative source mention" pass) so people in both directories stop showing Jan
  attributes — `addSourceMention` / a follow-on updater.
- Periodic orphan-link sweep (cron) so a future PE delete/retire can't silently strand links.
- Optionally surface `superseded`/`retired`/`departed` distinctly in the admin UI rather than
  just hiding (so capiro_admin can audit what was suppressed and un-supersede if wrong).

## 7. New / changed code (summary)

- `scripts/diag-stale-directory.ts` (Phase 0, read-only) + `entrypoint.sh` verb.
- `scripts/reconcile-personnel-supersede.ts`, `scripts/reconcile-stale-pes.ts`,
  `scripts/repair-person-pe-links.ts` (+ entrypoint verbs; schedule recurring ones via
  EventBridge/CDK).
- `acquisition-personnel-read.service.ts` + `program-element-read.service.ts`: exclude
  superseded/retired by default; add `include_*` debug flags.
- `dow-directory-v6-importer.ts` / `import-dow-directory-v6.ts`: invoke the supersede
  reconcile at end of import.
- Prisma migration for `superseded_at`/`superseded_reason` (+ `retired_at`/`retired_reason`).
- A shared `DEPRECATED_PERSONNEL_SOURCES` / `DEPRECATED_PE_SOURCES` constant + a
  `classifyStaleness()` helper (single source of truth for "stale vs current").

## 8. Tests

- Unit: `classifyStaleness` — stanford-only DoW person → supersede-eligible; congressional-only
  → skipped; person with a Rev 6 mention → kept; PE with a live reference → kept, without →
  retire.
- Unit: link-repair decision — trusted (confirmed candidate) link kept; untrusted link to a
  retired/missing code cleared; `peSecondary` stripping.
- Idempotency: re-running each reconcile/repair with `--commit` is a no-op the second time.
- Read filters: superseded/retired excluded by default, included with the flag.
- Regression: PE matcher and `enrich-award-districts` unaffected.
- No live deploy in this task without explicit go-ahead.

## 9. Execution / deploy notes (repo-specific)

- CI image builds are broken; deploy manually (local `docker buildx` → ECR + ECS
  `force-new-deployment`). Migration task def must **pin the just-pushed image SHA**, not
  `:latest`.
- Prod is the `capiro-dev` ECS cluster (single cluster in us-east-1). Run each script as a
  one-off ECS task via its entrypoint verb; read results from CloudWatch logs.
- `pnpm lint` is broken repo-wide — gate with **typecheck + prettier + tests**.
- Order of operations on prod: Phase 0 (measure) → review numbers → Phase 1 (`--commit`) →
  verify panels → Phase 2 → Phase 3 → re-run matcher + review queue. Each step dry-run first.

## 10. Open questions

1. **Congressional staff:** leave as-is, or source a fresh congressional roster before
   deciding their fate? (They have no Rev 6 replacement.)
2. **Real-but-uncovered PEs (Phase 2 "keep" bucket):** backfill from P-docs/J-book now, or
   accept the coverage gap and just keep them visible?
3. **Trusted-link definition (Phase 3):** is "confirmed candidate OR `pe_match_confirmed`
   source" the right bar, or do we also trust certain old-import links (e.g. Tier 1)?
4. **Departed vs superseded UX:** hide both, or show superseded distinctly to admins?
5. **Ever hard-delete?** Or is soft supersede/retire the permanent end state?
