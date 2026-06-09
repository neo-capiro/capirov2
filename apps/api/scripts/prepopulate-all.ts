/**
 * Prepopulation backfill as a one-shot Fargate task (Task A, step 3).
 *
 *   prepopulate-all                 → every active tenant
 *   prepopulate-all --tenant <uuid> → one tenant
 *
 * Runs ClientPrepopulationService.prepopulateAllForTenant for each tenant. This
 * is the SAFE half of the backfill: it recomputes clients.lda_client_ids from
 * the client's already-CONFIRMED LDA mappings, unions LDA-derived issue codes,
 * fills empty descriptions, and stamps intakeData.ldaSignals — it creates NO new
 * associations (that is resolveAllForTenant's job) and never clobbers user-entered
 * values. Idempotent: safe to re-run.
 *
 * Why a dedicated verb: resolveAllForTenant does NOT cascade to prepopulate, and
 * running it without a tenant registrant would generate low-quality global-fuzzy
 * candidates. This verb fixes the stale lda_client_ids cache (existing confirmed
 * mappings whose cache is empty) on its own — the immediate, zero-risk win.
 *
 * Boots a Nest application context (no HTTP server) to reuse the real service +
 * its RLS-aware PrismaService wiring. Mirrors sync-entity-resolution.ts.
 */
import { config as dotenvConfig } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { parseArgs } from 'node:util';

dotenvConfig();

// Load the Nest graph from the COMPILED dist (tsc-emitted decorator metadata);
// tsx re-transpiles with esbuild which does NOT emit reliable decorator metadata
// → NestJS DI fails. Falls back to src for local dev where dist may be absent.
async function loadNest(): Promise<{
  AppModule: any;
  ClientPrepopulationService: any;
  PrismaService: any;
}> {
  for (const base of ['../dist', '../src']) {
    try {
      const app = await import(`${base}/app.module.js`);
      const prepop = await import(`${base}/intelligence/client-prepopulation.service.js`);
      const prisma = await import(`${base}/prisma/prisma.service.js`);
      return {
        AppModule: app.AppModule,
        ClientPrepopulationService: prepop.ClientPrepopulationService,
        PrismaService: prisma.PrismaService,
      };
    } catch {
      // try next base
    }
  }
  throw new Error('Could not load AppModule from dist or src');
}

const { values: args } = parseArgs({
  options: { tenant: { type: 'string' } },
});

async function main(): Promise<void> {
  const logger = new Logger('prepopulate-all');
  const { AppModule, ClientPrepopulationService, PrismaService } = await loadNest();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prepop = app.get(ClientPrepopulationService);
    const prisma = app.get(PrismaService);

    const tenants = args.tenant
      ? [{ id: args.tenant, slug: args.tenant }]
      : await prisma.withSystem((tx: any) =>
          // RLS hides tenants from a context-less query; this is trusted
          // cross-tenant admin tooling, so bypass RLS to enumerate them.
          tx.tenant.findMany({
            where: { status: 'active' },
            select: { id: true, slug: true },
          }),
        );

    logger.log(`prepopulating ${tenants.length} tenant(s)`);

    let ok = 0;
    let failed = 0;
    for (const tenant of tenants) {
      try {
        const summary = await prepop.prepopulateAllForTenant(tenant.id);
        ok++;
        logger.log(`${tenant.slug}: prepopulated ${summary.clients} client(s)`);
      } catch (err) {
        // One tenant's failure must not abort the rest of the run.
        failed++;
        logger.error(`${tenant.slug}: FAILED: ${(err as Error).message}`);
      }
    }

    logger.log(`done. ${ok} tenant(s) prepopulated, ${failed} failed.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[prepopulate-all] FAILED', err);
  process.exit(1);
});
