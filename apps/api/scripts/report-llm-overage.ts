/**
 * LLM overage metering as a one-shot Fargate task (run daily via scheduled
 * task / cron).
 *
 *   report-llm-overage
 *
 * For every paying tenant it computes month-to-date real LLM cost vs the pooled
 * allowance ($20 × client_slots by default) and reports the incremental billable
 * overage (2× the excess) to the Stripe metered "overage" price. Idempotent:
 * tenant_usage_meters tracks what was already reported per period, so re-running
 * the same day reports nothing new. No-ops cleanly when Stripe / the overage
 * price is not configured (logs the computed amounts without reporting).
 *
 * Boots a Nest application context (no HTTP server) to reuse BillingOverageService
 * with its real Prisma + Stripe + usage wiring. Mirrors prepopulate-all.ts.
 */
import { config as dotenvConfig } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

dotenvConfig();

// Load the Nest graph from COMPILED dist (tsc decorator metadata); fall back to
// src for local dev. tsx/esbuild does not emit reliable decorator metadata.
async function loadNest(): Promise<{ AppModule: any; BillingOverageService: any }> {
  for (const base of ['../dist', '../src']) {
    try {
      const app = await import(`${base}/app.module.js`);
      const overage = await import(`${base}/billing/billing-overage.service.js`);
      return { AppModule: app.AppModule, BillingOverageService: overage.BillingOverageService };
    } catch {
      // try next base
    }
  }
  throw new Error('Could not load AppModule from dist or src');
}

async function main(): Promise<void> {
  const logger = new Logger('report-llm-overage');
  const { AppModule, BillingOverageService } = await loadNest();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error', 'log'],
  });
  try {
    const svc = app.get(BillingOverageService);
    const results = await svc.reportOverageForAllTenants();
    const reported = results.filter(
      (r: { reportedDeltaCents: number }) => r.reportedDeltaCents > 0,
    );
    logger.log(
      `Processed ${results.length} paying tenant(s); reported overage for ${reported.length}.`,
    );
    for (const r of reported) {
      logger.log(
        `  ${r.tenantSlug}: +${r.reportedDeltaCents}¢ (used $${r.usedUsd.toFixed(2)} / allow $${r.allowanceUsd.toFixed(2)})`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('report-llm-overage failed', err);
  process.exit(1);
});
