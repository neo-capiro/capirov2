/**
 * Step 1.3 — Budget-position loader (idempotent upsert by natural key).
 *
 * A small, reusable writer that upserts ProgramElementBudgetPosition rows keyed by
 * (peCode, positionCycle, assertedFy, valueKind). Re-running a sync over the same
 * artifact is a no-op-or-update — never a duplicate — so loaders default to dry-run
 * and stay safe to re-run.
 *
 * DATA-PENDING (Step 1.3 DEFER): the committed jbook_r1_fy2027.json carries only
 * {peCode, title, budgetActivity, lineNumber, page} — NO per-FY dollar/outyear
 * columns — so sync-comptroller-jbooks emits ZERO positions from it today. This
 * writer is built to consume per-FY columns the MOMENT the R-1 artifact is
 * regenerated with FYDP outyears (PY/CY/BY1..BY5) and the FY2026 prior-PB book lands.
 * See buildPositionsFromFyColumns for the shape it will consume.
 *
 * Works against either PrismaService / PrismaClient (both expose
 * `programElementBudgetPosition`) or an in-memory mock implementing the narrow
 * delegate below — so the upsert idempotency is unit-tested without a DB.
 */

export interface BudgetPositionRow {
  id: string;
  peCode: string;
  positionCycle: string;
  assertedFy: number;
  valueKind: string;
  [key: string]: unknown;
}

export interface BudgetPositionDelegate {
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<BudgetPositionRow>;
}

export interface BudgetPositionClient {
  programElementBudgetPosition: BudgetPositionDelegate;
}

/** One position to load (already normalized to $ MILLIONS for total/unit_cost). */
export interface UpsertBudgetPositionInput {
  peCode: string;
  /** 'pb_fy2027' | 'pb_fy2026' | 'hasc_fy2027' | 'enacted_fy2026' | ... */
  positionCycle: string;
  /** The fiscal year the value is FOR (the FYDP column). */
  assertedFy: number;
  /** $ millions for value_kind 'total'/'unit_cost'; the unit count for 'quantity'. */
  amount: number;
  /** Optional unit count alongside a dollar 'total' row. */
  quantity?: number | null;
  valueKind?: 'total' | 'quantity' | 'unit_cost';
  sourceUrl?: string | null;
  pageNumber?: number | null;
  sourceDocumentId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertBudgetPositionResult {
  position: BudgetPositionRow;
  /** True when this (peCode, cycle, assertedFy, valueKind) was inserted; false on update. */
  created: boolean;
}

/**
 * Idempotent upsert of one budget position by its natural key. The create path stamps
 * all provenance; the update path refreshes the mutable value/provenance fields but
 * leaves the natural key + createdAt intact, so re-runs converge.
 */
export async function upsertBudgetPosition(
  client: BudgetPositionClient,
  input: UpsertBudgetPositionInput,
): Promise<UpsertBudgetPositionResult> {
  const valueKind = input.valueKind ?? 'total';
  const mutable = {
    amount: input.amount,
    quantity: input.quantity ?? null,
    sourceUrl: input.sourceUrl ?? null,
    pageNumber: input.pageNumber ?? null,
    sourceDocumentId: input.sourceDocumentId ?? undefined,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  const before = await peekExisting(client, input, valueKind);
  const position = await client.programElementBudgetPosition.upsert({
    where: {
      // Prisma compound-unique input name from @@unique([peCode, positionCycle, assertedFy, valueKind]).
      peCode_positionCycle_assertedFy_valueKind: {
        peCode: input.peCode,
        positionCycle: input.positionCycle,
        assertedFy: input.assertedFy,
        valueKind,
      },
    },
    create: {
      peCode: input.peCode,
      positionCycle: input.positionCycle,
      assertedFy: input.assertedFy,
      valueKind,
      ...mutable,
    },
    update: mutable,
  });

  return { position, created: before === null };
}

/**
 * Best-effort read of whether the row already existed, to report created vs updated.
 * The delegate only requires `upsert`; when a `findUnique` is present (real Prisma) we
 * use it, otherwise we conservatively report created=false (a mock that wants accurate
 * created flags can implement findUnique). This keeps the narrow interface minimal.
 */
async function peekExisting(
  client: BudgetPositionClient,
  input: UpsertBudgetPositionInput,
  valueKind: string,
): Promise<BudgetPositionRow | null> {
  const delegate = client.programElementBudgetPosition as BudgetPositionDelegate & {
    findUnique?: (args: { where: Record<string, unknown> }) => Promise<BudgetPositionRow | null>;
  };
  if (typeof delegate.findUnique !== 'function') return null;
  return delegate.findUnique({
    where: {
      peCode_positionCycle_assertedFy_valueKind: {
        peCode: input.peCode,
        positionCycle: input.positionCycle,
        assertedFy: input.assertedFy,
        valueKind,
      },
    },
  });
}

/**
 * Map an artifact's per-FY columns to position inputs. The R-1/R-2 funding tables print
 * a set of fiscal-year columns (prior year, current year, budget year, then BY+1..BY+5
 * outyears); each becomes one assertedFy='total' position under the artifact's cycle.
 *
 * The artifact format is NOT yet finalized (DATA-PENDING), so this consumes a permissive
 * shape: a record of { [assertedFy]: dollarsOrMillions } plus a normalizer. It writes a
 * position only for finite, non-null amounts (an absent/dashed FY column is skipped, not
 * written as 0). Returns the inputs; the loader feeds them through upsertBudgetPosition.
 */
export function buildPositionsFromFyColumns(args: {
  peCode: string;
  positionCycle: string;
  /** { 2027: 278500000, 2028: 281000000, ... } — values in the artifact's native unit. */
  fyColumns: Record<number | string, number | null | undefined>;
  /** Convert one native-unit value to $ millions (e.g. dollarsToMillions). */
  toMillions: (v: number | null | undefined) => number | null;
  sourceUrl?: string | null;
  pageNumber?: number | null;
  sourceDocumentId?: string | null;
}): UpsertBudgetPositionInput[] {
  const out: UpsertBudgetPositionInput[] = [];
  for (const [rawFy, rawVal] of Object.entries(args.fyColumns)) {
    const assertedFy = Number(rawFy);
    if (!Number.isInteger(assertedFy)) continue;
    const millions = args.toMillions(typeof rawVal === 'number' ? rawVal : rawVal ?? null);
    if (millions === null || !Number.isFinite(millions)) continue;
    out.push({
      peCode: args.peCode,
      positionCycle: args.positionCycle,
      assertedFy,
      amount: millions,
      valueKind: 'total',
      sourceUrl: args.sourceUrl ?? null,
      pageNumber: args.pageNumber ?? null,
      sourceDocumentId: args.sourceDocumentId ?? null,
    });
  }
  return out;
}
