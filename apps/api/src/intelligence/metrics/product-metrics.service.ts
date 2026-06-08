import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ActionStatus } from '../actions/action-recommendation.types.js';

/**
 * Step 4.1 — PRODUCT analytics (§24) computed from EXISTING tables, no new table.
 *
 * Reads `action_recommendation` (tenant-scoped via `withTenant`, so RLS is the visibility
 * source of truth) plus the GLOBAL `program_element_delta` (joined on `deltaId` for the
 * delta→card latency), and rolls everything up by ISO week. Returns a small JSON summary
 * for `GET /api/intelligence/metrics/product`.
 *
 * DEFINITIONS (documented so the number is auditable — see the README in test/__golden__/
 * for the broader honesty caveat on accuracy metrics):
 *
 *  - GENERATED  = every card created in the week (by `createdAt`).
 *  - ACCEPTED   = a card whose workflow advanced past intake — i.e. its current `status`
 *                 is NOT one of {'new','triaged'} AND NOT 'dismissed'/'archived'. That set
 *                 ('assigned'…'monitoring') means a human picked the card up and acted on
 *                 it. This is a CURRENT-STATE proxy: without per-transition history we bucket
 *                 "accepted" by the card's CREATION week, not the week it was accepted in.
 *                 (A precise transition-week metric would read audit_log
 *                 action='intelligence.action.status' — left as a documented follow-up so we
 *                 do not over-claim here.)
 *  - DISMISSED  = current `status === 'dismissed'`, bucketed by creation week.
 *  - NORTH-STAR = "client-specific source-backed actions accepted per week": accepted cards
 *                 that are BOTH client-specific (`clientId` set — always true for this table)
 *                 AND source-backed (carry a `deltaId`, i.e. traceable to a budget delta).
 *                 Bucketed by creation week.
 *
 * Money convention: $ MILLIONS (project-wide) — not relevant to these counts but noted for
 * consistency.
 */

/** Statuses that count as "accepted" (advanced past intake, not terminal-negative). */
const ACCEPTED_STATUSES: ReadonlySet<ActionStatus> = new Set<ActionStatus>([
  'assigned',
  'drafting',
  'ready_for_review',
  'sent_to_client',
  'outreach_completed',
  'monitoring',
]);

/** Intake statuses (generated-but-not-yet-acted). */
const INTAKE_STATUSES: ReadonlySet<ActionStatus> = new Set<ActionStatus>(['new', 'triaged']);

/** One ISO-week row of the product summary. */
export interface WeeklyMetric {
  /** ISO week key, e.g. '2026-W23'. */
  isoWeek: string;
  generated: number;
  accepted: number;
  dismissed: number;
  /** North-star: client-specific, source-backed (deltaId) accepted cards this week. */
  northStarAccepted: number;
}

export interface ProductMetricsSummary {
  /** Per-ISO-week buckets, ascending by week. */
  weekly: WeeklyMetric[];
  totals: {
    generated: number;
    accepted: number;
    dismissed: number;
    northStarAccepted: number;
  };
  /**
   * Median minutes from a delta's `computedAt` to the card's `createdAt`, over cards that
   * carry a `deltaId` whose delta we could resolve. `null` when no such pair exists.
   */
  medianDeltaToCardMinutes: number | null;
  /** Sample size behind `medianDeltaToCardMinutes`. */
  deltaToCardSampleSize: number;
  /** Echoes the definitions above so a dashboard/consumer can render the caveats. */
  definitions: {
    accepted: string;
    dismissed: string;
    northStar: string;
  };
}

/** A minimal card row this service reads. */
interface CardRow {
  status: string;
  clientId: string;
  deltaId: string | null;
  createdAt: Date;
}

@Injectable()
export class ProductMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute the §24 product summary for the caller's tenant. Read-only.
   */
  async getProductMetrics(ctx: TenantContext): Promise<ProductMetricsSummary> {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const cards = (await tx.actionRecommendation.findMany({
        where: { tenantId: ctx.tenantId },
        select: { status: true, clientId: true, deltaId: true, createdAt: true },
      })) as CardRow[];

      // Resolve delta computedAt for the cards that carry a deltaId. program_element_delta
      // is GLOBAL (no RLS) so we read it on the same tx without a tenant predicate.
      const deltaIds = Array.from(
        new Set(cards.map((c) => c.deltaId).filter((d): d is string => !!d)),
      );
      const deltas = deltaIds.length
        ? ((await tx.programElementDelta.findMany({
            where: { id: { in: deltaIds } },
            select: { id: true, computedAt: true },
          })) as Array<{ id: string; computedAt: Date }>)
        : [];
      const computedAtById = new Map(deltas.map((d) => [d.id, d.computedAt] as const));

      return summarizeCards(cards, computedAtById);
    });
  }
}

/**
 * Pure aggregation over already-fetched rows — separated from DB access so the spec can
 * exercise the bucketing/definitions without a live DB. Exported for direct unit testing.
 */
export function summarizeCards(
  cards: readonly CardRow[],
  computedAtById: ReadonlyMap<string, Date>,
): ProductMetricsSummary {
  const buckets = new Map<string, WeeklyMetric>();
  const latencies: number[] = [];

  for (const card of cards) {
    const week = isoWeekKey(card.createdAt);
    const bucket = buckets.get(week) ?? {
      isoWeek: week,
      generated: 0,
      accepted: 0,
      dismissed: 0,
      northStarAccepted: 0,
    };
    bucket.generated++;

    const status = card.status as ActionStatus;
    const isAccepted = ACCEPTED_STATUSES.has(status);
    if (isAccepted) {
      bucket.accepted++;
      // North-star: accepted AND source-backed (deltaId). clientId is always set on this
      // table, so client-specificity is implicit, but we guard for it explicitly.
      if (card.deltaId && card.clientId) bucket.northStarAccepted++;
    }
    if (status === 'dismissed') bucket.dismissed++;

    buckets.set(week, bucket);

    // delta→card latency for cards we can pair with a resolved delta.
    if (card.deltaId) {
      const computedAt = computedAtById.get(card.deltaId);
      if (computedAt) {
        const mins = (card.createdAt.getTime() - computedAt.getTime()) / 60_000;
        // Guard against clock-skew negatives poisoning the median.
        if (mins >= 0) latencies.push(mins);
      }
    }
  }

  const weekly = [...buckets.values()].sort((a, b) => (a.isoWeek < b.isoWeek ? -1 : 1));
  const totals = weekly.reduce(
    (acc, w) => ({
      generated: acc.generated + w.generated,
      accepted: acc.accepted + w.accepted,
      dismissed: acc.dismissed + w.dismissed,
      northStarAccepted: acc.northStarAccepted + w.northStarAccepted,
    }),
    { generated: 0, accepted: 0, dismissed: 0, northStarAccepted: 0 },
  );

  return {
    weekly,
    totals,
    medianDeltaToCardMinutes: median(latencies),
    deltaToCardSampleSize: latencies.length,
    definitions: {
      accepted:
        "status advanced past intake ('new'/'triaged') and not dismissed/archived; " +
        'bucketed by card creation week (current-state proxy, not transition week)',
      dismissed: "status === 'dismissed', bucketed by creation week",
      northStar:
        'accepted cards that are client-specific (clientId set) AND source-backed (deltaId set)',
    },
  };
}

/**
 * ISO-8601 week key `YYYY-Www` (Monday-based, week containing the year's first Thursday).
 * Pure / UTC-based so the bucketing is deterministic regardless of server timezone.
 */
export function isoWeekKey(date: Date): string {
  // Copy to a UTC midnight to avoid DST/TZ drift.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weekday: Mon=1..Sun=7. Shift to the Thursday of this week.
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

/** Median of a numeric array; `null` for an empty array. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
