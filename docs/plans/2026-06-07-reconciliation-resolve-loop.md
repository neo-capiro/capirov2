# Step 0.2 — Close the reconciliation loop + extraction-totals harness

Status: in progress (2026-06-07)
Plan refs: §4.2 reconciliation ≥98%; §23 analyst tools; UI §12.5

## TASK A — resolvable reconciliation review queue

The `ReconciliationReviewQueue` model already has `status`/`resolvedByUserId`/`resolvedAt`/
`resolutionNotes` (no migration needed). `GET /program-elements/admin/reconciliation-queue` and the
web page exist but are read-only. We add resolve.

### Decisions
- **Accept through the writer path via a top-priority `manual_override` source.** `buildMergedYear`
  has no force flag — a lower-priority source can never overwrite canonical (writer.ts:440). So we
  add `'manual_override'` at **index 0** of `SOURCE_PRIORITY` (types.ts). Resolving
  `accept_conflicting`/`manual_value` calls `writer.upsertProgramElementYear({peCode, fy, [field]:
  value}, 'manual_override')`: rank 0 ≤ any current rank ⇒ `buildMergedYear` accepts it, the canonical
  row updates, and `logSourceValue` flips `is_winner` on the new `__row__` row. The override then
  *sticks* across future syncs (highest priority) — correct for an explicit admin decision. No writer
  bypass.
- **`reconcile()` guard**: an override must not re-queue itself. `reconcile()` skips *queueing* (still
  logs the per-source value) when `source === 'manual_override'`. Small, isolated change.
- **Units**: queue `conflictingValue` and `manualValue` are in **$ millions** (reconcile logs the
  already-millions value; `normalizeYearInput` does no unit conversion). Pass straight through.
- **Endpoint**: `POST /program-elements/admin/reconciliation-queue/:id/resolve`, `@Roles('capiro_admin')`,
  body `{decision: 'keep_current'|'accept_conflicting'|'manual_value', manualValue?, notes?}` — mirrors
  `acquisition-personnel.controller.ts` `resolveMergeQueue` (controller injects the writer, passes a
  callback; read-service owns queue-status + AuditLog).
- **AuditLog + RLS**: the queue is global, but `AuditLog` is tenant-scoped (RLS). Do the queue update +
  audit inside `this.prisma.withTenant(ctx.tenantId, tx => …)` (mirrors `setWatching`) so the audit
  insert passes RLS; `resolvedByUserId = ctx.userId`.
- `keep_current` writes nothing to the year row — only marks the entry resolved.

### Web
PeReconciliationPage gains a **status filter** (open|resolved|all) and an **Actions** column: Keep
(Popconfirm) / Accept conflicting (Popconfirm) / Manual value (Modal with InputNumber + notes). Mirrors
`PersonCandidatesPage` (`useMutation` + `message` + `qc.invalidateQueries`). POSTs to the same base path
the page already uses for GET.

## TASK B — extraction-totals reconciliation harness

### Decisions
- **Control totals NOT from R-1.** The committed R-1 artifact carries no per-line dollars (only
  peCode/title/BA/page). PB `request` and committee `mark` dollars live in `armed_services_*.json`. So
  `control_totals.json` is seeded by **summing the committed committee artifacts' `request`/`mark`
  columns** (dollars→millions), grouped by `(fiscalYear, budgetCycle, component)`. Provenance is
  documented in the file; hand-entered R-1 summary-page totals can replace/augment entries later.
- **DB-driven iteration + SKIP.** The harness iterates `(fy, field, component)` groups **that have data
  in `program_element_year`** (component derived from `serviceFromPeCode(peCode)`), compares each to the
  matching control entry, PASS at ≤0.5% relative delta. Groups with no DB data are never iterated
  (so a fresh/partial DB doesn't FAIL); a DB group with no control entry is reported SKIP (can't
  validate), not FAIL. Exit 1 on any FAIL; `--json` for CI; `--seed` regenerates `control_totals.json`
  from artifacts (no DB).
- **Testable core** in `src/program-element/reconciliation/budget-reconciliation.ts`
  (`fieldToCycle`, `componentForPeCode`, `computeGroupResult`, `checkBudgetReconciliation(prisma,
  control)`), imported by the script AND preflight. Scripts aren't jest-matched, so the logic lives in
  `src/`.
- **Preflight wiring**: `preflight-ingestion.ts` runs `checkBudgetReconciliation` as a "data integrity"
  section when `DATABASE_URL` is set and `control_totals.json` exists; FAILs fold into the exit-1
  condition (unless `--warn-only`). Gracefully SKIPs on no DB / no control / no data, so env-only and
  fresh-DB runs are unaffected.

## File map
New: `src/program-element/reconciliation/budget-reconciliation.ts` (+ `.spec.ts`);
`src/program-element/reconciliation/reconciliation-resolve.service.spec.ts`;
`scripts/verify-budget-reconciliation.ts`; `scripts/__data__/control_totals.json`;
`apps/web/src/pages/admin/PeReconciliationPage.test.tsx`.
Modified: `src/program-element/types.ts`; `reconciliation/reconciliation.service.ts`;
`program-element-read.service.ts`; `program-element.controller.ts`; `program-element.controller.spec.ts`;
`apps/web/src/pages/admin/PeReconciliationPage.tsx`; `scripts/preflight-ingestion.ts`;
`apps/api/package.json`.

## Verification results (2026-06-07, scratch DB capiro_sd2, since dropped; real dev DB untouched)

- **typecheck**: `@capiro/api` + `@capiro/web` both clean.
- **jest** (API): full suite **93 suites / 715 tests** green incl. new specs — resolve transitions
  (keep/accept/manual + 400 on missing manualValue + 404/400 guards), writer-path consistency
  (accept via `manual_override` updates canonical, flips `is_winner`, preserves other fields, does
  NOT re-queue), authz (`RolesGuard` → `standard_user` 403 / `capiro_admin` allowed on both admin
  endpoints), and budget-reconciliation logic (PASS/FAIL/SKIP, corruption flips ok=false).
- **vitest** (web): full suite **24 files / 97 tests** green incl. PeReconciliationPage.test
  (resolve controls Keep/Accept/Manual… + status-filter combobox render; Keep→Popconfirm POSTs
  `decision=keep_current`; Manual… opens the value modal; resolved rows show a status tag not
  controls) — this is the DOM-level evidence of the resolve controls + status filter.
- **resolve end-to-end (real DB)**: seeded R-1 (847 PEs) + parse:hasc FY2027 (792 marks),
  manufactured an open `hascMark` conflict on PE 0101113F, resolved `accept_conflicting`:
  `hascMark` 1478.65 → **2217.98**, visible via **`getTimeline` before/after**;
  `winning_source = manual_override`; entry `status=resolved` + `resolvedByUserId` + notes;
  1 AuditLog row written.
- **verify-budget-reconciliation (real DB)**: FY2027 pb+hasc across all 6 components — **16/16 PASS
  at ~0.000%**. Corrupting one request value → ARMY pb `extracted 39513.99 vs control 18197.30
  (117%) FAIL`, **exit 1**; restore → 16/16 PASS, exit 0. `control_totals.json` seeded from the
  committed committee artifacts (40 groups, FY2026+FY2027).

### Adversarial review (multi-agent) + fixes
8 findings, 2 refuted on verification (claimed "FY2027 USMC groups missing" — present; claimed
controller-spec `hasData` mismatch — `toHaveBeenCalledWith` ignores `undefined`). 6 confirmed + fixed:
- **HIGH** `--seed` double-counted `pb/request` across HASC+SASC files for a year (FY2026 pb doubled
  in the committed file) → would hard-fail preflight on any DB with FY2026 data. Fixed: dedupe the PB
  request per `(fy, peCode)` (it's one figure regardless of chamber); re-seeded `control_totals.json`
  (FY2026 ARMY pb 28147.48 → 14073.74; FY2027 unchanged).
- **HIGH** web GET+POST missing the `/api/` global prefix (the *original* GET also lacked it — a
  pre-existing latent bug). Fixed both calls + test assertions.
- **LOW** `accept_conflicting` with a null `conflictingValue`: `Number(null)===0` slipped past the
  guard and could write $0. Fixed (validate the raw value before coercion) + added a spec.
- **LOW** resolve write is not atomic with the status/audit tx. Kept the fail-safe ordering (apply →
  mark; a failure leaves the entry OPEN + retry is idempotent) and documented the contract in code.
- **LOW** used the static antd `message` singleton → switched to `App.useApp()` (matches sibling pages).
- **LOW** no web test for the Accept Popconfirm path → added one.

### Scope note
The working tree also carries concurrent, unrelated work (`apps/api/src/workflows/*`,
`whitepaper.*`, `docs/whitepaper-audit-and-plan.md`, `pnpm-lock.yaml`) from another session — NOT
part of Step 0.2 and left untouched. The full typecheck + suites (which include those files) pass.
